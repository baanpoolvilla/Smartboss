import "server-only";
import { prisma } from "@smartboss/database";

/**
 * วันหยุดตามสิทธิ์ต่อเดือน — แยกตาม "ประเภทวันหยุด" และแก้รายคนรายเดือนได้
 *
 * แต่ละบริษัทสร้างประเภทวันหยุดตามสิทธิ์เองได้ (Day-Off, หยุดชดเชย ฯลฯ ที่ ตั้งค่า › ประเภทการลา)
 * จำนวนวันมีสองชั้น เจาะจงกว่าชนะ:
 *   1. ของคนนี้ ในเดือนนี้ สำหรับประเภทนี้ — แถวในตารางนี้ (HR แก้ที่หน้าพนักงาน)
 *   2. วัน/เดือน ของประเภทนั้น — เก็บที่ตัวประเภทฝั่ง workforce (leave_types.monthly_quota_days)
 * ชั้นที่ 1 ใช้ต่อไปทุกเดือนจนกว่าจะแก้อีก (31 ต.ค. — "ตั้ง 4 ก็ 4 ตลอดจนกว่าจะมาแก้"): เดือนที่ไม่มีแถว
 * ใช้แถวล่าสุดก่อนหน้า · กด "กลับไปใช้ค่าของประเภท" = เก็บแถว RESET_TO_TYPE ให้เดือนนั้นเป็นต้นไปกลับไปใช้ชั้นที่ 2
 *
 * ใช้ตอนลงวันหยุดตามสิทธิ์ — ทั้งที่พนักงานลงเองในปฏิทินทีมและที่ HR ลงให้จากหน้าพนักงาน: เว็บส่งเลขของ
 * ชั้นที่ 1 (ถ้ามี) ไปให้ workforce ใช้แทนโควตาของประเภท (submitLeaveAction → monthly_quota_days_override)
 * เครื่องคำนวณผลลงเวลาไม่รู้จักตัวเลขนี้ ⇒ เป็นกติกาตอนลงวันหยุด ไม่ใช่กติกาตอนคิดเงิน
 *
 * ── ข้อมูลเดิม (ก่อนแยกตามประเภท) ──
 * แถวรายเดือนเดิมไม่มีประเภท (leave_type_id = '') และมี "ค่าประจำของคน" อีกตาราง — ทั้งสองยังใช้เป็น
 * ชั้นสำรองของทุกประเภทที่ยังไม่ได้ตั้งแยก ค่าที่ HR ตั้งไว้แล้วจึงไม่หายตอนอัปเดต · บันทึก/ล้างของประเภทใด
 * ในเดือนนั้นแล้ว แถวเดิมของเดือนนั้นถูกลบทิ้ง (ไม่งั้นกด "กลับไปใช้ค่าของประเภท" แล้วยังได้เลขเก่าอยู่)
 */

/**
 * ขอบเขตที่ยอมให้ตั้ง — บังคับฝั่งเซิร์ฟเวอร์ ไม่ใช่แค่ min/max ในฟอร์ม
 * เพราะคนที่ยิง server action ตรง ๆ ข้ามการตรวจฝั่งหน้าจอได้ทั้งหมด
 *
 * 0 = ไม่ให้หยุดเลย (ลูกจ้างรายวันบางแบบ) · 31 = ทั้งเดือน (คนที่พักงานอยู่)
 */
export const DAYS_OFF_LIMITS = { min: 0, max: 31 } as const;

/** leave_type_id ของแถวที่ตั้งไว้ก่อนแยกตามประเภท */
const LEGACY_TYPE = "";

/** days_per_month ของแถวที่บอกว่า "ตั้งแต่เดือนนี้ใช้ค่าของประเภท" — หยุดเลขที่ยกมาจากเดือนก่อน */
const RESET_TO_TYPE = -1;

/** ตัวเลขที่ใช้จริงมาจากไหน — `month` = แก้ไว้เฉพาะคน/เดือน/ประเภทนี้ · `legacy` = ค่าที่ตั้งไว้ก่อนแยกตามประเภท · `type` = ค่าของประเภท */
export type DayOffQuotaSource = "month" | "legacy" | "type";

export interface DayOffOverrides {
  /** `fromMonth` = เดือนที่ตั้งเลขนี้ไว้ (เดือนนี้หรือเดือนก่อนหน้าที่ยกมา) */
  byType: Map<string, { days: number; note: string; fromMonth: string }>;
  legacyMonth: { days: number; note: string } | null;
  legacyStanding: number | null;
}

const NO_OVERRIDES: DayOffOverrides = { byType: new Map(), legacyMonth: null, legacyStanding: null };

/** ทุกค่าที่ HR แก้ไว้ของคนหนึ่งในเดือนหนึ่ง — `null` orgId คือผู้ใช้ระดับแพลตฟอร์มที่ไม่สังกัดบริษัท */
export async function loadDayOffOverrides(
  orgId: string | null,
  employmentId: string,
  month: string,
): Promise<DayOffOverrides> {
  if (!orgId) return NO_OVERRIDES;
  const [rows, standing] = await Promise.all([
    // "YYYY-MM" เรียงแบบสตริงได้ — ล่าสุดก่อน แถวแรกของแต่ละประเภทคือเลขที่ใช้ในเดือนนี้
    prisma.employeeDayOffQuota.findMany({
      where: { orgId, employmentId, month: { lte: month } },
      orderBy: { month: "desc" },
    }),
    prisma.employeeDayOffQuotaDefault.findUnique({ where: { orgId_employmentId: { orgId, employmentId } } }),
  ]);
  const byType = new Map<string, { days: number; note: string; fromMonth: string }>();
  const seen = new Set<string>();
  let legacyMonth: DayOffOverrides["legacyMonth"] = null;
  for (const row of rows) {
    if (row.leaveTypeId === LEGACY_TYPE) {
      // แถวเดิมก่อนแยกประเภทยังมีผลแค่เดือนของมัน เหมือนเดิม
      if (row.month === month) legacyMonth = { days: row.daysPerMonth, note: row.note };
      continue;
    }
    if (seen.has(row.leaveTypeId)) continue;
    seen.add(row.leaveTypeId);
    if (row.daysPerMonth === RESET_TO_TYPE) continue;
    byType.set(row.leaveTypeId, { days: row.daysPerMonth, note: row.note, fromMonth: row.month });
  }
  return { byType, legacyMonth, legacyStanding: standing?.daysPerMonth ?? null };
}

/** เลขที่ HR แก้ไว้สำหรับประเภทนี้ — `null` = ไม่ได้แก้ ใช้ วัน/เดือน ของประเภท */
export function overrideDaysFor(overrides: DayOffOverrides, leaveTypeId: string): number | null {
  return overrides.byType.get(leaveTypeId)?.days ?? overrides.legacyMonth?.days ?? overrides.legacyStanding;
}

/** จำนวนวันที่ใช้จริงของประเภทหนึ่ง พร้อมที่มา — ให้หน้าจอบอกได้ว่าเลขนี้มาจากไหน */
export function resolveDayOffDays(
  overrides: DayOffOverrides,
  leaveTypeId: string,
  typeDefault: number,
): { days: number; source: DayOffQuotaSource; note: string; fromMonth: string | null } {
  const own = overrides.byType.get(leaveTypeId);
  if (own) return { days: own.days, source: "month", note: own.note, fromMonth: own.fromMonth };
  if (overrides.legacyMonth)
    return { days: overrides.legacyMonth.days, source: "legacy", note: overrides.legacyMonth.note, fromMonth: null };
  if (overrides.legacyStanding !== null) return { days: overrides.legacyStanding, source: "legacy", note: "", fromMonth: null };
  return { days: typeDefault, source: "type", note: "", fromMonth: null };
}

/**
 * ตั้งจำนวนวันของคนหนึ่ง ตั้งแต่เดือนหนึ่ง ประเภทหนึ่ง — `daysPerMonth: null` = กลับไปใช้ วัน/เดือน ของประเภท
 * (ถ้ามีเลขยกมาจากเดือนก่อน เก็บแถว RESET_TO_TYPE ไว้ตัดเลขนั้น ไม่งั้นแค่ลบแถวของเดือนนี้)
 * แถวเดิมที่ไม่มีประเภทของเดือนเดียวกันถูกลบไปด้วยทั้งสองกรณี (ดูหัวไฟล์)
 */
export async function saveDayOffQuota(
  orgId: string,
  employmentId: string,
  month: string,
  leaveTypeId: string,
  daysPerMonth: number | null,
  note: string,
  updatedBy: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.employeeDayOffQuota.deleteMany({ where: { orgId, employmentId, month, leaveTypeId: LEGACY_TYPE } });
    if (daysPerMonth === null) {
      await tx.employeeDayOffQuota.deleteMany({ where: { orgId, employmentId, month, leaveTypeId } });
      const earlier = await tx.employeeDayOffQuota.findFirst({
        where: { orgId, employmentId, leaveTypeId, month: { lt: month } },
        orderBy: { month: "desc" },
      });
      if (!earlier || earlier.daysPerMonth === RESET_TO_TYPE) return;
      daysPerMonth = RESET_TO_TYPE;
      note = "";
    }
    await tx.employeeDayOffQuota.upsert({
      where: { orgId_employmentId_month_leaveTypeId: { orgId, employmentId, month, leaveTypeId } },
      create: { orgId, employmentId, month, leaveTypeId, daysPerMonth, note, updatedBy },
      update: { daysPerMonth, note, updatedBy },
    });
  });
}

/** ล้าง "ค่าประจำของคน" ที่ตั้งไว้ก่อนเปลี่ยนเป็นรายเดือน — ตั้งใหม่ไม่ได้แล้ว เหลือแต่ทางล้าง */
export async function clearEmployeeDayOffStanding(orgId: string, employmentId: string): Promise<void> {
  await prisma.employeeDayOffQuotaDefault.deleteMany({ where: { orgId, employmentId } });
}
