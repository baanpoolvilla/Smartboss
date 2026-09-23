import { PrismaClient } from "@prisma/client";

/**
 * ขั้น 1 ของการย้ายข้อมูลเข้าห้องรวม (สรุปงาน-รวมห้องรายงาน 2026-09-23) —
 * อ่านอย่างเดียว ไม่เขียนอะไรทั้งสิ้น แค่กางข้อมูลจริงออกมาดูก่อนตัดสินใจ
 *
 * ตอบคำถามที่ต้องรู้ก่อนย้าย:
 *  - ห้องไหนเป็นห้องรายงานประเภทอะไร (daily/weekly/monthly) และมีกี่โพสต์
 *  - โพสต์เก่าสุดของแต่ละห้องอยู่วันไหน (= วันที่ต้องย้อน createdAt ไปถึง)
 *  - แต่ละห้องมีรอบอะไร เวลาไหน ใครเป็นผู้ส่ง (= ต้องตั้งรอบใหม่ให้ตรงแค่ไหน)
 *  - ห้องรวมปลายทาง (Daily-report / Weekly-report / Monthly-report) มีอยู่จริงไหม
 *
 * การแยกประเภทใช้กติกาเดียวกับหน้าเว็บเป๊ะ (apps/web/modules/report_task/lib/
 * report-frequency.ts): ดูจากรอบส่งจริง ไม่ใช่เดาจากชื่อห้อง — มีรอบ dayOfMonth
 * = monthly, มีรอบจำกัดวันในสัปดาห์ = weekly, นอกนั้น = daily, ไม่มีรอบเลย = ไม่ใช่
 * ห้องรายงาน
 *
 * รัน (บนเซิร์ฟเวอร์ source /etc/smartboss/smartboss.env ก่อน):
 *   set -a; . /etc/smartboss/smartboss.env; set +a
 *   pnpm --filter @smartboss/database exec tsx scripts/report-migration-inspect.ts
 */

const prisma = new PrismaClient();

interface RoundLike {
  id: string;
  label?: string;
  time?: string;
  weekdays?: number[];
  dayOfMonth?: number;
  createdAt?: string;
  submitters?: { mode?: string; userIds?: string[]; departmentIds?: string[]; groupIds?: string[]; addUserIds?: string[]; removeUserIds?: string[] };
}
interface TopicLike {
  id: string;
  name: string;
  createdAt?: string;
  parentId?: string;
  isCategory?: boolean;
  archived?: boolean;
  submissionRounds?: RoundLike[];
  cutoffs?: RoundLike[];
  requiredWeekdays?: number[];
  visibility?: { departmentIds?: string[]; userIds?: string[]; managerOnly?: boolean };
}
interface PostLike {
  id: string;
  topicId: string;
  authorId: string;
  createdAt: string;
  roundId?: string;
}
interface ReportFeedSlice {
  topics?: TopicLike[];
  posts?: PostLike[];
}

/** เท่ากับ effectiveRoundsOf ในหน้าเว็บ — ห้องเก่าที่ยังมีแค่ cutoffs ก็นับด้วย */
function effectiveRounds(t: TopicLike): RoundLike[] {
  if (t.submissionRounds && t.submissionRounds.length > 0) return t.submissionRounds;
  if (!t.cutoffs || t.cutoffs.length === 0) return [];
  return t.cutoffs.map((c) => ({ ...c, weekdays: t.requiredWeekdays }));
}

/** เท่ากับ topicReportFrequency ในหน้าเว็บ */
function frequencyOf(t: TopicLike): "daily" | "weekly" | "monthly" | null {
  const rounds = effectiveRounds(t);
  if (rounds.length === 0) return null;
  if (rounds.some((r) => r.dayOfMonth != null)) return "monthly";
  if (rounds.some((r) => (r.weekdays?.length ?? 0) > 0 && (r.weekdays?.length ?? 0) < 7)) return "weekly";
  return "daily";
}

/** ห้องรวมปลายทาง — ชื่อตรง ๆ ไม่มีท้ายเป็นแผนก */
function mergeTargetOf(t: TopicLike): "daily" | "weekly" | "monthly" | null {
  const n = t.name.trim().toLowerCase();
  if (n === "daily-report") return "daily";
  if (n === "weekly-report") return "weekly";
  if (n === "monthly-report") return "monthly";
  return null;
}

function describeSubmitters(r: RoundLike): string {
  const s = r.submitters;
  if (!s) return "(ไม่ระบุ = ทุกคนที่เห็นห้อง)";
  const extra = [
    (s.addUserIds?.length ?? 0) > 0 ? `+${s.addUserIds!.length} คน` : "",
    (s.removeUserIds?.length ?? 0) > 0 ? `-${s.removeUserIds!.length} คน` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const base =
    s.mode === "people"
      ? `รายคน ${s.userIds?.length ?? 0} คน`
      : s.mode === "departments"
        ? `รายแผนก ${s.departmentIds?.length ?? 0} แผนก`
        : s.mode === "groups"
          ? `กลุ่ม ${s.groupIds?.length ?? 0} กลุ่ม`
          : "ทุกคนที่เห็นห้อง";
  return extra ? `${base} (${extra})` : base;
}

function describeSchedule(r: RoundLike): string {
  if (r.dayOfMonth) return `ทุกวันที่ ${r.dayOfMonth} ของเดือน`;
  if (r.weekdays && r.weekdays.length > 0 && r.weekdays.length < 7) {
    const names = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
    return `ทุกวัน${r.weekdays.map((d) => names[d] ?? d).join("/")}`;
  }
  return "ทุกวัน";
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

    console.log(`\n${"=".repeat(78)}`);
    console.log(`ORG ${store.orgId}   (store version ${store.version}, แก้ล่าสุด ${store.updatedAt.toISOString()})`);
    console.log(`ห้องทั้งหมด ${topics.length} ห้อง · โพสต์ทั้งหมด ${posts.length} โพสต์`);
    console.log("=".repeat(78));

    const postsByTopic = new Map<string, PostLike[]>();
    for (const p of posts) {
      const arr = postsByTopic.get(p.topicId) ?? [];
      arr.push(p);
      postsByTopic.set(p.topicId, arr);
    }

    // --- ห้องรวมปลายทาง ---
    console.log(`\n--- ห้องรวมปลายทาง ---`);
    for (const kind of ["daily", "weekly", "monthly"] as const) {
      // ทุกห้องที่ "ชื่อเป็นห้องรวม" ไม่ใช่แค่ห้องแรกที่เจอ — ข้อมูลจริงมีห้องชื่อซ้ำ
      // ซึ่งห้องที่ไม่ได้ถูกเลือกเป็นเป้าหมายจะกลายเป็นห้องที่ยังบังคับส่งค้างอยู่
      const all = topics.filter((t) => mergeTargetOf(t) === kind);
      if (all.length === 0) {
        console.log(`  ${kind.padEnd(8)} ยังไม่มีห้องชื่อ "${kind[0]!.toUpperCase()}${kind.slice(1)}-report" — ต้องสร้างก่อน`);
        continue;
      }
      all.forEach((target, i) => {
        const own = postsByTopic.get(target.id) ?? [];
        const rounds = effectiveRounds(target);
        const tag = i === 0 ? "[เป้าหมาย]" : "[ชื่อซ้ำ! ห้องนี้จะไม่ถูกย้ายเข้า และถ้าไม่ปลดผู้ส่งจะยังบังคับส่งค้างอยู่]";
        console.log(
          `  ${kind.padEnd(8)} "${target.name}" ${tag}` +
            `\n           id ${target.id} · สร้าง ${target.createdAt?.slice(0, 10) ?? "-"} · โพสต์ของตัวเอง ${own.length}`
        );
        for (const r of rounds) {
          console.log(
            `           · รอบ "${r.label ?? "(ไม่มีชื่อ)"}" ${r.time ?? "--:--"} · ${describeSchedule(r)}` +
              `\n                 ผู้ส่ง: ${describeSubmitters(r)} · เริ่มใช้ ${r.createdAt?.slice(0, 10) ?? "(ไม่ระบุ)"}`
          );
        }
      });
    }

    // รอบที่ตั้งผู้ส่งแบบไม่ใช่ "รายคน" — สคริปต์ย้ายอ่านรายชื่อออกมาตรง ๆ ไม่ได้
    // และระบบจริงอาจตีความเป็น "ทุกคนในบริษัท" ซึ่งทำให้ภาระส่งบานปลายโดยไม่ตั้งใจ
    const nonPeople: string[] = [];
    for (const t of topics) {
      if (frequencyOf(t) === null) continue;
      for (const r of effectiveRounds(t)) {
        const mode = r.submitters?.mode ?? "(ไม่ระบุ = ทุกคนที่เห็นห้อง)";
        if (mode !== "people") nonPeople.push(`${t.name} · รอบ "${r.label ?? r.id}" ${r.time ?? ""} · mode=${mode}`);
      }
    }
    console.log(`\n--- รอบที่ผู้ส่งไม่ใช่ "รายคน" (${nonPeople.length}) ---`);
    if (nonPeople.length === 0) console.log(`  ไม่มี — ทุกรอบระบุรายคนหมด`);
    for (const line of nonPeople) console.log(`  ⚠ ${line}`);

    // --- ห้องต้นทางแยกตามประเภท ---
    for (const kind of ["daily", "weekly", "monthly"] as const) {
      const sources = topics.filter((t) => frequencyOf(t) === kind && mergeTargetOf(t) !== kind && !t.isCategory);
      const totalPosts = sources.reduce((n, t) => n + (postsByTopic.get(t.id)?.length ?? 0), 0);
      console.log(`\n--- ห้องต้นทางประเภท ${kind.toUpperCase()} : ${sources.length} ห้อง · รวม ${totalPosts} โพสต์ ---`);

      for (const t of sources) {
        const tp = (postsByTopic.get(t.id) ?? []).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const first = tp[0]?.createdAt?.slice(0, 10) ?? "-";
        const last = tp[tp.length - 1]?.createdAt?.slice(0, 10) ?? "-";
        const withRound = tp.filter((p) => p.roundId).length;
        console.log(
          `\n  ▸ ${t.name}${t.archived ? "  [เก็บถาวรแล้ว]" : ""}` +
            `\n      id ${t.id} · สร้าง ${t.createdAt?.slice(0, 10) ?? "-"}` +
            `\n      โพสต์ ${tp.length} (มี roundId ${withRound}) · ตั้งแต่ ${first} ถึง ${last}`
        );
        for (const r of effectiveRounds(t)) {
          console.log(
            `      · รอบ "${r.label ?? "(ไม่มีชื่อ)"}" ${r.time ?? "--:--"} · ${describeSchedule(r)}` +
              `\n            ผู้ส่ง: ${describeSubmitters(r)} · เริ่มใช้ ${r.createdAt?.slice(0, 10) ?? "(ไม่ระบุ = ย้อนหลังได้ทุกวัน)"}` +
              `\n            roundId ${r.id}`
          );
        }
      }
    }

    // --- สรุปสิ่งที่การย้ายจะต้องทำ ---
    const allSources = topics.filter((t) => frequencyOf(t) !== null && mergeTargetOf(t) === null && !t.isCategory);
    const movable = allSources.reduce((n, t) => n + (postsByTopic.get(t.id)?.length ?? 0), 0);
    const earliest = posts
      .filter((p) => allSources.some((t) => t.id === p.topicId))
      .map((p) => p.createdAt)
      .sort()[0];
    console.log(`\n--- สรุป ---`);
    console.log(`  โพสต์ที่จะถูกย้ายทั้งหมด  ${movable} โพสต์ จาก ${allSources.length} ห้อง`);
    console.log(`  โพสต์เก่าสุดอยู่วันที่      ${earliest?.slice(0, 10) ?? "-"}  (= วันที่ต้องย้อน createdAt ไปถึง)`);
  }

  // --- ประวัติคะแนน ---
  const eventCount = await prisma.performanceEvent.count({ where: { source: "report_task" } });
  const roundEvents = await prisma.performanceEvent.count({
    where: { source: "report_task", refType: "report_round" },
  });
  console.log(`\n--- ประวัติคะแนน (core.performance_events) ---`);
  console.log(`  ของ report_task ทั้งหมด ${eventCount} เหตุการณ์ (เป็นแบบผูกกับรอบส่ง ${roundEvents})`);
  console.log(`\nอ่านอย่างเดียว ไม่ได้แก้อะไรเลย\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
