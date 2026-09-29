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

/**
 * ต่ออายุ session ด้วย refresh token — คืน null = สำเร็จ, ไม่งั้นคืนข้อความเหตุผล
 * ใช้ทั้ง POST (หน้าเว็บที่เปิดอยู่ต่ออายุเงียบ ๆ — SessionRefresher) และ GET (proxy ส่ง
 * มาตอนเปิดหน้าใหม่ด้วย access token ที่หมดอายุแล้ว ดู proxy.ts)
 */
const GRACE = "grace" as const;

async function refreshSession(req: NextRequest): Promise<string | typeof GRACE | null> {
  const ip = clientIp(req);
  const ua = userAgent(req);
  const store = await cookies();

  const raw = store.get(COOKIE_REFRESH)?.value;
  if (!raw) return "ไม่พบ session";

  const result = await rotateRefreshToken(raw, ua);

  if (result.status === "reuse") {
    clearAuthCookies(store);
    await audit({
      userId: result.userId,
      action: "TOKEN_REUSE_DETECTED",
      ip,
      userAgent: ua,
    });
    return "session ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่";
  }

  if (result.status === "invalid") {
    clearAuthCookies(store);
    return "session หมดอายุ กรุณาเข้าสู่ระบบใหม่";
  }

  // อีกคำขอเพิ่งต่ออายุไปพร้อมกัน — cookie ชุดใหม่ถึงเบราว์เซอร์จากคำขอนั้นแล้ว
  // ห้ามล้าง cookie (จะไปลบของใหม่ทิ้ง) ถือว่าสำเร็จ
  if (result.status === "grace") return GRACE;

  // rotation สำเร็จ → ออก access ใหม่
  const authUser = await loadAuthUser(result.userId);
  if (!authUser) {
    clearAuthCookies(store);
    return "ไม่พบบัญชีผู้ใช้";
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
  return null;
}

export async function POST(req: NextRequest) {
  const error = await refreshSession(req);
  if (error && error !== GRACE) return jsonError(error, 401);
  return NextResponse.json({ ok: true });
}

/**
 * redirect ไปโดเมนที่ผู้ใช้เปิดอยู่จริง (Host / X-Forwarded-Host ที่ Caddy ส่งต่อมา)
 * ห้ามใช้ new URL(path, req.url) ตรง ๆ: บนเซิร์ฟเวอร์ Next รันหลัง Caddy ที่ 127.0.0.1:3000
 * req.url จึงอาจเป็น https://localhost:3000/... ผู้ใช้โดนพาไป localhost แล้วเข้าไม่ได้
 * (เกิดตอน access token หมดอายุแล้วเปิดแอป/กดแจ้งเตือน — login ใหม่แล้วหาย)
 * ใช้ path ล้วนเป็น Location ไม่ได้ — proxy ของ Next โยน "Invalid URL"
 */
function redirectTo(req: NextRequest, url: URL): NextResponse {
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  const host = first(req.headers.get("x-forwarded-host")) ?? first(req.headers.get("host"));
  const proto = first(req.headers.get("x-forwarded-proto")) ?? req.nextUrl.protocol.replace(":", "");
  const origin = host ? `${proto}://${host}` : req.nextUrl.origin;
  return NextResponse.redirect(new URL(url.pathname + url.search, origin));
}

/** ปลายทางภายในเว็บเท่านั้น — กัน open redirect (//evil.com, https://...) */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}

/**
 * GET ?next=/path — เปิดแอปใหม่หลังปิดไปนานกว่าอายุ access token (15 นาที) proxy ส่งมา
 * ที่นี่ก่อนแทนที่จะเด้งไปหน้า login ทันที: ต่ออายุด้วย refresh token (7 วัน) แล้วพากลับ
 * หน้าเดิม ต่ออายุไม่ได้ค่อยไปหน้า login ("เข้าใหม่ก็ต้องล็อกอินทุกครั้ง")
 *
 * refresh cookie ผูก path ไว้ที่ /api/auth/refresh เท่านั้น proxy จึงมองไม่เห็นเอง
 * ต้องพามาที่ path นี้ถึงจะอ่านได้
 */
export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const retried = req.nextUrl.searchParams.get("retry") === "1";
  const error = await refreshSession(req);
  if (!error) return redirectTo(req, new URL(next, req.url));
  // คำขอที่วิ่งพร้อมกันต่ออายุไปก่อน — ลองอีกรอบเดียว (ตอนนั้นเบราว์เซอร์ควรได้ cookie ใหม่แล้ว)
  // ถ้ายังไม่ได้อีก ไปหน้า login แทนที่จะวนไม่จบ
  if (error === GRACE && !retried) {
    const again = new URL("/api/auth/refresh", req.url);
    again.searchParams.set("next", next);
    again.searchParams.set("retry", "1");
    return redirectTo(req, again);
  }
  const login = new URL("/login", req.url);
  if (next !== "/") login.searchParams.set("next", next);
  return redirectTo(req, login);
}
