import "server-only";
import { prisma } from "@smartboss/database";
import { crossOrg } from "@smartboss/database/cross-org";

import {
  ABSENCE_THRESHOLD_MINUTES,
  ATTENDANCE_LOOKBACK_DAYS,
  loadPerformanceSettingsMap,
  recordPerformanceEvents,
  type PerformanceEventInput,
} from "@/lib/performance";
import { recalculateAttendanceAllOrgs } from "@/lib/attendance-recalc";

/**
 * ดึงผลลงเวลาจาก workforce มาเป็นคะแนนผลงาน
 *
 * ทำไมอ่านฐานข้อมูลตรงแทนที่จะเรียก workforce API: งานนี้รันจาก cron ซึ่งไม่มี
 * session ของผู้ใช้ จะออก token ให้ตัวเองก็ต้องรู้ความลับของ auth อยู่ดี
 * และทั้งสองระบบใช้ฐานข้อมูลเดียวกัน การอ่านอย่างเดียวข้ามสคีมาจึงตรงกว่า
 *
 * ⚠ ห้ามอ่านตารางฝั่ง workforce ตรง ๆ — ทุกใบเปิด FORCE ROW LEVEL SECURITY
 * และ Prisma ต่อด้วย user ที่ไม่มี tenant context จึงจะได้ 0 แถวเสมอ **โดยไม่มี
 * error ให้เห็น** ต้องเรียกผ่านฟังก์ชัน workforce.performance_attendance()
 * ซึ่งเป็น SECURITY DEFINER ที่เจ้าของอ่านข้ามบริษัทได้เฉพาะ 3 ตารางที่จำเป็น
 * (ติดตั้งด้วย packages/workforce/db/sql/04-performance-lookup.sql)
 *
 * ⚠ อ่านอย่างเดียวเท่านั้น — การเขียนลง workforce ต้องผ่าน API เสมอ เพราะที่นั่น
 * มี RLS, การตรวจสิทธิ์ และ audit ที่ SQL ตรงจะข้ามไปหมด
 *
 * เส้นทางแปลงคนกลับไปเป็นผู้ใช้ Smartboss:
 *   attendance_results.employment_id → employments.person_id
 *     → principals.person_id → principals.subject (= core.users.id)
 * เส้น principals.person_id ถูกเติมโดย `pnpm wf:sync` (จับคู่ด้วยอีเมล)
 */

interface AttendanceRow {
  user_id: string;
  work_date: Date;
  late_minutes: number;
  absence_minutes: number;
  missing_punch: boolean;
}

/**
 * เกณฑ์สายตั้งค่าได้รายบริษัท (lateThresholdMinutes) — ที่นี่เป็นงานข้ามบริษัท
 * จึงต้องดึงด้วยเกณฑ์ที่ "ผ่อนผันน้อยที่สุด" ในระบบก่อน แล้วค่อยกรองตามเกณฑ์
 * ของแต่ละบริษัททีหลัง ถ้าดึงด้วยเกณฑ์ของบริษัทใดบริษัทหนึ่ง บริษัทที่เข้มกว่า
 * จะตกหล่น
 *
 * เส้นแบ่งขาดงาน (ABSENCE_THRESHOLD_MINUTES) กับช่วงย้อนดู
 * (ATTENDANCE_LOOKBACK_DAYS) ตรึงไว้ตายตัว ไม่ตั้งค่าต่อบริษัท
 */
export async function dockAttendance(): Promise<{
  scanned: number;
  recorded: number;
  refunded?: number;
  recalculated?: Awaited<ReturnType<typeof recalculateAttendanceAllOrgs>>;
}> {
  // คำนวณผลลงเวลาให้ครบก่อนตัดสิน — ไม่ต้องรอให้มีคนเปิดหน้า /hr (ดู lib/attendance-recalc.ts)
  // พลาดก็หักต่อจากผลเท่าที่มี ไม่หยุดทั้งงาน
  const recalculated = await recalculateAttendanceAllOrgs().catch((err) => {
    console.error("[attendance] recalc before docking failed", err);
    return undefined;
  });

  const orgs = await prisma.organization.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  if (orgs.length === 0) return { scanned: 0, recorded: 0 };

  const settingsByOrg = await loadPerformanceSettingsMap(orgs.map((o) => o.id));
  const active = [...settingsByOrg.values()].filter((s) => s.enabled);
  if (active.length === 0) return { scanned: 0, recorded: 0 };

  // ดึงทุกวันที่สาย > 0 แล้วค่อยตัดสินรายวันด้วย lateThresholdFor (วันก่อนรวมเกณฑ์ยังใช้ค่าเดิมของบริษัท)
  const minLate = Math.min(0, ...active.map((s) => s.lateThresholdMinutes));

  const from = new Date();
  from.setDate(from.getDate() - ATTENDANCE_LOOKBACK_DAYS);

  /*
   * ห้ามตัดสิน "วันนี้" (ของตอนที่ cron รันอยู่) เด็ดขาด — attendance_results
   * ของวันที่ยังไม่จบกะเชื่อไม่ได้เลย เพราะแถวนั้นคำนวณใหม่ทุกครั้งที่มีคนเปิด
   * /hr (autoRecalculateAttendance ย้อนหลัง 30 วันรวมวันนี้) ถ้าใครเปิด /hr
   * ตอนเช้าก่อนพนักงานตอกบัตรเข้า netWorkedMinutes ตอนนั้น = 0 ⇒ absence_minutes
   * เท่ากับความยาวกะเต็มวันทันที (พบจริง: พนักงานเข้า-ออกงานปกติทุกวัน แต่ระบบ
   * บันทึก "ขาดงาน 9 ชั่วโมง" เพราะ cron 08:00 น. อ่านค่านั้นไปก่อนที่ค่าจะถูก
   * คำนวณใหม่ให้ถูกต้องตอนสาย ๆ) เหตุการณ์ที่บันทึกไปแล้วแก้ไม่ได้อีก (กันซ้ำด้วย
   * unique key ถาวร) จึงต้องกันไว้ที่ต้นทาง — รอให้วันนั้น "จบ" ก่อนเสมอ แล้วให้
   * cron รอบถัดไป (พรุ่งนี้) ค่อยเก็บวันนี้แทน ตอนนั้นค่าควรนิ่งแล้วเพราะมีคน
   * เปิด /hr ระหว่างวันไปแล้วอย่างน้อยหนึ่งครั้งตามปกติ
   *
   * ใช้เวลาไทยตรง ๆ (ไม่ใช่ UTC ของเซิร์ฟเวอร์) เพราะกะทำงานอิงเวลาไทย —
   * ระบบนี้เป็น Thailand-only อยู่แล้ว (ปฏิทินพุทธ, cron อิงเวลาไทยใน docs/deploy.md)
   */
  const todayInThailand = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
  }).format(new Date());

  // เงื่อนไข (ฉบับปัจจุบัน, ไม่ใช่วันลา/วันหยุด) อยู่ในตัวฟังก์ชันแล้ว
  const rawRows = await prisma.$queryRaw<AttendanceRow[]>`
    SELECT subject AS user_id, work_date, late_minutes, absence_minutes, missing_punch
    FROM workforce.performance_attendance(
      ${from}::date, ${minLate}::int, ${ABSENCE_THRESHOLD_MINUTES}::int
    )
  `;
  const rows = rawRows.filter(
    (r) => new Date(r.work_date).toISOString().slice(0, 10) < todayInThailand,
  );

  if (rows.length === 0) return { scanned: 0, recorded: 0, recalculated };

  // subject คือ core.users.id — ยืนยันว่ายังมีอยู่จริงและอยู่บริษัทไหน
  // งานรายวันของทั้งแพลตฟอร์ม — orgId คือคำตอบที่ query นี้หา (แต่ละแถวลงบริษัทของคนนั้นเอง)
  // ไม่ใช่เงื่อนไขกรอง จึงห่อ crossOrg แบบ cron ตัวอื่น (ไม่งั้นการ์ด tenant เตือนทุกเช้า 08:00)
  const users = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.user_id))] } },
      select: { id: true, orgId: true },
    })
  );
  const orgByUser = new Map(users.map((u) => [u.id, u.orgId]));

  const events: PerformanceEventInput[] = [];
  for (const r of rows) {
    const orgId = orgByUser.get(r.user_id);
    if (!orgId) continue; // ผู้ใช้ถูกลบ หรือเป็นผู้ใช้ระดับแพลตฟอร์มที่ไม่สังกัดบริษัท

    // กรองอีกชั้นด้วยเกณฑ์ของบริษัทคนนั้นจริง ๆ
    const st = settingsByOrg.get(orgId);
    if (!st || !st.enabled) continue;

    const day = new Date(r.work_date).toISOString().slice(0, 10);

    const verdict = classifyAttendanceDay(r, st, day);
    if (verdict === "attendance_absent") {
      events.push({
        orgId,
        userId: r.user_id,
        source: "workforce",
        category: "attendance_absent",
        occurredAt: new Date(r.work_date),
        refType: "attendance_day",
        refId: `${r.user_id}:${day}`,
        note: `ขาดงาน ${Math.round(Number(r.absence_minutes) / 60)} ชั่วโมง`,
      });
      continue; // ขาดงานแล้วไม่ต้องหักเรื่องสายซ้ำอีก
    }

    if (verdict === "attendance_late") {
      events.push({
        orgId,
        userId: r.user_id,
        source: "workforce",
        category: "attendance_late",
        occurredAt: new Date(r.work_date),
        refType: "attendance_day",
        refId: `${r.user_id}:${day}`,
        note: `สาย ${Number(r.late_minutes)} นาที`,
      });
    }
  }

  const reactivated = await reactivateAutoRefunds(events);
  const recorded = await recordPerformanceEvents(events);
  const refunded = await refundNoLongerValidDocks(from, todayInThailand, settingsByOrg);
  return { scanned: rows.length, recorded: recorded + reactivated, refunded, recalculated };
}

/**
 * วันที่ระบบเคย "คืนคะแนนอัตโนมัติ" ไปแล้ว แต่ตอนนี้กลับมาเข้าเกณฑ์อีก (เช่น เปลี่ยนเกณฑ์ไปมา,
 * ใบลาถูกยกเลิกทีหลัง, แก้เวลากลับ) — หักใหม่ไม่ได้ เพราะรายการหักเดิมยังอยู่ (unique key) แค่มีรายการ
 * คืนหักล้างไว้ ⇒ ลบรายการคืนนั้นทิ้ง รายการหักเดิมจึงกลับมามีผล (เจอจริง: เกณฑ์ 0 → 16 → 0
 * คืนไป 9 ครั้งแล้วหักกลับไม่ได้)
 *
 * เฉพาะการคืนที่ระบบทำเอง (หมายเหตุขึ้นต้น "คืนคะแนน " จาก refundNoLongerValidDocks) — การยกเว้นที่
 * HR สั่ง (สคริปต์ excuse/reconcile: "ยกเว้น…", "แก้ไขค่าที่บันทึกผิด…") ไม่แตะเด็ดขาด
 * หมวดต้องตรงกัน (สายเดิม → วันนี้ยังสาย) ถ้าเปลี่ยนหมวด (สาย → ขาด) หมวดใหม่ถูกหักเป็นรายการใหม่เองอยู่แล้ว
 */
async function reactivateAutoRefunds(events: PerformanceEventInput[]): Promise<number> {
  if (events.length === 0) return 0;
  const originals = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.performanceEvent.findMany({
      where: {
        source: "workforce",
        refType: "attendance_day",
        OR: events.map((e) => ({ orgId: e.orgId, category: e.category, refId: e.refId })),
      },
      select: { id: true },
    })
  );
  if (originals.length === 0) return 0;
  const res = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.performanceEvent.deleteMany({
      where: {
        source: "workforce",
        refType: "attendance_day_correction",
        refId: { in: originals.map((o) => o.id) },
        note: { startsWith: "คืนคะแนน " },
        createdBy: null,
      },
    })
  );
  return res.count;
}

type OrgSettings = { enabled: boolean; lateThresholdMinutes: number; missingPunchCountsAsAbsent: boolean };

/**
 * ผ่อนผันการมาสายเหลือที่เดียว: นโยบายการลงเวลาของ HR (เช่น เข้า 08:00 ผ่อนผัน 15 นาที)
 * late_minutes ที่ได้มาหักผ่อนผันของกะออกแล้ว ⇒ สาย > 0 = สาย = หักคะแนน ตรงกับป้าย "สาย" ในหน้าลงเวลา
 *
 * เดิมมีช่อง "ผ่อนผันเพิ่ม" ในตั้งค่าคะแนนอีกชั้น (performance_settings.late_threshold_minutes)
 * บริษัทตั้งไว้ 16 ทับผ่อนผันของกะ 15 ⇒ เข้า 08:30 ยังไม่โดนหัก ทั้งที่หน้าลงเวลาขึ้น "สาย"
 * เอาช่องนั้นออกจากหน้าตั้งค่าแล้ว (ง่ายต่อคนใช้จริง: ตั้งผ่อนผันที่เดียว) ค่าที่เคยเก็บไว้ยังใช้กับ
 * วันก่อน LATE_GRACE_UNIFIED_FROM เท่านั้น — ไม่หักย้อนหลังเป็นกองทั้งเดือนตอนเปลี่ยนกติกา
 */
const LATE_GRACE_UNIFIED_FROM = "2026-09-30";

function lateThresholdFor(day: string, st: OrgSettings): number {
  return day >= LATE_GRACE_UNIFIED_FROM ? 0 : st.lateThresholdMinutes;
}

/** วันหนึ่งของคนหนึ่งควรโดนหักหมวดไหน ตามค่าลงเวลา "ตอนนี้" — ใช้ทั้งตอนหักและตอนคืน */
function classifyAttendanceDay(
  r: Pick<AttendanceRow, "late_minutes" | "absence_minutes" | "missing_punch">,
  st: OrgSettings,
  day: string,
): "attendance_absent" | "attendance_late" | null {
  // สแกนแค่ครั้งเดียว = ขาดงานเต็มกะในผลลงเวลา แต่จะนับเป็นขาดงานไหมแล้วแต่บริษัทตั้ง
  // ไม่นับ = ตกไปเช็คมาสายตามเวลาที่สแกนเข้าต่อ
  const absent =
    Number(r.absence_minutes) > ABSENCE_THRESHOLD_MINUTES &&
    (!r.missing_punch || st.missingPunchCountsAsAbsent);
  if (absent) return "attendance_absent";
  if (Number(r.late_minutes) > lateThresholdFor(day, st)) return "attendance_late";
  return null;
}

/**
 * คืนคะแนนมาสาย/ขาดงานที่หักไปแล้ว แต่ตอนนี้ไม่ควรหักแล้ว — เช่นใบลา (WFH,
 * ลาป่วย) ที่อนุมัติ **หลัง** cron บันทึกคะแนนของวันนั้นไปแล้ว หรือวันหยุดที่เพิ่ง
 * ใส่ย้อนหลัง เดิมเหตุการณ์ที่บันทึกแล้วไม่มีทางถูกแก้เอง (กันซ้ำด้วย unique key
 * ถาวร) ต้องรันสคริปต์ reconcile ด้วยมือ — ตอนนี้ cron ทำให้ทุกรอบ ในช่วง lookback
 *
 * คืนเฉพาะเมื่อ "รู้แน่" ว่าวันนั้นเปลี่ยนไปแล้ว: HR บอกว่าเป็นวันลา/วันหยุด/วันหยุด
 * ประจำ หรือเป็นวันทำงานที่ค่าปัจจุบันไม่เข้าเกณฑ์หมวดเดิมแล้ว — แถวที่หาไม่เจอ
 * (กำลังคำนวณใหม่, ยังไม่ผูกคน ฯลฯ) ข้ามไป ไม่เดา เพราะคืนแล้วหักกลับไม่ได้
 *
 * แก้ด้วยเหตุการณ์หักล้าง (attendance_day_correction, refId = id ของเดิม) แบบ
 * เดียวกับ packages/database/scripts/reconcile-wrong-attendance-events.ts —
 * unique key เดียวกัน รันซ้ำ/รันคู่กับสคริปต์ไม่คืนซ้ำ
 */
async function refundNoLongerValidDocks(
  from: Date,
  todayInThailand: string,
  settingsByOrg: Map<string, OrgSettings>,
): Promise<number> {
  const fromDay = from.toISOString().slice(0, 10);

  // สถานะวัน (WORKING/OFF/LEAVE/HOLIDAY/NO_SHIFT) — ฟังก์ชันนี้ติดตั้งด้วย
  // packages/workforce/db/sql/05-report-working-days.sql ถ้ายังไม่ได้ติดตั้ง
  // ข้ามขั้นคืนคะแนนไปทั้งหมด ไม่ให้ cron ทั้งตัวล้ม
  let states: { subject: string; work_date: Date; state: string }[];
  try {
    states = await prisma.$queryRaw`
      SELECT subject, work_date, state FROM workforce.report_working_days(${fromDay}::date, ${todayInThailand}::date)
    `;
  } catch (error) {
    console.warn("[attendance] skip refund — workforce.report_working_days unavailable:", error);
    return 0;
  }
  const stateByKey = new Map(
    states.map((r) => [`${r.subject}:${new Date(r.work_date).toISOString().slice(0, 10)}`, r.state]),
  );

  // ค่าดิบทุกวันทำงาน (เกณฑ์ -1 = ไม่กรอง) เพื่อตัดสินใหม่ด้วยเกณฑ์ปัจจุบันของบริษัท
  const current = await prisma.$queryRaw<AttendanceRow[]>`
    SELECT subject AS user_id, work_date, late_minutes, absence_minutes, missing_punch
    FROM workforce.performance_attendance(${fromDay}::date, -1::int, -1::int)
  `;
  const currentByKey = new Map(
    current.map((r) => [`${r.user_id}:${new Date(r.work_date).toISOString().slice(0, 10)}`, r]),
  );

  const originals = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.performanceEvent.findMany({
      where: {
        source: "workforce",
        category: { in: ["attendance_late", "attendance_absent"] },
        refType: "attendance_day",
        occurredAt: { gte: new Date(`${fromDay}T00:00:00.000Z`) },
      },
      select: { id: true, orgId: true, userId: true, category: true, points: true, occurredAt: true },
    }),
  );
  if (originals.length === 0) return 0;

  const corrected = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.performanceEvent.findMany({
      where: { source: "workforce", refType: "attendance_day_correction", refId: { in: originals.map((o) => o.id) } },
      select: { refId: true },
    }),
  );
  const correctedIds = new Set(corrected.map((c) => c.refId));

  const refunds: PerformanceEventInput[] = [];
  for (const o of originals) {
    if (correctedIds.has(o.id)) continue;
    const st = settingsByOrg.get(o.orgId);
    if (!st || !st.enabled) continue;
    const day = o.occurredAt.toISOString().slice(0, 10);
    if (day >= todayInThailand) continue;
    const key = `${o.userId}:${day}`;
    const state = stateByKey.get(key);

    let reason: string | null = null;
    if (state === "LEAVE" || state === "HOLIDAY" || state === "OFF") {
      reason = state === "LEAVE" ? "วันลาที่อนุมัติทีหลัง" : state === "HOLIDAY" ? "วันหยุดที่ใส่ทีหลัง" : "วันหยุดประจำที่ตั้งทีหลัง";
    } else if (state === "WORKING") {
      const row = currentByKey.get(key);
      if (!row) continue;
      if (classifyAttendanceDay(row, st, day) !== o.category) reason = "ค่าลงเวลาปัจจุบันไม่เข้าเกณฑ์แล้ว";
    }
    if (!reason) continue;

    refunds.push({
      orgId: o.orgId,
      userId: o.userId,
      source: "workforce",
      category: o.category as "attendance_absent" | "attendance_late",
      points: -Number(o.points),
      // วันเดียวกับเหตุการณ์เดิม — ไม่งั้นแต้มที่คืนไปโผล่ผิดเดือน
      occurredAt: o.occurredAt,
      refType: "attendance_day_correction",
      refId: o.id,
      note: `คืนคะแนน ${day}: ${reason}`,
    });
  }

  return recordPerformanceEvents(refunds);
}
