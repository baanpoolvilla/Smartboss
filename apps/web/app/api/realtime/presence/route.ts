import { requireOrg } from "@smartboss/auth";

import { setUserActive } from "@/lib/realtime/server";

export const dynamic = "force-dynamic";

/**
 * เครื่องบอกว่ากำลังดูหน้าเว็บอยู่ไหม — { visible: true } ส่งตอนหน้าเว็บขึ้นจอและทุก ~30 วิ,
 * { visible: false } ส่งทันทีตอนย่อเบราว์เซอร์/สลับแอป/ล็อกจอ (sendBeacon)
 * ใช้ตัดสินว่าใครต้องได้แจ้งเตือนเด้ง (lib/realtime/server.ts activeUserIds)
 */
export async function POST(request: Request) {
  const session = await requireOrg();
  const body = await request.json().catch(() => ({}));
  setUserActive(session.userId, body?.visible === true);
  return new Response(null, { status: 204 });
}
