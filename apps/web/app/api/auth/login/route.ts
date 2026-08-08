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
} from "@smartboss/auth";
import { clientIp, userAgent, jsonError } from "../_lib";

export const runtime = "nodejs";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
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
  const { email, password } = parsed.data;

  // 2) หา user — ไม่พบ ตอบ 401 กลาง ๆ
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    await audit({ action: "LOGIN_FAILED", ip, userAgent: ua, detail: { email } });
    return jsonError(GENERIC_INVALID, 401);
  }

  // 3) บัญชีถูกล็อก
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return jsonError(
      "บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ภายหลัง",
      423
    );
  }

  // 4) verify Argon2id
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    const failed = user.failedLogins + 1;
    const shouldLock = failed >= MAX_FAILED;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: shouldLock ? 0 : failed,
        lockedUntil: shouldLock
          ? new Date(Date.now() + LOCK_MINUTES * 60_000)
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
  const refreshToken = await issueRefreshToken(authUser.id, ua);

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
  });
}
