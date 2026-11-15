import { requireOrg, isSuperAdmin } from "@smartboss/auth";
import { readBriefSettings, saveBriefSettings } from "@/modules/report_task/lib/boss-brief/server";
import { aiSettingsView } from "@/modules/report_task/lib/boss-brief/ai-settings";
import { saveOrgBilling, syncActualCost, testAiConnection } from "@/modules/report_task/lib/boss-brief/ai-billing";

export const dynamic = "force-dynamic";

/**
 * หน้าตั้งค่า AI (15/11/2569) — Boss (CEO) ดู+แก้ · SUPER_ADMIN ดู + ตั้งการเชื่อม OpenAI ของบริษัทที่ล็อกอินอยู่
 * GET                                         ทุกอย่างในหน้า
 * POST {action:"settings", monthlyCapThb?, detailModel?, askModel?, assistantEnabled?}   (CEO)
 * POST {action:"rooms", topicIds}             ห้องที่ให้สรุป (CEO)
 * POST {action:"billing", projectId?, apiKey?, clearKey?} | {action:"test"} | {action:"sync"}   (SUPER_ADMIN)
 */
export async function GET() {
  const session = await requireOrg();
  const boss = session.roles.includes("CEO");
  const sa = isSuperAdmin(session);
  if (!boss && !sa) return Response.json({ error: "เฉพาะ Boss" }, { status: 403 });
  return Response.json(await aiSettingsView(session.orgId, { canEdit: boss, superAdmin: sa }));
}

export async function POST(req: Request) {
  const session = await requireOrg();
  const boss = session.roles.includes("CEO");
  const sa = isSuperAdmin(session);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const view = () => aiSettingsView(session.orgId, { canEdit: boss, superAdmin: sa });
  try {
    if (body.action === "settings" || body.action === "rooms") {
      if (!boss) return Response.json({ error: "เฉพาะ Boss" }, { status: 403 });
      if (body.action === "rooms") {
        const topicIds = Array.isArray(body.topicIds) ? body.topicIds.filter((x): x is string => typeof x === "string") : (await readBriefSettings(session.orgId)).topicIds;
        await saveBriefSettings(session.orgId, { topicIds, enabled: topicIds.length > 0 });
      } else {
        await saveBriefSettings(session.orgId, {
          monthlyCapThb: typeof body.monthlyCapThb === "number" ? body.monthlyCapThb : undefined,
          detailModel: typeof body.detailModel === "string" ? body.detailModel : undefined,
          askModel: typeof body.askModel === "string" ? body.askModel : undefined,
          assistantEnabled: typeof body.assistantEnabled === "boolean" ? body.assistantEnabled : undefined,
        });
      }
      return Response.json(await view());
    }
    if (body.action === "billing" || body.action === "test" || body.action === "sync") {
      if (!sa) return Response.json({ error: "เฉพาะผู้ดูแลระบบสูงสุด" }, { status: 403 });
      if (body.action === "test") return Response.json({ ...(await testAiConnection(session.orgId)), view: await view() });
      if (body.action === "sync") {
        const r = await syncActualCost(session.orgId);
        return Response.json({ ok: !!r, message: r ? `ดึงยอดจริงแล้ว $${r.usd.toFixed(2)}` : "ดึงไม่ได้ — ยังไม่มี OPENAI_ADMIN_KEY หรือ Project ID", view: await view() });
      }
      await saveOrgBilling(session.orgId, {
        projectId: typeof body.projectId === "string" ? body.projectId : undefined,
        apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
        clearKey: body.clearKey === true,
      });
      return Response.json(await view());
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  return Response.json({ error: "ไม่รู้จักคำสั่ง" }, { status: 400 });
}
