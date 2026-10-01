import { PrismaClient } from "@prisma/client";

/**
 * ย้ายโพสต์รายงาน "โพสต์เดียว" ไปเป็นรอบอื่น และให้นับว่าส่งทันเวลา
 *
 * ใช้กับเคสเฉพาะที่ระบบเลือกรอบให้ผิดตอนโพสต์ (เช่น รายงานเช้าโพสต์ 9:37 แต่
 * ช่อง "ส่งของรอบไหน?" เลือกรอบ Evening ให้อัตโนมัติ) — แก้แค่โพสต์นั้น:
 *   roundId               → รอบที่ระบุ (--time)
 *   roundTimeAtSubmission → เวลาของรอบนั้น
 *   lateBadgeHidden       → true (ตัวเดียวกับปุ่ม "ซ่อนป้ายส่งช้า" ของเจ้าของ —
 *                           ป้าย/สรุปส่งรายงาน/ตัวหักคะแนน นับเป็นทันเวลา)
 * เวลาโพสต์ (createdAt) ไม่แตะ รอบเดิมของโพสต์กลับเป็น "ยังไม่ส่ง" — คนนั้นยัง
 * ต้องส่งรอบนั้นตามปกติ ถ้ารอบใหม่เคยถูกหัก "พลาด" ไปแล้ว ตัวหักคะแนนรอบถัดไป
 * คืนคะแนนให้เอง (reports/sweep reconcile)
 *
 * ไม่ใส่ --apply = ดูอย่างเดียว ไม่เขียนอะไร
 *
 * รัน:
 *   sudo -u smartboss bash -c 'set -a; . /etc/smartboss/smartboss.env; set +a; \
 *     pnpm --filter @smartboss/database exec tsx scripts/fix-report-post-round.ts \
 *     --author=Nok --date=2026-10-01 --time=09:00'
 *   (ถูกต้องแล้วค่อยรันซ้ำโดยเติม --apply ท้ายคำสั่ง; ถ้ามีหลายโพสต์ให้ระบุ --post=<id>)
 */

const prisma = new PrismaClient();
const STORE_KEY = "report-feed";
const BKK_OFFSET_MS = 7 * 3600_000;

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}
const APPLY = process.argv.includes("--apply");

interface Round { id: string; label?: string; time: string }
interface Topic { id: string; name?: string; submissionRounds?: Round[]; cutoffs?: Round[] }
interface Post {
  id: string;
  topicId: string;
  authorId: string;
  createdAt: string;
  title?: string;
  roundId?: string;
  roundTimeAtSubmission?: string;
  lateBadgeHidden?: boolean;
  excludeFromSubmission?: boolean;
}
interface Feed { topics: Topic[]; posts: Post[]; [k: string]: unknown }

const bkkDay = (iso: string) => new Date(new Date(iso).getTime() + BKK_OFFSET_MS).toISOString().slice(0, 10);
const bkkTime = (iso: string) => new Date(new Date(iso).getTime() + BKK_OFFSET_MS).toISOString().slice(11, 16);
const roundsOf = (t: Topic): Round[] => (t.submissionRounds?.length ? t.submissionRounds : (t.cutoffs ?? []));
const roundName = (r: Round | undefined) => (r ? `${r.label ?? r.id} (${r.time})` : "-");

async function main() {
  const author = arg("author");
  const date = arg("date");
  const time = arg("time");
  const postId = arg("post");
  if (!author || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !time || !/^\d{1,2}:\d{2}$/.test(time)) {
    console.error("ต้องระบุ --author=ชื่อ --date=YYYY-MM-DD --time=HH:mm  (เพิ่ม --post=<id> ถ้ามีหลายโพสต์, --apply เพื่อแก้จริง)");
    process.exitCode = 1;
    return;
  }
  const targetTime = time.padStart(5, "0");

  const users = await prisma.user.findMany({
    where: { name: { contains: author, mode: "insensitive" } },
    select: { id: true, name: true, email: true, orgId: true },
  });
  if (users.length !== 1 || !users[0]!.orgId) {
    console.log(`ต้องเจอผู้ใช้ 1 คนพอดี แต่เจอ ${users.length}:`);
    for (const u of users) console.log(`  - ${u.name} <${u.email}>`);
    console.log("ใส่ --author ให้เจาะจงขึ้น (เช่น ชื่อเต็ม)");
    process.exitCode = 1;
    return;
  }
  const user = users[0]!;
  const orgId = user.orgId!;
  console.log(`ผู้ใช้: ${user.name} <${user.email}>\n`);

  const row = await prisma.reportTaskStore.findUnique({
    where: { orgId_key: { orgId, key: STORE_KEY } },
    select: { data: true, version: true },
  });
  if (!row) {
    console.log("ไม่พบข้อมูลรายงานของบริษัทนี้");
    return;
  }
  const feed = row.data as unknown as Feed;
  const topicById = new Map(feed.topics.map((t) => [t.id, t]));

  const mine = feed.posts.filter((p) => p.authorId === user.id && bkkDay(p.createdAt) === date);
  console.log(`โพสต์ของ ${user.name} วันที่ ${date}: ${mine.length} โพสต์`);
  for (const p of mine) {
    const t = topicById.get(p.topicId);
    const rounds = t ? roundsOf(t) : [];
    console.log(
      `  [${p.id}] ${bkkTime(p.createdAt)}  ห้อง "${t?.name ?? p.topicId}"  "${p.title ?? ""}"\n` +
        `      รอบที่บันทึกไว้: ${roundName(rounds.find((r) => r.id === p.roundId))}` +
        `${p.lateBadgeHidden ? "  (ซ่อนป้ายสายแล้ว)" : ""}${p.excludeFromSubmission ? "  (ไม่นับเป็นการส่ง)" : ""}` +
        `\n      รอบของห้องนี้: ${rounds.map(roundName).join(", ") || "-"}`
    );
  }
  console.log("");

  const candidates = mine.filter((p) => {
    if (postId && p.id !== postId) return false;
    const t = topicById.get(p.topicId);
    return !!t && roundsOf(t).some((r) => r.time.padStart(5, "0") === targetTime) && !p.excludeFromSubmission;
  });
  if (candidates.length !== 1) {
    console.log(
      candidates.length === 0
        ? `ไม่มีโพสต์ที่อยู่ในห้องซึ่งมีรอบเวลา ${targetTime} — ตรวจ --time / --date`
        : `มี ${candidates.length} โพสต์ที่เข้าเงื่อนไข — ระบุ --post=<id> จากรายการด้านบน`
    );
    process.exitCode = 1;
    return;
  }

  const post = candidates[0]!;
  const topic = topicById.get(post.topicId)!;
  const target = roundsOf(topic).find((r) => r.time.padStart(5, "0") === targetTime)!;
  const from = roundsOf(topic).find((r) => r.id === post.roundId);

  console.log(`จะแก้โพสต์ [${post.id}] เวลา ${bkkTime(post.createdAt)} ในห้อง "${topic.name ?? topic.id}"`);
  console.log(`  รอบ:   ${roundName(from)}  →  ${roundName(target)}`);
  console.log(`  นับว่า: ทันเวลา (ซ่อนป้ายส่งช้า)`);
  console.log(`  รอบ ${roundName(from)} จะกลับเป็น "ยังไม่ส่ง" — ยังต้องส่งตามปกติ\n`);

  if (!APPLY) {
    console.log("ยังไม่ได้แก้อะไร (ดูอย่างเดียว) — ถ้าถูกต้อง รันคำสั่งเดิมซ้ำโดยเติม --apply");
    return;
  }

  const next: Feed = {
    ...feed,
    posts: feed.posts.map((p) =>
      p.id === post.id ? { ...p, roundId: target.id, roundTimeAtSubmission: target.time, lateBadgeHidden: true } : p
    ),
  };
  const updated = await prisma.reportTaskStore.updateMany({
    where: { orgId, key: STORE_KEY, version: row.version },
    data: { data: next as never, version: { increment: 1 }, updatedBy: "script:fix-report-post-round" },
  });
  if (updated.count === 0) {
    console.log("มีคนบันทึกรายงานพร้อมกันพอดี ยังไม่ได้แก้ — รันคำสั่งเดิมอีกครั้ง");
    process.exitCode = 1;
    return;
  }
  console.log(`✓ แก้แล้ว (version ${row.version} → ${row.version + 1}) — หน้าฟีดจะอัปเดตเองภายในไม่กี่วินาที`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
