import "server-only";
import { prisma } from "@smartboss/database";

/**
 * โควตาวันหยุดต่อเดือน
 *
 * บางคนได้หยุดเดือนละ 6 วัน บางคนได้ 4 — เป็นข้อตกลงจ้างงานรายคน ไม่ใช่
 * ตัวเลขเดียวของทั้งระบบ จึงเก็บเป็นค่าตั้งต้นระดับบริษัท แล้วให้ทับรายคนได้
 *
 * โควตารายคนผูกกับ "เดือน" ด้วยเสมอ ไม่ใช่ทับตลอดกาล — เดือนที่ตกลงกันให้
 * หยุดพิเศษ (เช่นปิดกิจการชั่วคราว) ไม่ควรทำให้เดือนอื่น ๆ ของคนนั้นเปลี่ยน
 * ตามไปด้วยโดยไม่ตั้งใจ ไม่ตั้งไว้ = ใช้ค่าตั้งต้นของบริษัทของเดือนนั้น
 *
 * ใช้ตอน "บันทึกวันหยุดของเดือนนี้" เท่านั้น — เครื่องคำนวณผลลงเวลาไม่รู้จัก
 * โควตานี้เลย มันเห็นแค่กะที่ผูกไว้ในแต่ละวันเหมือนเดิม ⇒ โควตาเป็นกติกา
 * ตอนกรอก ไม่ใช่กติกาตอนคิดเงิน
 */

/** ค่าที่ใช้เมื่อบริษัทยังไม่เคยตั้งค่า — เปลี่ยนตรงนี้เท่ากับเปลี่ยนให้ทุกบริษัทที่ยังไม่ตั้ง */
export const DEFAULT_DAYS_OFF_PER_MONTH = 4;

/**
 * ขอบเขตที่ยอมให้ตั้ง — บังคับฝั่งเซิร์ฟเวอร์ ไม่ใช่แค่ min/max ในฟอร์ม
 * เพราะคนที่ยิง server action ตรง ๆ ข้ามการตรวจฝั่งหน้าจอได้ทั้งหมด
 *
 * 0 = ไม่ให้หยุดเลย (ลูกจ้างรายวันบางแบบ) · 31 = ทั้งเดือน (คนที่พักงานอยู่)
 */
export const DAYS_OFF_LIMITS = { min: 0, max: 31 } as const;

/**
 * ตัวเลขที่ใช้จริงมาจากชั้นไหน — เรียงจากเจาะจงที่สุดไปกว้างที่สุด
 *
 * `month` ทับ `employee` ทับ `company` เสมอ
 */
export type DayOffQuotaSource = 'month' | 'employee' | 'company';

export interface DayOffQuota {
  /** วันหยุดต่อเดือนที่คนนี้ได้ในเดือนที่ขอ */
  daysPerMonth: number;
  /** ตัวเลขนี้มาจากชั้นไหน */
  source: DayOffQuotaSource;
  /** ค่าประจำของคนนี้ (ตามสัญญาจ้าง) — `null` = ยังไม่เคยตั้ง */
  employeeStanding: number | null;
  /** ค่าตั้งต้นของบริษัท ไว้แสดงว่าคนนี้ต่างจากมาตรฐานตรงไหน */
  companyDefault: number;
  /** หมายเหตุของชั้นที่ถูกใช้จริง */
  note: string;
}

/** ค่าตั้งต้นของบริษัท — `null` orgId คือผู้ใช้ระดับแพลตฟอร์มที่ไม่สังกัดบริษัท */
export async function loadCompanyDayOffDefault(orgId: string | null): Promise<number> {
  if (!orgId) return DEFAULT_DAYS_OFF_PER_MONTH;
  const row = await prisma.dayOffQuotaSetting.findUnique({ where: { orgId } });
  return row?.defaultDaysPerMonth ?? DEFAULT_DAYS_OFF_PER_MONTH;
}

/**
 * โควตาของพนักงานหนึ่งคนในเดือนหนึ่งเดือน — สามชั้น เจาะจงกว่าชนะ
 *
 * 1. แถวของ (คน, เดือน) — ข้อตกลงเฉพาะเดือนนั้น เช่นเดือนที่ปิดกิจการชั่วคราว
 * 2. ค่าประจำของคนนั้น — ข้อตกลงจ้างงาน (บางคน 4 บางคน 6) มีผลทุกเดือน
 * 3. ค่าตั้งต้นของบริษัท
 *
 * ชั้นที่ 2 เพิ่มทีหลัง: เดิมมีแต่ 1 กับ 3 ⇒ คนที่ตกลงกันว่าได้ 6 วันจะถูก
 * ตัดกลับไปเหลือค่ามาตรฐานของบริษัทเงียบ ๆ ทันทีที่ขึ้นเดือนใหม่
 */
export async function loadDayOffQuota(
  orgId: string | null,
  employmentId: string,
  month: string,
): Promise<DayOffQuota> {
  const companyDefault = await loadCompanyDayOffDefault(orgId);
  const fallback: DayOffQuota = {
    daysPerMonth: companyDefault,
    source: "company",
    employeeStanding: null,
    companyDefault,
    note: "",
  };
  if (!orgId) return fallback;

  const [monthRow, standingRow] = await Promise.all([
    prisma.employeeDayOffQuota.findUnique({
      where: { orgId_employmentId_month: { orgId, employmentId, month } },
    }),
    prisma.employeeDayOffQuotaDefault.findUnique({
      where: { orgId_employmentId: { orgId, employmentId } },
    }),
  ]);

  const employeeStanding = standingRow?.daysPerMonth ?? null;

  if (monthRow !== null) {
    return {
      daysPerMonth: monthRow.daysPerMonth,
      source: "month",
      employeeStanding,
      companyDefault,
      note: monthRow.note,
    };
  }
  if (standingRow !== null) {
    return {
      daysPerMonth: standingRow.daysPerMonth,
      source: "employee",
      employeeStanding,
      companyDefault,
      note: standingRow.note,
    };
  }
  return fallback;
}

/** ตั้งโควตารายคนของเดือนหนึ่ง — `daysPerMonth: null` คือกลับไปใช้ค่าตั้งต้นของบริษัทเฉพาะเดือนนั้น */
export async function saveDayOffQuota(
  orgId: string,
  employmentId: string,
  month: string,
  daysPerMonth: number | null,
  note: string,
  updatedBy: string,
): Promise<void> {
  if (daysPerMonth === null) {
    await prisma.employeeDayOffQuota.deleteMany({ where: { orgId, employmentId, month } });
    return;
  }

  await prisma.employeeDayOffQuota.upsert({
    where: { orgId_employmentId_month: { orgId, employmentId, month } },
    create: { orgId, employmentId, month, daysPerMonth, note, updatedBy },
    update: { daysPerMonth, note, updatedBy },
  });
}

/**
 * ตั้งโควตา "ประจำ" ของพนักงานหนึ่งคน — มีผลทุกเดือนจนกว่าจะแก้
 *
 * `daysPerMonth: null` = ลบข้อตกลงรายคนทิ้ง กลับไปใช้ค่าตั้งต้นของบริษัท
 * (ต่างจากการตั้ง 0 ซึ่งแปลว่า "ตกลงกันว่าไม่ได้หยุดเลย")
 */
export async function saveEmployeeDayOffStanding(
  orgId: string,
  employmentId: string,
  daysPerMonth: number | null,
  note: string,
  updatedBy: string,
): Promise<void> {
  if (daysPerMonth === null) {
    await prisma.employeeDayOffQuotaDefault.deleteMany({ where: { orgId, employmentId } });
    return;
  }

  await prisma.employeeDayOffQuotaDefault.upsert({
    where: { orgId_employmentId: { orgId, employmentId } },
    create: { orgId, employmentId, daysPerMonth, note, updatedBy },
    update: { daysPerMonth, note, updatedBy },
  });
}
