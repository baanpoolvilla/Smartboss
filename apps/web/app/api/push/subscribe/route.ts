import { requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { isWebPushConfigured, vapidPublicKey } from "@/lib/web-push";

export const dynamic = "force-dynamic";

/** กุญแจสาธารณะให้เบราว์เซอร์ใช้สมัครรับแจ้งเตือน — null = ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์ */
export async function GET() {
  await requireOrg();
  return Response.json({ publicKey: isWebPushConfigured() ? vapidPublicKey() : null });
}

/** บันทึกการสมัครของเครื่องนี้ ({ endpoint, keys: { p256dh, auth } } จาก PushSubscription.toJSON()) */
export async function POST(request: Request) {
  const session = await requireOrg();
  const body = await request.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : "";
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) {
    return Response.json({ error: "ข้อมูลการสมัครไม่ถูกต้อง" }, { status: 400 });
  }
  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? null;
  // endpoint เดิมแต่คนละคน (สลับบัญชีบนเครื่องเดียวกัน) → ย้ายเจ้าของมาเป็นคนปัจจุบัน
  await prisma.webPushSubscription.upsert({
    where: { endpoint },
    update: { userId: session.userId, orgId: session.orgId, p256dh, auth, userAgent },
    create: { endpoint, userId: session.userId, orgId: session.orgId, p256dh, auth, userAgent },
  });
  return Response.json({ ok: true });
}

/** เลิกรับแจ้งเตือนบนเครื่องนี้ */
export async function DELETE(request: Request) {
  const session = await requireOrg();
  const body = await request.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  if (endpoint) {
    await prisma.webPushSubscription.deleteMany({ where: { endpoint, userId: session.userId } });
  }
  return Response.json({ ok: true });
}
