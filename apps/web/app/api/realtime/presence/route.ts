import { requireOrg } from "@smartboss/auth";

import { setTabActive } from "@/lib/realtime/server";

export const dynamic = "force-dynamic";

/**
 * แท็บบอกว่ากำลังดูหน้าเว็บอยู่ไหม — { visible: true, tab, endpoint } ส่งตอนหน้าเว็บขึ้นจอและทุก ~30 วิ,
 * { visible: false, tab } ส่งทันทีตอนย่อเบราว์เซอร์/สลับแอป/ล็อกจอ (sendBeacon)
 * endpoint = การสมัคร Web Push ของเครื่องนี้ ⇒ เซิร์ฟเวอร์ข้าม Push เฉพาะเครื่องที่ดูจออยู่ เครื่องอื่นยังเด้ง
 * (lib/realtime/server.ts viewingEndpoints) · แท็บโค้ดเก่าไม่ส่ง tab/endpoint ⇒ ใช้ "legacy"
 */
export async function POST(request: Request) {
  const session = await requireOrg();
  const body = await request.json().catch(() => ({}));
  const tab = typeof body?.tab === "string" && body.tab.length <= 64 ? body.tab : "legacy";
  const endpoint = typeof body?.endpoint === "string" && /^https:\/\//.test(body.endpoint) ? body.endpoint.slice(0, 1024) : "";
  setTabActive(session.userId, tab, endpoint, body?.visible === true);
  return new Response(null, { status: 204 });
}
