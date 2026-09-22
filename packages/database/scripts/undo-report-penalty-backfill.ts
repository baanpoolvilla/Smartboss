import { PrismaClient, Prisma } from "@prisma/client";

/**
 * คืนคะแนนที่ sweep รายงาน (report_missed/report_late, เฟส 2 ของ
 * spec-report-submission-rounds.md) หักผิดไปตอนเปิดใช้งานครั้งแรก
 *
 * ที่มา: ก่อนแก้ `report-penalty-sweep.ts` (เพิ่ม `notBeforeDay` /
 * `enabledSince`) ครั้งแรกที่บริษัทไหนเปิดสวิตช์ "หักคะแนน HR เมื่อพลาด/
 * ส่งช้ารายงาน" sweep จะไล่ย้อนหลังเต็ม lookback (45 วัน) แล้วหักคะแนนของ
 * ทุกวันที่เคยพลาด **ก่อน** ฟีเจอร์นี้จะมีอยู่ด้วยซ้ำ พร้อมกันรวดเดียว — บั๊ก
 * ที่เจอจริงจากการใช้งาน (พนักงานหลายคนโดนหักคะแนนย้อนหลังหนักผิดปกติ) ตอนนี้
 * โค้ดแก้แล้ว (ไม่แบ็คฟิลอีก) แต่คะแนนที่หักผิดไปแล้วในรอบแรกยังค้างอยู่
 *
 * วิธีแก้: คืนคะแนนของ event `report_missed`/`report_late` (refType
 * `report_round`) **ทุกตัว** ที่ยังไม่เคยถูกคืน (ไม่มี `report_round_undo`
 * คู่กัน) — ไม่ต้องแยกว่าอันไหน "ถูก/ผิด" เพราะทุกตัวที่มีอยู่ตอนนี้ล้วนมาจาก
 * โค้ดเวอร์ชันบั๊กทั้งหมด (ฟีเจอร์นี้เพิ่งเปิดใช้งานจริงเป็นครั้งแรก) —
 * ของที่ถูกต้อง (วันนี้/วันถัดจากนี้) จะถูกสร้างขึ้นใหม่เองโดย sweep ที่แก้แล้ว
 * ในรอบถัดไป ไม่ต้องกังวลว่าจะเสียของที่ถูกไป
 *
 * ไม่ลบ/ไม่แก้ event เดิม — ออก event ตรงข้ามคู่กัน (เหมือน
 * reconcile-orphan-sticker-events.ts) ประวัติ audit อ่านย้อนได้ครบ
 *
 * รัน (บนเซิร์ฟเวอร์ source /etc/smartboss/smartboss.env ก่อน):
 *   set -a; . /etc/smartboss/smartboss.env; set +a
 *   pnpm --filter @smartboss/database exec tsx scripts/undo-report-penalty-backfill.ts --dry-run
 *      เอา --dry-run ออกเพื่อเขียนจริง (รันซ้ำได้ ไม่คืนซ้ำ)
 */

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const events = await prisma.performanceEvent.findMany({
    where: { source: "report_task", refType: "report_round", category: { in: ["report_missed", "report_late"] } },
    select: { id: true, orgId: true, userId: true, category: true, points: true, occurredAt: true, refId: true, note: true },
  });
  if (events.length === 0) {
    console.log("ไม่มีเหตุการณ์หักคะแนนรายงานเลย — ไม่มีอะไรต้องคืน");
    return;
  }

  const undone = new Set(
    (
      await prisma.performanceEvent.findMany({
        where: { source: "report_task", refType: "report_round_undo" },
        select: { orgId: true, refId: true },
      })
    ).map((u) => `${u.orgId}|${u.refId}`)
  );

  const pending = events.filter((e) => e.refId && !undone.has(`${e.orgId}|${e.refId}`));
  if (pending.length === 0) {
    console.log("ทุกเหตุการณ์ถูกคืนไปแล้ว — ไม่มีอะไรต้องทำเพิ่ม");
    return;
  }

  const byOrg = new Map<string, typeof pending>();
  for (const e of pending) {
    const list = byOrg.get(e.orgId) ?? [];
    list.push(e);
    byOrg.set(e.orgId, list);
  }

  let total = 0;
  for (const [orgId, list] of byOrg) {
    const sum = list.reduce((acc, e) => acc + Number(e.points), 0);
    console.log(`[${orgId}] คืนคะแนนหักผิดตอนแบ็คฟิลครั้งแรก ${list.length} รายการ (รวม ${sum} แต้ม จะคืน ${-sum})`);
    const byUser = new Map<string, number>();
    for (const e of list) byUser.set(e.userId, (byUser.get(e.userId) ?? 0) + Number(e.points));
    for (const [userId, pts] of byUser) console.log(`   ${userId}  ${pts}`);
    total += list.length;
    if (dryRun) continue;

    await prisma.performanceEvent.createMany({
      data: list.map((e) => ({
        orgId,
        userId: e.userId,
        source: "report_task" as const,
        category: e.category,
        points: new Prisma.Decimal(e.points).neg(),
        occurredAt: e.occurredAt,
        refType: "report_round_undo",
        refId: e.refId,
        note: `ยกเลิก (แบ็คฟิลผิดตอนเปิดฟีเจอร์ครั้งแรก): ${e.note ?? ""}`,
        createdBy: null,
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
