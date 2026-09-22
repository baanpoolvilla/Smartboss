import { PrismaClient, Prisma } from "@prisma/client";

/**
 * คืนคะแนนของ report_missed/report_late ที่หักไปแล้ว แต่ "รอบส่ง" (หรือทั้งห้อง)
 * ที่เป็นต้นเรื่องถูกลบ/ยกเลิกไปทีหลัง — คู่ขนานกับ
 * reconcile-orphan-sticker-events.ts เป๊ะ (สติกเกอร์งานที่ถูกยกเลิกแต่คะแนน
 * ยังค้าง) ต่างกันแค่ต้นเรื่องเป็น "รอบส่งรายงาน" แทนที่จะเป็น "สติกเกอร์"
 *
 * ที่มา: sweep (report-penalty-sweep.ts) คำนวณสถานะสด ๆ จากรอบที่ **มีอยู่ตอนนี้**
 * เท่านั้น — ถ้าหัวหน้าลบรอบส่งทิ้งทีหลัง (เช่น ตั้งเวลาผิด/ไม่ต้องการรอบนั้นแล้ว)
 * sweep รอบถัดไปจะไม่เห็นรอบนั้นอีกต่อไปเลย เลยไม่มีทางรู้ว่าต้อง "คืนคะแนน"
 * ให้ event เก่าที่เคยหักไปตอนรอบนั้นยังมีอยู่ — คะแนนเลยค้างติดลบถาวรทั้งที่
 * ต้นเรื่องหายไปแล้ว
 *
 * วิธีตรวจ: refId ของ event เหล่านี้เป็น `${day}:${topicId}:${roundId}:${userId}`
 * (ดู report-penalty-sweep.ts) → แยกเอา topicId/roundId ออกมา → เช็คว่าห้องนั้น
 * ยังอยู่ไหม และรอบนั้นยังอยู่ในห้องไหม (เทียบทั้ง submissionRounds ใหม่ และ
 * cutoffs เดิม — คนละพาธแต่ id เดียวกัน ดู effectiveRoundsOf ใน
 * lib/submission-rounds.ts) ถ้าห้อง/รอบไม่มีแล้ว และยังไม่เคยถูกคืน
 * (ไม่มี report_round_undo คู่กัน) ให้ออก event คืนคะแนน
 *
 * รัน (บนเซิร์ฟเวอร์ source /etc/smartboss/smartboss.env ก่อน):
 *   set -a; . /etc/smartboss/smartboss.env; set +a
 *   pnpm --filter @smartboss/database exec tsx scripts/reconcile-orphan-report-penalty-events.ts --dry-run
 *      เอา --dry-run ออกเพื่อเขียนจริง (รันซ้ำได้ ไม่คืนซ้ำ)
 */

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

interface RoundLike {
  id: string;
}
interface CutoffLike {
  id: string;
}
interface TopicLike {
  id: string;
  submissionRounds?: RoundLike[];
  cutoffs?: CutoffLike[];
}
interface ReportFeedSlice {
  topics?: TopicLike[];
}

function parseRefId(refId: string): { day: string; topicId: string; roundId: string; userId: string } | null {
  const parts = refId.split(":");
  if (parts.length !== 4) return null;
  const [day, topicId, roundId, userId] = parts as [string, string, string, string];
  return { day, topicId, roundId, userId };
}

async function main() {
  const events = await prisma.performanceEvent.findMany({
    where: { source: "report_task", refType: "report_round", category: { in: ["report_missed", "report_late"] } },
    select: { orgId: true, userId: true, category: true, points: true, occurredAt: true, refId: true, note: true, createdBy: true },
  });
  if (events.length === 0) {
    console.log("ไม่มีเหตุการณ์หักคะแนนรายงานเลย");
    return;
  }

  const orgIds = [...new Set(events.map((e) => e.orgId))];
  const undone = new Set(
    (
      await prisma.performanceEvent.findMany({
        where: { source: "report_task", refType: "report_round_undo" },
        select: { orgId: true, refId: true },
      })
    ).map((u) => `${u.orgId}|${u.refId}`)
  );

  let total = 0;
  for (const orgId of orgIds) {
    const { data } = await prisma.reportTaskStore.findUnique({
      where: { orgId_key: { orgId, key: "report-feed" } },
      select: { data: true },
    }) ?? { data: null };
    const topics = ((data as unknown as ReportFeedSlice)?.topics ?? []) as TopicLike[];
    const aliveRoundKeys = new Set<string>();
    for (const t of topics) {
      for (const r of t.submissionRounds ?? []) aliveRoundKeys.add(`${t.id}|${r.id}`);
      for (const c of t.cutoffs ?? []) aliveRoundKeys.add(`${t.id}|${c.id}`); // legacy path — ดู effectiveRoundsOf
    }

    const myEvents = events.filter((e) => e.orgId === orgId && e.refId);
    const orphans = myEvents.filter((e) => {
      if (undone.has(`${orgId}|${e.refId}`)) return false;
      const parsed = parseRefId(e.refId!);
      if (!parsed) return false;
      return !aliveRoundKeys.has(`${parsed.topicId}|${parsed.roundId}`);
    });
    if (orphans.length === 0) continue;

    const sum = orphans.reduce((acc, e) => acc + Number(e.points), 0);
    console.log(`[${orgId}] รอบส่งที่ถูกลบ/ยกเลิกแต่คะแนนยังค้าง ${orphans.length} รายการ (รวม ${sum} แต้ม จะคืน ${-sum})`);
    for (const e of orphans) console.log(`   ${e.userId}  ${e.points}  ${e.refId}`);
    total += orphans.length;
    if (dryRun) continue;

    await prisma.performanceEvent.createMany({
      data: orphans.map((e) => ({
        orgId,
        userId: e.userId,
        source: "report_task" as const,
        category: e.category,
        points: new Prisma.Decimal(e.points).neg(),
        occurredAt: e.occurredAt,
        refType: "report_round_undo",
        refId: e.refId,
        note: `ยกเลิก (รอบส่ง/ห้องถูกลบไปแล้ว): ${e.note ?? ""}`,
        createdBy: e.createdBy,
      })),
      skipDuplicates: true,
    });
  }

  console.log(dryRun ? `\n[dry-run] พบ ${total} รายการ — ยังไม่เขียนอะไร` : `\nคืนคะแนนแล้ว ${total} รายการ`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
