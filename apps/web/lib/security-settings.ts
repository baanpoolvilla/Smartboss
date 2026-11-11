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
  /* ── เพิ่ม 11/11/2569 — ค่าเริ่มต้นทุกตัว = พฤติกรรมเดิม บริษัทเปิดเองที่ หลังบ้าน › ความปลอดภัย ── */
  /** เปลี่ยนรหัสผ่านของตัวเองต้องกรอกรหัสปัจจุบันก่อน */
  requireCurrentPassword: boolean;
  /** ไม่แตะหน้าจอกี่นาทีแล้วออกจากระบบเอง · 0 = ไม่ใช้ */
  idleLogoutMinutes: number;
  /** รหัสบทบาทที่ต้องเปิดยืนยันตัวตน 2 ชั้น · ว่าง = ไม่บังคับใคร */
  twoFactorRoles: string[];
  /** IP ที่เปิดหน้าจัดการเงินเดือนได้ (ลงท้าย * ได้ เช่น 203.0.113.*) · ว่าง = ไม่จำกัด */
  salaryAllowedIps: string[];
  /** แจ้งเจ้าของบัญชีเมื่อเข้าสู่ระบบจากอุปกรณ์ที่ไม่เคยใช้ */
  notifyNewDevice: boolean;
}

/** ค่าเดิมก่อนทำให้ตั้งได้ — เปลี่ยนตรงนี้เท่ากับเปลี่ยนให้ทุกบริษัทที่ยังไม่ตั้งค่าเอง */
export const SECURITY_DEFAULTS: SecuritySettings = {
  maxFailedLogins: 5,
  lockMinutes: 15,
  passwordMinLength: 12,
  requireCurrentPassword: false,
  idleLogoutMinutes: 0,
  twoFactorRoles: [],
  salaryAllowedIps: [],
  notifyNewDevice: false,
};

/** ออกจากระบบเมื่อไม่ใช้งาน — 0 = ปิด ไม่งั้นต้องอยู่ในช่วงนี้ (สั้นกว่า 5 นาทีคือทำงานไม่ได้จริง) */
export const IDLE_LOGOUT_LIMITS = { min: 5, max: 720 } as const;

export function clampIdleLogout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(IDLE_LOGOUT_LIMITS.max, Math.max(IDLE_LOGOUT_LIMITS.min, Math.round(value)));
}

/** แยกรายการ IP ที่พิมพ์มา (คั่นด้วยบรรทัดใหม่/จุลภาค/เว้นวรรค) เหลือเฉพาะรูปแบบที่ใช้ได้ สูงสุด 50 รายการ */
export function parseIpList(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split(/[\s,;]+/)) {
    const v = raw.trim().toLowerCase();
    if (!v || v.length > 45) continue;
    if (/^[0-9a-f:.]+\*?$/.test(v) && /[.:]/.test(v)) out.add(v);
    if (out.size >= 50) break;
  }
  return [...out];
}

/** IP นี้อยู่ในรายการไหม — ตรงตัว หรือขึ้นต้นตรงกับรายการที่ลงท้าย * · รายการว่าง = ไม่จำกัด */
export function ipAllowed(list: readonly string[], ip: string | null | undefined): boolean {
  if (list.length === 0) return true;
  const v = (ip ?? "").trim().toLowerCase().replace(/^::ffff:/, "");
  if (!v) return false;
  return list.some((rule) => (rule.endsWith("*") ? v.startsWith(rule.slice(0, -1)) : v === rule));
}

/** ผู้ใช้ที่ถือบทบาทชุดนี้ ถูกบริษัทบังคับให้เปิดยืนยันตัวตน 2 ชั้นไหม */
export function twoFactorRequiredFor(settings: Pick<SecuritySettings, "twoFactorRoles">, roles: readonly string[]): boolean {
  return settings.twoFactorRoles.some((r) => roles.includes(r));
}

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
    requireCurrentPassword: row.requireCurrentPassword,
    idleLogoutMinutes: row.idleLogoutMinutes,
    twoFactorRoles: row.twoFactorRoles,
    salaryAllowedIps: row.salaryAllowedIps,
    notifyNewDevice: row.notifyNewDevice,
  };
}

/** บีบค่าให้อยู่ในขอบเขตที่ยอมรับได้ — ใช้ก่อนบันทึกเสมอ */
export function clampSecuritySetting(
  key: keyof typeof SECURITY_LIMITS,
  value: number
): number {
  const { min, max } = SECURITY_LIMITS[key];
  if (!Number.isFinite(value)) return SECURITY_DEFAULTS[key];
  return Math.min(max, Math.max(min, Math.round(value)));
}
