import { prisma } from "@smartboss/database";
import { openField } from "@smartboss/database/field-crypto";
import { hashRecoveryCode, looksLikeRecoveryCode, verifyTotp } from "./totp";

export type SecondFactorResult =
  /** ไม่ได้เปิด 2 ชั้น หรือรหัสถูก */
  | { ok: true; used: "none" | "totp" | "recovery"; recoveryLeft?: number }
  /** เปิดไว้แต่ยังไม่ได้ส่งรหัสมา — ให้หน้าจอถามรหัส (ไม่นับเป็นกรอกผิด) */
  | { ok: false; reason: "required" }
  | { ok: false; reason: "invalid" };

interface TwoFactorUser {
  id: string;
  totpSecret: string | null;
  totpEnabledAt: Date | null;
  totpRecoveryHashes: string[];
  totpLastStep: number | null;
}

export function twoFactorEnabled(user: Pick<TwoFactorUser, "totpSecret" | "totpEnabledAt">): boolean {
  return !!user.totpEnabledAt && !!user.totpSecret;
}

/**
 * ด่านที่สองหลังรหัสผ่านถูกแล้ว — รับได้ทั้งรหัส 6 หลักจากแอป และรหัสสำรอง (ใช้ได้ครั้งเดียว)
 * รหัสที่ผ่านแล้วถูกจดไว้ (totpLastStep / ลบรหัสสำรองทิ้ง) จึงเอามาใช้ซ้ำไม่ได้
 */
export async function checkSecondFactor(user: TwoFactorUser, code: string | undefined): Promise<SecondFactorResult> {
  if (!twoFactorEnabled(user)) return { ok: true, used: "none" };
  const input = (code ?? "").trim();
  if (!input) return { ok: false, reason: "required" };

  if (looksLikeRecoveryCode(input)) {
    const hash = hashRecoveryCode(input);
    if (!user.totpRecoveryHashes.includes(hash)) return { ok: false, reason: "invalid" };
    const left = user.totpRecoveryHashes.filter((h) => h !== hash);
    await prisma.user.update({ where: { id: user.id }, data: { totpRecoveryHashes: left } });
    return { ok: true, used: "recovery", recoveryLeft: left.length };
  }

  const secret = openField(user.totpSecret!);
  if (!secret) return { ok: false, reason: "invalid" };
  const step = verifyTotp(secret, input, { afterStep: user.totpLastStep });
  if (step === null) return { ok: false, reason: "invalid" };
  await prisma.user.update({ where: { id: user.id }, data: { totpLastStep: step } });
  return { ok: true, used: "totp" };
}
