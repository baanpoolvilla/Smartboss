import { PrismaClient } from "@prisma/client";

/**
 * แก้ปลายทางที่ย้ายผิดห้อง (สรุปงาน-รวมห้องรายงาน 2026-09-23)
 *
 * ที่มา: ข้อมูลจริงมีห้องชื่อซ้ำกันคู่ละ 2 ห้อง — ห้องเดิมที่ใช้มาตั้งแต่ต้นเดือน
 * กับห้องที่เพิ่งสร้างเมื่อ 22 ก.ย. ไว้ในหมวด "Report" ซึ่งเป็นห้องที่ตั้งใจจะให้
 * ทุกคนใช้จริง สคริปต์ย้ายรอบแรกเลือกปลายทางจาก "ห้องไหนมีโพสต์เยอะกว่า" เลยได้
 * ห้องเดิม ไม่ใช่ห้องในหมวด Report — โพสต์เลยไปกองอยู่คนละห้องกับรอบส่งที่ตั้งไว้
 * ผลคือระบบเห็นว่า "มีคนต้องส่งแต่ไม่มีโพสต์เลย" แล้วขึ้นขาดส่งทั้งกระดาน
 *
 * สคริปต์นี้ย้ายต่ออีกทอด ไม่ต้องกู้คืน (กู้คืนจะเสียโพสต์ใหม่ที่เข้ามาหลังย้าย):
 *  1. หาห้องปลายทางที่ถูก = ห้องที่อยู่ใต้หมวดชื่อ "Report" (ระบุเองได้ด้วย --dest-*)
 *  2. ย้ายโพสต์จากห้องชื่อซ้ำที่เหลือ เข้าห้องปลายทางนั้น
 *  3. ประทับ "วันเริ่มใช้" ของทุกรอบในห้องปลายทางเป็นวันนี้ — รอบพวกนั้นติดวันเริ่ม
 *     เก่ามาตั้งแต่ตอนสร้างห้อง (10/15 ก.ย.) เลยไล่ตัดสินย้อนหลังทั้งที่เจ้าของระบบ
 *     ต้องการให้เริ่มนับจากวันที่ตั้งเท่านั้น
 *  4. ปลดผู้ส่งของห้องชื่อซ้ำที่เหลือให้ว่าง
 *
 * รัน (บนเซิร์ฟเวอร์ source /etc/smartboss/smartboss.env ก่อน):
 *   set -a; . /etc/smartboss/smartboss.env; set +a
 *   pnpm --filter @smartboss/database exec tsx scripts/report-migration-retarget.ts --dry-run
 *      --dest-daily <topicId>    ระบุห้องปลายทางเอง (ถ้าหาอัตโนมัติไม่ได้/ไม่ถูกใจ)
 *      --dest-weekly <topicId>
 *      --dest-monthly <topicId>
 *      เอา --dry-run ออกเพื่อเขียนจริง
 */

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const NOW_ISO = new Date().toISOString();

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Frequency = "daily" | "weekly" | "monthly";

interface RoundLike {
  id: string;
  label?: string;
  time?: string;
  createdAt?: string;
  submitters?: { mode?: string; userIds?: string[]; addUserIds?: string[]; removeUserIds?: string[] };
}
interface TopicLike {
  id: string;
  name: string;
  createdAt?: string;
  parentId?: string;
  isCategory?: boolean;
  submissionRounds?: RoundLike[];
  cutoffs?: RoundLike[];
  requiredWeekdays?: number[];
}
interface PostLike {
  id: string;
  topicId: string;
  createdAt: string;
  roundId?: string;
  roundTimeAtSubmission?: string;
}
interface ReportFeedSlice {
  topics?: TopicLike[];
  posts?: PostLike[];
  [k: string]: unknown;
}

function effectiveRounds(t: TopicLike): RoundLike[] {
  if (t.submissionRounds && t.submissionRounds.length > 0) return t.submissionRounds;
  if (!t.cutoffs || t.cutoffs.length === 0) return [];
  return t.cutoffs.map((c) => ({ ...c }));
}

function mergeNameOf(t: TopicLike): Frequency | null {
  const n = t.name.trim().toLowerCase();
  if (n === "daily-report") return "daily";
  if (n === "weekly-report") return "weekly";
  if (n === "monthly-report") return "monthly";
  return null;
}

function peopleCount(r: RoundLike): number {
  const s = r.submitters;
  if (!s || s.mode !== "people") return 0;
  const ids = new Set(s.userIds ?? []);
  for (const id of s.addUserIds ?? []) ids.add(id);
  for (const id of s.removeUserIds ?? []) ids.delete(id);
  return ids.size;
}

/** ห้องนี้อยู่ใต้หมวดชื่อ "Report" ไหม (ไล่ขึ้นไปตามสายแม่) */
function underReportCategory(t: TopicLike, byId: Map<string, TopicLike>): boolean {
  let cur: TopicLike | undefined = t;
  const seen = new Set<string>();
  while (cur?.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent: TopicLike | undefined = byId.get(cur.parentId);
    if (!parent) return false;
    if (parent.name.trim().toLowerCase() === "report") return true;
    cur = parent;
  }
  return false;
}

async function main() {
  const stores = await prisma.reportTaskStore.findMany({ where: { key: "report-feed" } });
  if (stores.length === 0) {
    console.log("ไม่พบสโตร์ report-feed");
    return;
  }

  for (const store of stores) {
    const data = store.data as unknown as ReportFeedSlice;
    const topics = data.topics ?? [];
    const posts = data.posts ?? [];
    const byId = new Map(topics.map((t) => [t.id, t]));
    const postCountOf = (id: string) => posts.filter((p) => p.topicId === id).length;

    console.log(`\n${"=".repeat(78)}`);
    console.log(`ORG ${store.orgId}   ${dryRun ? "[DRY-RUN — ยังไม่เขียนอะไร]" : "[เขียนจริง]"}`);
    console.log("=".repeat(78));

    const destById = new Map<Frequency, TopicLike>();
    const moveInto = new Map<string, string>(); // fromTopicId -> destTopicId
    const disarm = new Set<string>();

    for (const kind of ["daily", "weekly", "monthly"] as Frequency[]) {
      const candidates = topics.filter((t) => mergeNameOf(t) === kind && !t.isCategory);
      if (candidates.length === 0) {
        console.log(`\n--- ${kind.toUpperCase()} : ไม่มีห้องชื่อนี้เลย ข้าม`);
        continue;
      }

      const explicit = argValue(`--dest-${kind}`);
      const dest =
        (explicit ? candidates.find((t) => t.id === explicit) : undefined) ??
        candidates.find((t) => underReportCategory(t, byId)) ??
        candidates[0]!;
      destById.set(kind, dest);

      const others = candidates.filter((t) => t.id !== dest.id);
      console.log(`\n--- ${kind.toUpperCase()} ---`);
      console.log(
        `  ปลายทาง: "${dest.name}" id ${dest.id} · สร้าง ${dest.createdAt?.slice(0, 10) ?? "-"}` +
          ` · โพสต์ตอนนี้ ${postCountOf(dest.id)}` +
          `${explicit ? " (ระบุเอง)" : underReportCategory(dest, byId) ? " (อยู่ใต้หมวด Report)" : " (เลือกตัวแรก — ไม่พบห้องใต้หมวด Report)"}`
      );

      for (const o of others) {
        const n = postCountOf(o.id);
        moveInto.set(o.id, dest.id);
        disarm.add(o.id);
        console.log(`  ย้ายมาจาก: "${o.name}" id ${o.id} · โพสต์ ${n} อัน -> ย้ายเข้าปลายทาง · ปลดผู้ส่งออก`);
      }

      const rounds = effectiveRounds(dest);
      if (rounds.length === 0) {
        console.log(`  รอบในปลายทาง: ยังไม่มี — ตั้งเองในหน้าจอได้เลย (จะเริ่มนับจากวันที่ตั้ง)`);
      } else {
        console.log(`  รอบในปลายทาง ${rounds.length} รอบ — จะประทับวันเริ่มใช้เป็นวันนี้ (${NOW_ISO.slice(0, 10)}):`);
        for (const r of rounds) {
          console.log(
            `     · "${r.label ?? r.id}" ${r.time ?? "--:--"} · ผู้ส่ง ${peopleCount(r)} คน` +
              ` · เริ่มใช้ ${r.createdAt?.slice(0, 10) ?? "(ไม่ระบุ)"} -> ${NOW_ISO.slice(0, 10)}`
          );
        }
      }
    }

    const totalMoves = posts.filter((p) => moveInto.has(p.topicId)).length;
    console.log(`\n--- สรุป ---`);
    console.log(`  โพสต์ที่จะย้าย ${totalMoves} อัน · ห้องที่จะถูกปลดผู้ส่ง ${disarm.size} ห้อง`);

    if (dryRun) {
      console.log(`\n[dry-run] ยังไม่เขียนอะไรลงฐานข้อมูล — เอา --dry-run ออกเพื่อทำจริง\n`);
      continue;
    }

    const nextPosts = posts.map((p) => {
      const to = moveInto.get(p.topicId);
      if (!to) return p;
      // ล้างการผูกรอบเก่าออกเหมือนรอบแรก — ให้รอบของห้องปลายทางเป็นตัวตัดสินอันเดียว
      const { roundId, roundTimeAtSubmission, ...rest } = p;
      void roundId;
      void roundTimeAtSubmission;
      return { ...rest, topicId: to };
    });

    const destIds = new Set([...destById.values()].map((t) => t.id));
    const nextTopics = topics.map((t) => {
      if (destIds.has(t.id)) {
        const rounds = effectiveRounds(t).map((r) => ({ ...r, createdAt: NOW_ISO }));
        return rounds.length > 0 ? { ...t, submissionRounds: rounds } : t;
      }
      if (disarm.has(t.id)) {
        const rounds = effectiveRounds(t).map((r) => ({ ...r, submitters: { mode: "people" as const, userIds: [] } }));
        return rounds.length > 0 ? { ...t, submissionRounds: rounds } : t;
      }
      return t;
    });

    await prisma.reportTaskStore.update({
      where: { orgId_key: { orgId: store.orgId, key: "report-feed" } },
      data: { data: { ...data, topics: nextTopics, posts: nextPosts } as never, version: { increment: 1 } },
    });

    console.log(`\nเรียบร้อย — ย้าย ${totalMoves} โพสต์ และตั้งวันเริ่มรอบเป็นวันนี้แล้ว`);
    console.log(`บอกทุกคนรีเฟรชหน้าจอ แล้วเช็คผลทันที\n`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
