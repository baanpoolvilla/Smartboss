import { PrismaClient, Prisma } from "@prisma/client";

/**
 * แก้ไขคะแนน "มาสาย/ขาดงาน" ที่เคยบันทึกผิด เพราะ cron อ่าน attendance_results
 * ของ "วันนี้" (ตอนที่ยังไม่จบกะ) ไปก่อนที่ค่าจะถูกคำนวณใหม่ให้ถูกต้อง
 *
 * ที่มา: workforce.attendance_results ของวันหนึ่งจะถูกคำนวณใหม่ทุกครั้งที่มีคน
 * เปิด /hr (ย้อนหลัง 30 วันรวมวันนี้ — ดู apps/web/app/(shell)/hr/home-today.tsx)
 * ถ้าใครเปิด /hr ตอนเช้าก่อนพนักงานตอกบัตรเข้า netWorkedMinutes ตอนนั้น = 0
 * ⇒ absence_minutes เท่ากับความยาวกะเต็มวันทันที เดิม cron รายวัน (08:00 น. และ
 * 17:00 น. — docs/deploy.md) อ่านค่านั้นไปบันทึกเป็นคะแนนถาวรก่อนที่พนักงานจะ
 * ตอกบัตรจริงเสียอีก แล้วค่าถูกก็มาแทนที่ attendance_results ทีหลังในวันเดียวกัน
 * แต่ core.performance_events ที่บันทึกไปแล้วไม่มีทางถูกแก้/ลบเอง (กันหักซ้ำด้วย
 * unique key ถาวร) — แก้ต้นเหตุแล้วที่ apps/web/lib/attendance-performance.ts
 * (ไม่ให้ cron ตัดสิน "วันนี้" อีกต่อไป) สคริปต์นี้แก้ของเก่าที่ค้างผิดอยู่แล้ว
 *
 * วิธีตรวจ: ไล่ทุกเหตุการณ์ attendance_late/attendance_absent ที่เคยบันทึกไว้
 * เทียบกับ attendance_results **ปัจจุบัน** (ผ่าน workforce.performance_attendance
 * เดียวกับที่ cron ใช้ แต่ไม่กรองด้วยเกณฑ์ ขอค่าดิบมาทั้งหมด) ถ้าค่าปัจจุบันต่ำ
 * กว่าเกณฑ์ของบริษัทแล้ว (แปลว่าค่าที่เคยอ่านตอนนั้นผิด ค่าจริงถูกคำนวณใหม่ไป
 * แล้ว) ให้ออกเหตุการณ์ "แก้ไข" หักล้างของเดิมพอดี — **ไม่ลบ/ไม่แก้ของเดิม**
 * เพื่อให้ประวัติ audit ย้อนอ่านได้ครบว่าเคยหักแล้วก็แก้ไขทีหลังเพราะอะไร
 *
 * รัน (ต้องมี DATABASE_URL ชี้ไปฐานที่ต้องการ — บนเซิร์ฟเวอร์คือ source
 * /etc/smartboss/smartboss.env ก่อนเหมือนตอนรัน db:deploy):
 *   set -a; . /etc/smartboss/smartboss.env; set +a
 *   pnpm --filter @smartboss/database exec tsx scripts/reconcile-wrong-attendance-events.ts --dry-run
 *      เติม --dry-run เพื่อดูรายการที่จะแก้โดยยังไม่เขียนลงฐานข้อมูล
 */

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

interface RawRow {
  subject: string;
  work_date: Date;
  late_minutes: number;
  absence_minutes: number;
}

async function main() {
  const candidates = await prisma.performanceEvent.findMany({
    where: {
      source: "workforce",
      category: { in: ["attendance_late", "attendance_absent"] },
      refType: "attendance_day",
    },
    orderBy: { occurredAt: "asc" },
  });

  if (candidates.length === 0) {
    console.log("ไม่มีเหตุการณ์มาสาย/ขาดงานให้ตรวจสอบเลย");
    return;
  }

  const earliestDay = candidates[0]!.occurredAt;

  // ขอค่าดิบทั้งหมดตั้งแต่วันที่เก่าสุดที่ต้องตรวจ ไม่กรองด้วยเกณฑ์ (ใส่ -1 ทั้ง
  // สองตัว ให้ผ่านเงื่อนไข "> เกณฑ์" เสมอแม้ค่าจะเป็น 0 พอดี) แล้วมาเทียบเกณฑ์
  // จริงของแต่ละบริษัทเองฝั่งสคริปต์ — วันที่ไม่โผล่ในผลลัพธ์เลยแปลว่าตอนนี้เป็น
  // วันลา/วันหยุด/วันหยุดประจำสัปดาห์ไปแล้ว (ซึ่งก็แปลว่าที่เคยหักไว้ผิดเหมือนกัน)
  const rawRows = await prisma.$queryRaw<RawRow[]>`
    SELECT subject, work_date, late_minutes, absence_minutes
    FROM workforce.performance_attendance(${earliestDay}::date, -1::int, -1::int)
  `;
  const currentByKey = new Map(
    rawRows.map((r) => [
      `${r.subject}:${new Date(r.work_date).toISOString().slice(0, 10)}`,
      { late: Number(r.late_minutes), absence: Number(r.absence_minutes) },
    ]),
  );

  const settings = await prisma.performanceSetting.findMany({
    select: { orgId: true, lateThresholdMinutes: true },
  });
  const lateThresholdByOrg = new Map(settings.map((s) => [s.orgId, s.lateThresholdMinutes]));
  const ABSENCE_THRESHOLD_MINUTES = 240; // ตรงกับ apps/web/lib/performance.ts — ตรึงไว้ ไม่ตั้งต่อบริษัท

  type Correction = {
    original: (typeof candidates)[number];
    reason: string;
    current: { late: number; absence: number } | null;
  };
  const toCorrect: Correction[] = [];

  for (const ev of candidates) {
    const day = ev.occurredAt.toISOString().slice(0, 10);
    const key = `${ev.userId}:${day}`;
    const current = currentByKey.get(key) ?? null;
    const lateThreshold = lateThresholdByOrg.get(ev.orgId) ?? 15;

    if (current === null) {
      toCorrect.push({
        original: ev,
        reason: "ตอนนี้เป็นวันลา/วันหยุด/ไม่มีผลลงเวลาแล้ว (ไม่ปรากฏในผลคำนวณปัจจุบันเลย)",
        current: null,
      });
      continue;
    }

    if (ev.category === "attendance_absent" && current.absence <= ABSENCE_THRESHOLD_MINUTES) {
      toCorrect.push({
        original: ev,
        reason: `ขาดงานจริงแค่ ${current.absence} นาที (เกณฑ์ ${ABSENCE_THRESHOLD_MINUTES}) ไม่ถึงเกณฑ์ขาดงานแล้ว`,
        current,
      });
    } else if (ev.category === "attendance_late" && current.late <= lateThreshold) {
      toCorrect.push({
        original: ev,
        reason: `สายจริงแค่ ${current.late} นาที (เกณฑ์ ${lateThreshold}) ไม่ถึงเกณฑ์มาสายแล้ว`,
        current,
      });
    }
  }

  if (toCorrect.length === 0) {
    console.log(`ตรวจแล้ว ${candidates.length} เหตุการณ์ — ไม่มีรายการที่ต้องแก้ไข`);
    return;
  }

  console.log(`พบ ${toCorrect.length}/${candidates.length} เหตุการณ์ที่ค่าปัจจุบันไม่ตรงกับตอนที่บันทึกไว้:\n`);
  for (const { original, reason } of toCorrect) {
    const day = original.occurredAt.toISOString().slice(0, 10);
    console.log(
      `  [${original.orgId}] user=${original.userId} ${day} ${original.category} เดิม ${original.points} แต้ม — ${reason}`,
    );
  }

  if (dryRun) {
    console.log("\n[dry-run] ยังไม่เขียนลงฐานข้อมูล — รันโดยไม่ใส่ --dry-run เพื่อแก้ไขจริง");
    return;
  }

  const { count } = await prisma.performanceEvent.createMany({
    data: toCorrect.map(({ original, reason }) => ({
      orgId: original.orgId,
      userId: original.userId,
      source: original.source,
      category: original.category,
      points: new Prisma.Decimal(Number(original.points) * -1),
      occurredAt: new Date(),
      refType: "attendance_day_correction",
      refId: original.id,
      note: `แก้ไขค่าที่บันทึกผิดตอน ${original.occurredAt.toISOString().slice(0, 10)}: ${reason}`,
    })),
    skipDuplicates: true,
  });
  console.log(`\n✔ แก้ไข ${count} เหตุการณ์ — คะแนนรวมจะอัปเดตทันทีที่โหลดหน้า /admin/performance ใหม่`);
}

main()
  .catch((err) => {
    console.error("[reconcile-wrong-attendance-events] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
