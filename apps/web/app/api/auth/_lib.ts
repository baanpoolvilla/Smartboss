import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  issueRefreshToken,
  loadAuthUser,
  setAccessCookie,
  setRefreshCookie,
  signAccessToken,
  audit,
  describeDevice,
  type AuthUser,
} from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { loadSecuritySettings } from "@/lib/security-settings";
import { notifyUser } from "@/modules/maintenance/data/notify";

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
 * อุปกรณ์นี้ (ชนิดเบราว์เซอร์ + ระบบ) บัญชีนี้เคยใช้เข้าระบบมาก่อนไหม — ดูจากใบ session ที่เคยออก
 * บัญชีที่ยังไม่เคยเข้าระบบเลย (เข้าครั้งแรก) ไม่นับว่าเป็น "อุปกรณ์ใหม่" ไม่งั้นทุกคนโดนเตือนตอนเริ่มใช้
 */
export async function isNewDevice(userId: string, userAgentValue: string): Promise<boolean> {
  const past = await prisma.refreshToken.findMany({
    where: { userId },
    select: { deviceInfo: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  if (past.length === 0) return false;
  const label = describeDevice(userAgentValue);
  return !past.some((t) => describeDevice(t.deviceInfo) === label);
}

/**
 * บันทึก + แจ้งเจ้าของบัญชีว่ามีการเข้าสู่ระบบจากอุปกรณ์ที่ไม่เคยใช้
 * บันทึกประวัติเสมอ · ส่งแจ้งเตือนเฉพาะบริษัทที่เปิดสวิตช์ (หลังบ้าน › ความปลอดภัย) — ค่าเริ่มต้นปิด
 */
export async function announceNewDevice(user: AuthUser, userAgentValue: string, ip: string | null): Promise<void> {
  const device = describeDevice(userAgentValue);
  await audit({ userId: user.id, action: "LOGIN_NEW_DEVICE", ip, userAgent: userAgentValue, detail: { device } });
  if (!user.orgId) return;
  const settings = await loadSecuritySettings(user.orgId).catch(() => null);
  if (!settings?.notifyNewDevice) return;
  const when = new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date());
  await notifyUser(user.orgId, user.id, {
    title: "มีการเข้าสู่ระบบจากอุปกรณ์ใหม่",
    body: `${device} เมื่อ ${when} — ถ้าไม่ใช่คุณ ไปที่ บัญชีของฉัน › ความปลอดภัย กดออกจากระบบอุปกรณ์นั้น แล้วเปลี่ยนรหัสผ่านทันที`,
    type: "account_security",
  }).catch(() => undefined);
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
  userAgentValue: string,
  ip?: string | null
): Promise<AuthUser | null> {
  const authUser = await loadAuthUser(userId);
  if (!authUser) return null;

  const accessToken = await signAccessToken({
    sub: authUser.id,
    orgId: authUser.orgId,
    roles: authUser.roles,
    permissions: authUser.permissions,
  });
  // ต้องเช็ก "เคยใช้อุปกรณ์นี้ไหม" ก่อนออกใบใหม่ ไม่งั้นจะเจอใบของตัวเองเสมอ
  const newDevice = await isNewDevice(authUser.id, userAgentValue);
  const refreshToken = await issueRefreshToken(authUser.id, userAgentValue, ip);
  if (newDevice) await announceNewDevice(authUser, userAgentValue, ip ?? null);

  const store = await cookies();
  setAccessCookie(store, accessToken);
  setRefreshCookie(store, refreshToken);

  return authUser;
}
