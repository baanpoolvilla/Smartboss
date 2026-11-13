import { requireOrg } from "@smartboss/auth";
import { loadShellNav } from "@/lib/nav";
import { askAssistant, assistantView, clearAssistant } from "@/modules/report_task/lib/boss-brief/assistant";

export const dynamic = "force-dynamic";

/**
 * ผู้ช่วย AI ลอยทุกหน้า (น้อง SmartBoss) — เฉพาะ Boss (CEO ของบริษัทที่ล็อกอิน) · ข้อมูลเฉพาะบริษัทนั้น
 * GET            แชทของฉัน + ใช้เงินไปเท่าไร (allowed=false = ไม่ต้องแสดงปุ่ม)
 * POST {action:"ask", question, path}  ถาม (AI ค้นข้อมูลบริษัทเอง ตอบพร้อมลิงก์)
 * POST {action:"clear"}                 ล้างแชทของฉัน
 */
const isBoss = (roles: string[]) => roles.includes("CEO");

export async function GET() {
  const session = await requireOrg();
  return Response.json(await assistantView(session.orgId, session.userId, isBoss(session.roles)));
}

export async function POST(req: Request) {
  const session = await requireOrg();
  if (!isBoss(session.roles)) return Response.json({ error: "เฉพาะ CEO" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.action === "clear") {
    await clearAssistant(session.orgId, session.userId);
    return Response.json({ ok: true, messages: [] });
  }
  if (body.action === "ask") {
    // หน้าที่ Boss เปิดได้ — จากเมนูของคนนี้เอง (พาไปได้เฉพาะหน้าที่มีสิทธิ์)
    const nav = await loadShellNav();
    const pages = (nav?.modules ?? []).flatMap((m) => m.menus.map((menu) => ({ label: `${m.name} › ${menu.label}`, path: menu.path })));
    const r = await askAssistant(session.orgId, session.userId, String(body.question ?? ""), String(body.path ?? ""), pages);
    return r.ok ? Response.json(r) : Response.json({ error: r.error }, { status: 400 });
  }
  return Response.json({ error: "ไม่รู้จักคำสั่ง" }, { status: 400 });
}
