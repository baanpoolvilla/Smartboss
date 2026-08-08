import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  COOKIE_REFRESH,
  rotateRefreshToken,
  signAccessToken,
  setAccessCookie,
  setRefreshCookie,
  clearAuthCookies,
  audit,
  loadAuthUser,
} from "@smartboss/auth";
import { clientIp, userAgent, jsonError } from "../_lib";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ua = userAgent(req);
  const store = await cookies();

  const raw = store.get(COOKIE_REFRESH)?.value;
  if (!raw) {
    return jsonError("ไม่พบ session", 401);
  }

  const result = await rotateRefreshToken(raw, ua);

  if (result.status === "reuse") {
    clearAuthCookies(store);
    await audit({
      userId: result.userId,
      action: "TOKEN_REUSE_DETECTED",
      ip,
      userAgent: ua,
    });
    return jsonError("session ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่", 401);
  }

  if (result.status === "invalid") {
    clearAuthCookies(store);
    return jsonError("session หมดอายุ กรุณาเข้าสู่ระบบใหม่", 401);
  }

  // rotation สำเร็จ → ออก access ใหม่
  const authUser = await loadAuthUser(result.userId);
  if (!authUser) {
    clearAuthCookies(store);
    return jsonError("ไม่พบบัญชีผู้ใช้", 401);
  }

  const accessToken = await signAccessToken({
    sub: authUser.id,
    orgId: authUser.orgId,
    roles: authUser.roles,
    permissions: authUser.permissions,
  });

  setAccessCookie(store, accessToken);
  setRefreshCookie(store, result.raw);

  await audit({ userId: authUser.id, action: "TOKEN_REFRESH", ip, userAgent: ua });

  return NextResponse.json({ ok: true });
}
