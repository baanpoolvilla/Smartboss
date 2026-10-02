import "server-only";
import { cookies } from "next/headers";
import { loadAuthUser, type AuthUser } from "./user";
import { COOKIE_ACCESS } from "./env";
import { verifyAccessToken, type AccessTokenClaims } from "./jwt";

export interface Session {
  userId: string;
  orgId: string | null;
  roles: string[];
  permissions: string[];
}

/** อ่าน session จาก access-token cookie (สำหรับ Server Component / Route Handler) */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(COOKIE_ACCESS)?.value;
  if (!token) return null;

  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  return liveSession(claims);
}

/**
 * บทบาท/สิทธิ์อ่านจาก DB ทุก request ไม่ใช่จาก claim ใน token
 *
 * token เก็บสิทธิ์ ณ ตอนที่ออก (อายุ 15 นาที) — แอดมินติ๊กสิทธิ์เพิ่มที่ /admin/roles
 * หรือย้ายบทบาทให้ใคร แล้วบอกให้ "ลองใหม่" คนนั้นยังโดนเด้งออกจากหน้าอยู่จนกว่า
 * token จะหมุน ทั้งที่เมนู (lib/nav.ts อ่านจาก DB อยู่แล้ว) ขึ้นให้กดแล้ว ⇒ ดูเหมือน
 * "เปิดสิทธิ์แล้วแต่ยังเข้าไม่ได้" · ขากลับก็เหมือนกัน: ถอดสิทธิ์/ปิดบัญชีแล้วต้องมีผลทันที
 *
 * token ยังเป็นตัวยืนยันว่า "ใคร" — ที่นี่แค่ไม่เชื่อว่าเขา "ทำอะไรได้" จากของที่แช่ไว้
 * จำผลไว้ 2 วินาทีต่อคน — หน้าเดียวเรียก getSession หลายที่ (layout + page) แล้วยิง
 * /api ตามอีกเป็นชุด จะได้ไม่ query ซ้ำทุกครั้ง · ช้าสุด 2 วินาทีหลังแก้สิทธิ์
 */
const LIVE_TTL_MS = 2000;
const liveUsers = new Map<string, { at: number; user: Promise<AuthUser | null> }>();

function loadLiveUser(userId: string): Promise<AuthUser | null> {
  const now = Date.now();
  const hit = liveUsers.get(userId);
  if (hit && now - hit.at < LIVE_TTL_MS) return hit.user;

  for (const [id, entry] of liveUsers) {
    if (now - entry.at >= LIVE_TTL_MS) liveUsers.delete(id);
  }
  const user = loadAuthUser(userId);
  liveUsers.set(userId, { at: now, user });
  // query ที่พังห้ามค้างอยู่ใน cache — request ถัดไปต้องได้ลองใหม่
  user.catch(() => liveUsers.delete(userId));
  return user;
}

async function liveSession(claims: AccessTokenClaims): Promise<Session | null> {
  let user;
  try {
    user = await loadLiveUser(claims.sub);
  } catch (err) {
    // DB ล่มชั่วคราว — ใช้ claim ใน token ต่อ ดีกว่าเตะทุกคนออกจากระบบ
    console.error("[auth] live permission lookup failed, using token claims:", err);
    return toSession(claims);
  }
  // บัญชีถูกลบ/ปิดไปแล้ว ⇒ ไม่มี session แม้ token ยังไม่หมดอายุ
  if (!user) return null;
  return {
    userId: user.id,
    orgId: user.orgId,
    roles: user.roles,
    permissions: user.permissions,
  };
}

function toSession(claims: AccessTokenClaims): Session {
  return {
    userId: claims.sub,
    orgId: claims.orgId,
    roles: claims.roles,
    permissions: claims.permissions,
  };
}
