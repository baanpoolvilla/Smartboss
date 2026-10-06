import "server-only";
import { prisma } from "@smartboss/database";

/**
 * วันหยุดตามสิทธิ์ต่อเดือน — แยกตาม "ประเภทวันหยุด" และแก้รายคนรายเดือนได้
 *
 * แต่ละบริษัทสร้างประเภทวันหยุดตามสิทธิ์เองได้ (Day-Off, หยุดชดเชย ฯลฯ ที่ ตั้งค่า › ประเภทการลา)
 * จำนวนวันมีสองชั้น เจาะจงกว่าชนะ:
 *   1. ของคนนี้ ในเดือนนี้ สำหรับประเภทนี้ — แถวในตารางนี้ (HR แก้ที่หน้าพนักงาน)
 *   2. วัน/เดือน ของประเภทนั้น — เก็บที่ตัวประเภทฝั่ง workforce (leave_types.monthly_quota_days)
 * เดือนที่ไม่ได้มาแก้ = ใช้ชั้นที่ 2 เสมอ ("เอาเป็นเดือน ๆ ไป แต่ถ้าไม่มาแก้ของเดือนนั้นก็เป็นค่าเดิม")
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

/** ตัวเลขที่ใช้จริงมาจากไหน — `month` = แก้ไว้เฉพาะคน/เดือน/ประเภทนี้ · `legacy` = ค่าที่ตั้งไว้ก่อนแยกตามประเภท · `type` = ค่าของประเภท */
export type DayOffQuotaSource = "month" | "legacy" | "type";

export interface DayOffOverrides {
  byType: Map<string, { days: number; note: string }>;
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
    prisma.employeeDayOffQuota.findMany({ where: { orgId, employmentId, month } }),
    prisma.employeeDayOffQuotaDefault.findUnique({ where: { orgId_employmentId: { orgId, employmentId } } }),
  ]);
  const byType = new Map<string, { days: number; note: string }>();
  let legacyMonth: DayOffOverrides["legacyMonth"] = null;
  for (const row of rows) {
    const value = { days: row.daysPerMonth, note: row.note };
    if (row.leaveTypeId === LEGACY_TYPE) legacyMonth = value;
    else byType.set(row.leaveTypeId, value);
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
): { days: number; source: DayOffQuotaSource; note: string } {
  const own = overrides.byType.get(leaveTypeId);
  if (own) return { days: own.days, source: "month", note: own.note };
  if (overrides.legacyMonth) return { days: overrides.legacyMonth.days, source: "legacy", note: overrides.legacyMonth.note };
  if (overrides.legacyStanding !== null) return { days: overrides.legacyStanding, source: "legacy", note: "" };
  return { days: typeDefault, source: "type", note: "" };
}

/**
 * ตั้งจำนวนวันของคนหนึ่ง เดือนหนึ่ง ประเภทหนึ่ง — `daysPerMonth: null` = กลับไปใช้ วัน/เดือน ของประเภท
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
      return;
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
