"use server";

import QRCode from "qrcode";
import { revalidatePath } from "next/cache";
import {
  audit,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  requireAuth,
  totpUri,
  verifyPassword,
  verifyTotp,
} from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { fieldEncryptionConfigured, openField, sealField } from "@smartboss/database/field-crypto";
import { linePushConfigured, pushLineText } from "@/lib/line";
import { notifyUser } from "@/modules/maintenance/data/notify";

/**
 * บัญชีของฉัน › ความปลอดภัย — ยืนยันตัวตน 2 ชั้น + อุปกรณ์ที่เข้าสู่ระบบอยู่
 * ทุก action ทำกับบัญชีของคนที่ล็อกอินอยู่เท่านั้น (ไม่รับ userId จากหน้าจอ)
 */
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function nowText(): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date());
}

/** แจ้งเจ้าของบัญชีทุกครั้งที่การตั้งค่าความปลอดภัยเปลี่ยน — ถ้าไม่ได้ทำเองจะรู้ตัวทันที */
async function tellOwner(user: { id: string; orgId: string | null; lineUserId: string | null }, title: string, body: string) {
  if (user.orgId) await notifyUser(user.orgId, user.id, { title, body, type: "account_security" }).catch(() => undefined);
  if (user.lineUserId && linePushConfigured()) await pushLineText(user.lineUserId, `SmartBoss: ${title}\n${body}`).catch(() => false);
}

async function me() {
  const session = await requireAuth();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  return { session, user };
}

/** ขั้นที่ 1 — สร้างกุญแจ (ยังไม่มีผลจนกว่าจะยืนยันรหัสแรกผ่าน) คืน QR + ตัวกุญแจให้พิมพ์เอง + ลิงก์เปิดแอป */
export async function startTwoFactorAction(): Promise<Result<{ secret: string; uri: string; qr: string }>> {
  const { user } = await me();
  if (user.totpEnabledAt) return { ok: false, error: "บัญชีนี้เปิดยืนยันตัวตน 2 ชั้นอยู่แล้ว" };
  if (!fieldEncryptionConfigured()) {
    // ไม่เก็บกุญแจ 2FA แบบไม่เข้ารหัสเด็ดขาด — ใครอ่านฐานข้อมูลได้จะสร้างรหัส 6 หลักของทุกคนได้
    return { ok: false, error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งกุญแจเข้ารหัสข้อมูล (FIELD_ENCRYPTION_KEY) — แจ้งผู้ดูแลระบบ" };
  }
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpSecret: sealField(secret), totpLastStep: null } });
  const uri = totpUri(secret, user.email);
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240 });
  return { ok: true, secret, uri, qr };
}

/** ขั้นที่ 2 — กรอกรหัส 6 หลักจากแอปเพื่อพิสูจน์ว่าตั้งสำเร็จ → เปิดใช้ + ออกรหัสสำรอง (แสดงครั้งเดียว) */
export async function confirmTwoFactorAction(code: string): Promise<Result<{ recoveryCodes: string[] }>> {
  const { user } = await me();
  if (user.totpEnabledAt) return { ok: false, error: "บัญชีนี้เปิดยืนยันตัวตน 2 ชั้นอยู่แล้ว" };
  const secret = user.totpSecret ? openField(user.totpSecret) : "";
  if (!secret) return { ok: false, error: "ยังไม่ได้เริ่มตั้งค่า — กด \"เริ่มตั้งค่า\" ใหม่อีกครั้ง" };
  const step = verifyTotp(secret, code);
  if (step === null) {
    return { ok: false, error: "รหัสไม่ตรง — ดูรหัสล่าสุดในแอป (เปลี่ยนทุก 30 วินาที) และเช็กว่าเวลาในมือถือตั้งอัตโนมัติ" };
  }
  const recoveryCodes = generateRecoveryCodes();
  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabledAt: new Date(), totpLastStep: step, totpRecoveryHashes: recoveryCodes.map(hashRecoveryCode) },
  });
  await audit({ userId: user.id, action: "TWO_FACTOR_ENABLED", targetId: user.id });
  await tellOwner(user, "เปิดยืนยันตัวตน 2 ชั้นแล้ว", `เปิดเมื่อ ${nowText()} — ครั้งต่อไปที่เข้าสู่ระบบด้วยอีเมล/รหัสผ่าน จะถามรหัส 6 หลักจากแอปด้วย`);
  revalidatePath("/account/security");
  return { ok: true, recoveryCodes };
}

/** ยกเลิกการตั้งค่าที่ค้างไว้ (สแกนแล้วไม่ได้ยืนยัน) */
export async function cancelTwoFactorSetupAction(): Promise<Result> {
  const { user } = await me();
  if (!user.totpEnabledAt) await prisma.user.update({ where: { id: user.id }, data: { totpSecret: null, totpLastStep: null } });
  return { ok: true };
}

/** ปิด 2 ชั้น — ต้องกรอกรหัสผ่านปัจจุบัน (คนที่หยิบเครื่องที่ล็อกอินค้างไว้ปิดเองไม่ได้) */
export async function disableTwoFactorAction(password: string): Promise<Result> {
  const { user } = await me();
  if (!user.totpEnabledAt) return { ok: false, error: "บัญชีนี้ไม่ได้เปิดยืนยันตัวตน 2 ชั้น" };
  if (!(await verifyPassword(user.passwordHash, password))) return { ok: false, error: "รหัสผ่านไม่ถูกต้อง" };
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: null, totpEnabledAt: null, totpRecoveryHashes: [], totpLastStep: null },
  });
  await audit({ userId: user.id, action: "TWO_FACTOR_DISABLED", targetId: user.id });
  await tellOwner(user, "ปิดยืนยันตัวตน 2 ชั้นแล้ว", `ปิดเมื่อ ${nowText()} — ถ้าคุณไม่ได้ปิดเอง เปลี่ยนรหัสผ่านและแจ้งผู้ดูแลทันที`);
  revalidatePath("/account/security");
  return { ok: true };
}

/** ออกรหัสสำรองชุดใหม่ (ชุดเดิมใช้ไม่ได้ทันที) — ต้องกรอกรหัสผ่านปัจจุบัน */
export async function regenerateRecoveryCodesAction(password: string): Promise<Result<{ recoveryCodes: string[] }>> {
  const { user } = await me();
  if (!user.totpEnabledAt) return { ok: false, error: "ต้องเปิดยืนยันตัวตน 2 ชั้นก่อน" };
  if (!(await verifyPassword(user.passwordHash, password))) return { ok: false, error: "รหัสผ่านไม่ถูกต้อง" };
  const recoveryCodes = generateRecoveryCodes();
  await prisma.user.update({ where: { id: user.id }, data: { totpRecoveryHashes: recoveryCodes.map(hashRecoveryCode) } });
  await audit({ userId: user.id, action: "TWO_FACTOR_RECOVERY_REGENERATED", targetId: user.id });
  revalidatePath("/account/security");
  return { ok: true, recoveryCodes };
}

/**
 * ใบที่เพิ่งหมุนไปไม่เกิน 5 นาทียัง "กู้" เป็นใบใหม่ได้ (packages/auth/refresh.ts — กันคำตอบหายกลางทาง)
 * ตอนเจ้าของสั่งเตะอุปกรณ์ออก ต้องปิดช่องนั้นด้วย ไม่งั้นเครื่องที่ถูกเตะอาจกู้ตัวเองกลับมาได้ในช่วงสั้น ๆ
 * (เครื่องที่ยังใช้อยู่ไม่กระทบ — มันถือใบล่าสุดซึ่งไม่ได้ถูกแตะ)
 */
async function closeRecoveryWindow(userId: string) {
  await prisma.refreshToken.updateMany({
    where: { userId, rotatedAt: { gte: new Date(Date.now() - 6 * 60_000) } },
    data: { rotatedAt: null },
  });
}

/**
 * ออกจากระบบอุปกรณ์เครื่องหนึ่ง — เครื่องนั้นต่ออายุไม่ได้อีก และหลุดภายในไม่เกิน 15 นาที
 * (อายุของบัตรผ่านใบที่ถืออยู่) · where มี userId เสมอ จึงตัดได้เฉพาะของตัวเอง
 */
export async function revokeSessionAction(tokenId: string): Promise<Result> {
  const session = await requireAuth();
  const done = await prisma.refreshToken.updateMany({
    where: { id: tokenId, userId: session.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (done.count === 0) return { ok: false, error: "ไม่พบอุปกรณ์นี้ (อาจออกจากระบบไปแล้ว)" };
  await closeRecoveryWindow(session.userId);
  await audit({ userId: session.userId, action: "SESSION_REVOKED", targetId: session.userId, detail: { tokenId } });
  revalidatePath("/account/security");
  return { ok: true };
}

/** ออกจากระบบทุกเครื่องยกเว้นเครื่องนี้ (`keepTokenId` = ใบของเครื่องที่กดอยู่ ไม่ส่งมา = ทุกเครื่อง) */
export async function revokeOtherSessionsAction(keepTokenId: string | null): Promise<Result<{ count: number }>> {
  const session = await requireAuth();
  const done = await prisma.refreshToken.updateMany({
    where: { userId: session.userId, revokedAt: null, ...(keepTokenId ? { id: { not: keepTokenId } } : {}) },
    data: { revokedAt: new Date() },
  });
  await closeRecoveryWindow(session.userId);
  await audit({ userId: session.userId, action: "SESSION_REVOKED", targetId: session.userId, detail: { others: done.count } });
  revalidatePath("/account/security");
  return { ok: true, count: done.count };
}
