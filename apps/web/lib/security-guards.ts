import "server-only";
import { getSession } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { loadSecuritySettings, twoFactorRequiredFor } from "./security-settings";

export interface SecurityGuardState {
  /** ไม่แตะหน้าจอกี่นาทีแล้วออกจากระบบเอง · 0 = ไม่ใช้ */
  idleMinutes: number;
  /** บริษัทบังคับให้บทบาทของคนนี้เปิดยืนยันตัวตน 2 ชั้น แต่เจ้าตัวยังไม่ได้เปิด */
  mustSetupTwoFactor: boolean;
}

const OFF: SecurityGuardState = { idleMinutes: 0, mustSetupTwoFactor: false };

/**
 * สิ่งที่บริษัทตั้งไว้ที่ หลังบ้าน › ความปลอดภัย ซึ่งมีผลกับผู้ใช้คนนี้ทุกหน้า
 * บริษัทที่ไม่เคยตั้งอะไร = ปิดทั้งคู่ (พฤติกรรมเดิม) และไม่ query ผู้ใช้เพิ่ม
 */
export async function loadSecurityGuards(): Promise<SecurityGuardState> {
  const session = await getSession();
  if (!session?.orgId) return OFF;
  const settings = await loadSecuritySettings(session.orgId).catch(() => null);
  if (!settings) return OFF;
  return {
    idleMinutes: settings.idleLogoutMinutes,
    mustSetupTwoFactor: await twoFactorMissing(session.userId, session.roles, settings),
  };
}

/** ถูกบังคับให้เปิด 2 ชั้นแต่ยังไม่เปิด — ใช้ทั้งตัวพาไปหน้าตั้งค่า และด่านหน้าเงินเดือน (ฝั่งเซิร์ฟเวอร์) */
export async function twoFactorMissing(
  userId: string,
  roles: readonly string[],
  settings: { twoFactorRoles: string[] }
): Promise<boolean> {
  if (!twoFactorRequiredFor(settings, roles)) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true } });
  return !user?.totpEnabledAt;
}
