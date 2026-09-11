import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@smartboss/database";
import { crossOrg } from "@smartboss/database/cross-org";
import { audit, rateLimit } from "@smartboss/auth";
import { lineLoginConfigured, verifyLineIdToken } from "@/lib/line";
import { clientIp, establishSession, jsonError, userAgent } from "../_lib";

export const runtime = "nodejs";

const bodySchema = z.object({
  /** ค่าจาก `liff.getIDToken()` — ต้องมี scope `openid` ไม่งั้นจะเป็น null */
  idToken: z.string().min(20).max(8000),
});

/**
 * เข้าสู่ระบบด้วยบัญชี LINE จาก Mini App
 *
 * ตอบ 404 `NOT_LINKED` เมื่อบัญชี LINE นี้ยังไม่เคยผูกกับพนักงานคนไหน —
 * ไม่ใช่ error แต่เป็นสถานะปกติของคนที่เพิ่งเปิดแอปครั้งแรก ฝั่งหน้าจอจะพา
 * ไปหน้าผูกบัญชี (POST /api/auth/line/link)
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ua = userAgent(req);

  // ยังไม่ได้ตั้ง env = ฟีเจอร์ปิดอยู่ ไม่ใช่ระบบพัง (สเปคข้อ 9.1)
  if (!lineLoginConfigured()) {
    return jsonError("ยังไม่ได้เปิดใช้การเข้าสู่ระบบผ่าน LINE", 503, {
      code: "LINE_NOT_CONFIGURED",
    });
  }

  const rl = await rateLimit(`line-login:${ip}`, 20, 60);
  if (!rl.allowed) {
    return jsonError("พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่", 429, {
      retryAfter: rl.resetSeconds,
    });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError("รูปแบบข้อมูลไม่ถูกต้อง", 400);
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return jsonError("ข้อมูลไม่ถูกต้อง", 400);

  const verified = await verifyLineIdToken(parsed.data.idToken);
  if (!verified.ok) {
    if (verified.reason === "unreachable") {
      return jsonError("ติดต่อ LINE ไม่ได้ กรุณาลองใหม่อีกครั้ง", 502);
    }
    await audit({ action: "LINE_LOGIN_FAILED", ip, userAgent: ua });
    return jsonError("ยืนยันตัวตนกับ LINE ไม่สำเร็จ", 401);
  }

  const { userId: lineUserId } = verified.identity;

  const user = await crossOrg("auth:lookup-by-globally-unique-external-id", () =>
    prisma.user.findFirst({
      where: { lineUserId, isActive: true },
      select: { id: true },
    })
  );

  if (!user) {
    return jsonError("บัญชี LINE นี้ยังไม่ได้ผูกกับพนักงานคนไหน", 404, {
      code: "NOT_LINKED",
    });
  }

  const authUser = await establishSession(user.id, ua);
  if (!authUser) return jsonError("บัญชีนี้ถูกปิดใช้งาน", 401);

  await audit({ userId: user.id, action: "LOGIN_SUCCESS_LINE", ip, userAgent: ua });

  return NextResponse.json({
    user: { id: authUser.id, name: authUser.name, avatarUrl: authUser.avatarUrl },
  });
}
