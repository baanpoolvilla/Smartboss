import "server-only";
import { prisma } from "@smartboss/database";

/**
 * การตั้งค่าความปลอดภัยตอนเข้าสู่ระบบ — อ่านต่อบริษัท
 *
 * เดิมค่าพวกนี้เป็น constant ในไฟล์ login route ซึ่งบังคับให้ทุกบริษัทใช้
 * มาตรฐานเดียวกัน — ใช้ไม่ได้จริง เพราะบริบทต่างกันคนละเรื่อง:
 * สำนักงานที่ทุกคนมีเครื่องของตัวเองอยากได้เข้มกว่า 5 ครั้ง ส่วนโรงงานที่
 * ใช้เครื่องร่วมกันทั้งกะและพิมพ์บนจอสัมผัส การล็อก 15 นาทีเท่ากับหยุดงาน
 *
 * ไม่มีแถวในตาราง = ใช้ค่าใน DEFAULTS ที่นี่ ⇒ บริษัทที่ไม่เคยตั้งค่า
 * ได้พฤติกรรมเดิมทุกประการ ไม่ต้องไล่เติมแถวให้ทุกบริษัทตอน migrate
 */

export interface SecuritySettings {
  maxFailedLogins: number;
  lockMinutes: number;
  passwordMinLength: number;
}

/** ค่าเดิมก่อนทำให้ตั้งได้ — เปลี่ยนตรงนี้เท่ากับเปลี่ยนให้ทุกบริษัทที่ยังไม่ตั้งค่าเอง */
export const SECURITY_DEFAULTS: SecuritySettings = {
  maxFailedLogins: 5,
  lockMinutes: 15,
  passwordMinLength: 12,
};

/**
 * ขอบเขตที่ยอมให้ตั้ง — กันตั้งค่าที่ทำให้ระบบไม่ปลอดภัยหรือใช้งานไม่ได้
 *
 * ต้องบังคับฝั่งเซิร์ฟเวอร์ ไม่ใช่แค่ `min`/`max` ในฟอร์ม เพราะผู้ใช้ที่
 * แก้ HTML เองหรือยิง action ตรง ๆ จะข้ามการตรวจฝั่งหน้าจอได้ทั้งหมด
 */
export const SECURITY_LIMITS = {
  maxFailedLogins: { min: 3, max: 20 },
  lockMinutes: { min: 1, max: 1440 },
  passwordMinLength: { min: 8, max: 64 },
} as const;

/**
 * โหลดการตั้งค่าของบริษัทหนึ่ง
 *
 * @param orgId `null` สำหรับผู้ใช้ระดับแพลตฟอร์ม (SUPER_ADMIN ที่ไม่สังกัดบริษัท)
 *              — คนกลุ่มนี้ไม่มีบริษัทให้อ่านค่า จึงใช้ค่าเริ่มต้นเสมอ
 */
export async function loadSecuritySettings(
  orgId: string | null
): Promise<SecuritySettings> {
  if (!orgId) return SECURITY_DEFAULTS;

  const row = await prisma.securitySetting.findUnique({ where: { orgId } });
  if (!row) return SECURITY_DEFAULTS;

  return {
    maxFailedLogins: row.maxFailedLogins,
    lockMinutes: row.lockMinutes,
    passwordMinLength: row.passwordMinLength,
  };
}

/** บีบค่าให้อยู่ในขอบเขตที่ยอมรับได้ — ใช้ก่อนบันทึกเสมอ */
export function clampSecuritySetting(
  key: keyof SecuritySettings,
  value: number
): number {
  const { min, max } = SECURITY_LIMITS[key];
  if (!Number.isFinite(value)) return SECURITY_DEFAULTS[key];
  return Math.min(max, Math.max(min, Math.round(value)));
}
