import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@smartboss/database";
import { audit, rateLimit, verifyPassword } from "@smartboss/auth";
import { lineLoginConfigured, verifyLineIdToken } from "@/lib/line";
import { loadSecuritySettings } from "@/lib/security-settings";
import { clientIp, establishSession, jsonError, userAgent } from "../../_lib";

export const runtime = "nodejs";

const bodySchema = z.object({
  idToken: z.string().min(20).max(8000),
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(200),
});

const GENERIC_INVALID = "อีเมลหรือรหัสผ่านไม่ถูกต้อง";

/**
 * ผูกบัญชี LINE เข้ากับพนักงาน — ทำครั้งเดียวตอนเปิดแอปครั้งแรก
 *
 * ยืนยันตัวตนสองชั้นพร้อมกัน: ID token จาก LINE (ว่าเป็นเจ้าของบัญชี LINE จริง)
 * + อีเมล/รหัสผ่านของ Smartboss (ว่าเป็นเจ้าของบัญชีพนักงานจริง) ⇒ ผูกได้เฉพาะ
 * คนที่ถือทั้งสองอย่าง
 *
 * ทำเสร็จแล้วออกเซสชันให้เลย ผู้ใช้จะได้ไม่ต้องกดเข้าสู่ระบบซ้ำอีกรอบ
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ua = userAgent(req);

  if (!lineLoginConfigured()) {
    return jsonError("ยังไม่ได้เปิดใช้การเข้าสู่ระบบผ่าน LINE", 503, {
      code: "LINE_NOT_CONFIGURED",
    });
  }

  // เข้มกว่าการล็อกอินปกติเพราะ endpoint นี้ *เปลี่ยนความเป็นเจ้าของบัญชี*
  const rl = await rateLimit(`line-link:${ip}`, 10, 60);
  if (!rl.allowed) {
    return jsonError("พยายามผูกบัญชีบ่อยเกินไป กรุณารอสักครู่", 429, {
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
    return jsonError("ยืนยันตัวตนกับ LINE ไม่สำเร็จ", 401);
  }
  const lineUserId = verified.identity.userId;

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });
  if (!user || !user.isActive) {
    await audit({ action: "LINE_LINK_FAILED", ip, userAgent: ua });
    return jsonError(GENERIC_INVALID, 401);
  }

  const security = await loadSecuritySettings(user.orgId);

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const waitMinutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    return jsonError(
      `บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ในอีก ${waitMinutes} นาที`,
      423,
      { retryAfterMinutes: waitMinutes }
    );
  }

  const valid = await verifyPassword(user.passwordHash, parsed.data.password);
  if (!valid) {
    // นับรวมกับการล็อกอินปกติ ไม่งั้นทางนี้จะกลายเป็นช่องเดารหัสที่ไม่โดนล็อก
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
      action: shouldLock ? "ACCOUNT_LOCKED" : "LINE_LINK_FAILED",
      ip,
      userAgent: ua,
      detail: { attempts: failed },
    });
    return jsonError(GENERIC_INVALID, 401);
  }

  // บัญชี LINE ใบนี้ถูกใช้ผูกกับพนักงานคนอื่นไปแล้วหรือยัง
  const taken = await prisma.user.findFirst({
    where: { lineUserId, NOT: { id: user.id } },
    select: { id: true },
  });
  if (taken) {
    await audit({
      userId: user.id,
      action: "LINE_LINK_CONFLICT",
      ip,
      userAgent: ua,
      detail: { conflictUserId: taken.id },
    });
    return jsonError(
      "บัญชี LINE นี้ถูกผูกกับพนักงานคนอื่นไปแล้ว — แจ้งฝ่ายบุคคลให้ยกเลิกการผูกเดิมก่อน",
      409,
      { code: "LINE_ALREADY_LINKED" }
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lineUserId, failedLogins: 0, lockedUntil: null },
  });

  // เปลี่ยนบัญชี LINE ที่ผูกอยู่ = อาจเป็นการยึดบัญชี ต้องเห็นย้อนหลังได้เสมอ
  // ไม่ใช่ทับเงียบ ๆ (ค่าเดิมอาจเป็นของเครื่องที่หายไป)
  await audit({
    userId: user.id,
    action: user.lineUserId === null ? "LINE_LINKED" : "LINE_RELINKED",
    ip,
    userAgent: ua,
    detail: { hadPreviousLink: user.lineUserId !== null },
  });

  const authUser = await establishSession(user.id, ua);
  if (!authUser) return jsonError("บัญชีนี้ถูกปิดใช้งาน", 401);

  return NextResponse.json({
    user: { id: authUser.id, name: authUser.name, avatarUrl: authUser.avatarUrl },
  });
}
