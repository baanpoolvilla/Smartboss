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

export interface DayOffQuota {
  /** วันหยุดต่อเดือนที่คนนี้ได้ในเดือนที่ขอ */
  daysPerMonth: number;
  /** true = ตั้งไว้เฉพาะคนนี้ในเดือนนี้ · false = ใช้ค่าตั้งต้นของบริษัท */
  perEmployee: boolean;
  /** ค่าตั้งต้นของบริษัท ไว้แสดงว่าคนนี้ต่างจากมาตรฐานตรงไหน */
  companyDefault: number;
  note: string;
}

/** ค่าตั้งต้นของบริษัท — `null` orgId คือผู้ใช้ระดับแพลตฟอร์มที่ไม่สังกัดบริษัท */
export async function loadCompanyDayOffDefault(orgId: string | null): Promise<number> {
  if (!orgId) return DEFAULT_DAYS_OFF_PER_MONTH;
  const row = await prisma.dayOffQuotaSetting.findUnique({ where: { orgId } });
  return row?.defaultDaysPerMonth ?? DEFAULT_DAYS_OFF_PER_MONTH;
}

/** โควตาของพนักงานหนึ่งคนในเดือนหนึ่งเดือน — ทับค่าบริษัทเมื่อมีแถวของเดือนนั้นโดยเฉพาะ */
export async function loadDayOffQuota(
  orgId: string | null,
  employmentId: string,
  month: string,
): Promise<DayOffQuota> {
  const companyDefault = await loadCompanyDayOffDefault(orgId);
  if (!orgId) {
    return { daysPerMonth: companyDefault, perEmployee: false, companyDefault, note: "" };
  }

  const row = await prisma.employeeDayOffQuota.findUnique({
    where: { orgId_employmentId_month: { orgId, employmentId, month } },
  });

  if (row === null) {
    return { daysPerMonth: companyDefault, perEmployee: false, companyDefault, note: "" };
  }
  return {
    daysPerMonth: row.daysPerMonth,
    perEmployee: true,
    companyDefault,
    note: row.note,
  };
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
