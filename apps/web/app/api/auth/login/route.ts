import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@smartboss/database";
import {
  loginSchema,
  verifyPassword,
  signAccessToken,
  issueRefreshToken,
  setAccessCookie,
  setRefreshCookie,
  rateLimit,
  audit,
  loadAuthUser,
  checkSecondFactor,
} from "@smartboss/auth";
import { clientIp, userAgent, jsonError, isNewDevice, announceNewDevice } from "../_lib";
import { loadSecuritySettings } from "@/lib/security-settings";

export const runtime = "nodejs";

const GENERIC_INVALID = "อีเมลหรือรหัสผ่านไม่ถูกต้อง";

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ua = userAgent(req);

  // 1) Rate limit 10 ครั้ง/นาที ต่อ IP
  const rl = await rateLimit(`login:${ip}`, 10, 60);
  if (!rl.allowed) {
    return jsonError(
      "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่",
      429,
      { retryAfter: rl.resetSeconds }
    );
  }

  // Validate ด้วย Zod
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("รูปแบบข้อมูลไม่ถูกต้อง", 400);
  }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("ข้อมูลไม่ถูกต้อง", 400, {
      fields: parsed.error.flatten().fieldErrors,
    });
  }
  const { email, password, code } = parsed.data;

  // 2) หา user — ไม่พบ ตอบ 401 กลาง ๆ
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    await audit({ action: "LOGIN_FAILED", ip, userAgent: ua, detail: { email } });
    return jsonError(GENERIC_INVALID, 401);
  }

  // เกณฑ์ล็อกบัญชีตั้งได้รายบริษัท — อ่านหลังรู้ตัวผู้ใช้แล้วเท่านั้น
  // (ก่อนหน้านี้ยังไม่รู้ว่าอีเมลที่ส่งมาเป็นของบริษัทไหน)
  const security = await loadSecuritySettings(user.orgId);

  // 3) บัญชีถูกล็อก
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const waitMinutes = Math.ceil(
      (user.lockedUntil.getTime() - Date.now()) / 60_000
    );
    // บอกเวลาที่เหลือไปเลย — ปกปิดไว้ก็ไม่ได้กันอะไรเพิ่ม เพราะคนยิงสุ่มรหัส
    // รู้อยู่แล้วว่าโดนล็อก แต่คนที่พิมพ์ผิดจริงจะได้ไม่ต้องเดาว่าต้องรอนานแค่ไหน
    return jsonError(
      `บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ในอีก ${waitMinutes} นาที`,
      423,
      { retryAfterMinutes: waitMinutes }
    );
  }

  // 4) verify Argon2id
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    const failed = user.failedLogins + 1;
    const shouldLock = failed >= security.maxFailedLogins;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: shouldLock ? 0 : failed,
        lockedUntil: shouldLock
          ? new Date(Date.now() + security.lockMinutes * 60_000)
          : user.lockedUntil,
      },
    });
    await audit({
      userId: user.id,
      action: shouldLock ? "ACCOUNT_LOCKED" : "LOGIN_FAILED",
      ip,
      userAgent: ua,
      detail: { attempts: failed },
    });
    return jsonError(GENERIC_INVALID, 401);
  }

  /*
   * 4.5) ยืนยันตัวตน 2 ชั้น — เฉพาะบัญชีที่เปิดไว้ (บัญชีที่ไม่เปิด ผ่านตรงนี้เหมือนเดิมทุกอย่าง)
   * ยังไม่ส่งรหัสมา = ตอบ TOTP_REQUIRED ให้หน้าจอถามรหัส 6 หลัก (ไม่นับเป็นกรอกผิด เพราะรหัสผ่านถูกแล้ว)
   * รหัสผิด = นับรวมกับการกรอกรหัสผ่านผิด ล็อกบัญชีตามเกณฑ์เดียวกัน — กันคนที่ได้รหัสผ่านไปแล้วไล่เดา 6 หลัก
   */
  const second = await checkSecondFactor(user, code);
  if (!second.ok) {
    if (second.reason === "required") {
      return jsonError("กรอกรหัส 6 หลักจากแอป Authenticator", 401, { code: "TOTP_REQUIRED" });
    }
    const failed = user.failedLogins + 1;
    const shouldLock = failed >= security.maxFailedLogins;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: shouldLock ? 0 : failed,
        lockedUntil: shouldLock ? new Date(Date.now() + security.lockMinutes * 60_000) : user.lockedUntil,
      },
    });
    await audit({
      userId: user.id,
      action: shouldLock ? "ACCOUNT_LOCKED" : "TWO_FACTOR_FAILED",
      ip,
      userAgent: ua,
      detail: { attempts: failed, stage: "two_factor" },
    });
    return jsonError("รหัสยืนยันไม่ถูกต้องหรือหมดอายุแล้ว — ดูรหัสล่าสุดในแอปแล้วลองใหม่", 401, { code: "TOTP_INVALID" });
  }
  if (second.used === "recovery") {
    await audit({ userId: user.id, action: "TWO_FACTOR_RECOVERY_USED", ip, userAgent: ua, detail: { left: second.recoveryLeft } });
  }

  // 5) reset failedLogins
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null },
  });

  // 6-7) โหลด roles/permissions → access + refresh token
  const authUser = await loadAuthUser(user.id);
  if (!authUser) return jsonError(GENERIC_INVALID, 401);

  const accessToken = await signAccessToken({
    sub: authUser.id,
    orgId: authUser.orgId,
    roles: authUser.roles,
    permissions: authUser.permissions,
  });
  const newDevice = await isNewDevice(authUser.id, ua);
  const refreshToken = await issueRefreshToken(authUser.id, ua, ip);
  if (newDevice) await announceNewDevice(authUser, ua, ip);

  // 8) set cookies
  const store = await cookies();
  setAccessCookie(store, accessToken);
  setRefreshCookie(store, refreshToken);

  // 9) audit
  await audit({ userId: user.id, action: "LOGIN_SUCCESS", ip, userAgent: ua });

  // 10) response
  return NextResponse.json({
    user: {
      id: authUser.id,
      name: authUser.name,
      email: authUser.email,
      roles: authUser.roles,
    },
    // เข้าด้วยรหัสสำรอง — บอกจำนวนที่เหลือให้หน้าจอเตือน (ใช้แล้วหมดไปทีละรหัส)
    ...(second.used === "recovery" ? { recoveryLeft: second.recoveryLeft } : {}),
  });
}
