import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_REFRESH, hashToken } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

export const runtime = "nodejs";

/**
 * "เครื่องนี้คือใบไหน" — ให้หน้า บัญชีของฉัน › ความปลอดภัย ติดป้าย "เครื่องนี้" ในรายการอุปกรณ์
 * ต้องอยู่ใต้ /api/auth/refresh เพราะ cookie ของ refresh token ส่งมาเฉพาะ path นี้
 * คืนแค่ id ของแถว (ไม่ใช่ตัว token) และไม่หมุนใบ — อ่านอย่างเดียว
 */
export async function GET() {
  const raw = (await cookies()).get(COOKIE_REFRESH)?.value;
  if (!raw) return NextResponse.json({ id: null });
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    select: { id: true, revokedAt: true },
  });
  return NextResponse.json({ id: row && !row.revokedAt ? row.id : null }, { headers: { "Cache-Control": "no-store" } });
}
