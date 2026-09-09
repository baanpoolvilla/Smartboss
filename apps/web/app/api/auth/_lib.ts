import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  issueRefreshToken,
  loadAuthUser,
  setAccessCookie,
  setRefreshCookie,
  signAccessToken,
  type AuthUser,
} from "@smartboss/auth";

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function userAgent(req: NextRequest): string {
  return req.headers.get("user-agent") ?? "unknown";
}

export function jsonError(
  message: string,
  status: number,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * ออก access + refresh token แล้ววาง cookie ให้เรียบร้อย
 *
 * แยกออกมาเพราะตอนนี้มีทางเข้าระบบสองทางที่ต้องได้เซสชันแบบ *เดียวกันเป๊ะ*:
 * อีเมล/รหัสผ่าน กับ LINE Mini App · ถ้าปล่อยให้แต่ละทางประกอบ claim เอง
 * วันหนึ่งจะหลุดกันแล้วกลายเป็นว่าเข้าทางหนึ่งได้สิทธิ์ไม่ครบเงียบ ๆ
 *
 * token ที่ได้ยังเป็นใบเดียวกับที่ workforce API ตรวจ (AUTH_PROVIDER=smartboss)
 * ⇒ ล็อกอินผ่าน LINE แล้วยิง /me/* ของ workforce ได้ทันทีโดยไม่ต้องทำสิทธิ์ชุดที่สอง
 */
export async function establishSession(
  userId: string,
  userAgentValue: string
): Promise<AuthUser | null> {
  const authUser = await loadAuthUser(userId);
  if (!authUser) return null;

  const accessToken = await signAccessToken({
    sub: authUser.id,
    orgId: authUser.orgId,
    roles: authUser.roles,
    permissions: authUser.permissions,
  });
  const refreshToken = await issueRefreshToken(authUser.id, userAgentValue);

  const store = await cookies();
  setAccessCookie(store, accessToken);
  setRefreshCookie(store, refreshToken);

  return authUser;
}
