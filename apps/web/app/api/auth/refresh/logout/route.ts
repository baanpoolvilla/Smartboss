import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  COOKIE_ACCESS,
  COOKIE_REFRESH,
  revokeRefreshToken,
  clearAuthCookies,
  verifyAccessToken,
  audit,
} from "@smartboss/auth";
import { clientIp, userAgent } from "../../_lib";

export const runtime = "nodejs";

/**
 * ออกจากระบบ — ตัวที่ **ตัด session ฝั่งเซิร์ฟเวอร์ได้จริง**
 *
 * cookie ของ refresh token ผูก path ไว้ที่ /api/auth/refresh เบราว์เซอร์จึงไม่ส่งมันไปที่
 * /api/auth/logout (ตัวเดิม) เลย — ตัวเดิมล้าง cookie ในเครื่องได้ แต่ใบ refresh ในฐานข้อมูล
 * ยังใช้ได้ต่อจนหมดอายุ 7 วัน (ใครคัดลอก cookie ไว้ก่อนก็ยังต่ออายุได้) ตัวนี้อยู่ใต้ path
 * เดียวกับ cookie จึงเห็นและเพิกถอนได้ · ตัวเดิมเก็บไว้ให้หน้าเว็บรุ่นเก่าที่ยังเปิดค้างอยู่
 *
 * body `{ "reason": "idle" }` = ออกเองเพราะไม่ได้ใช้งานตามที่บริษัทตั้ง (บันทึกประวัติแยกให้เห็น)
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ua = userAgent(req);
  const store = await cookies();

  const raw = store.get(COOKIE_REFRESH)?.value;
  if (raw) await revokeRefreshToken(raw);

  const access = store.get(COOKIE_ACCESS)?.value;
  const claims = access ? await verifyAccessToken(access) : null;

  clearAuthCookies(store);

  const body = (await req.json().catch(() => null)) as { reason?: string } | null;
  await audit({
    userId: claims?.sub ?? null,
    action: body?.reason === "idle" ? "SESSION_IDLE_LOGOUT" : "LOGOUT",
    ip,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true });
}
