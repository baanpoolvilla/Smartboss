import { requireOrg } from "@smartboss/auth";
import { askBrief, briefViewFor, readBriefSettings, runBossBriefSweep, saveBriefSettings, startRangeBrief } from "@/modules/report_task/lib/boss-brief/server";
import { claimSweep, releaseSweep } from "@/modules/report_task/lib/server/sweep-throttle";

export const dynamic = "force-dynamic";

/**
 * การ์ดสรุปให้ Boss (12/11/2569) — เห็นเฉพาะ CEO
 * GET ?topicId=  สรุปของห้องนี้ + ตั้งค่า + ใช้เงินไปเท่าไรเดือนนี้ (พ่วงรอบตรวจ: เผื่อเครื่องไม่มี cron)
 * POST {action:"ask", briefId, question} | {action:"settings", ...} | {action:"toggleRoom", topicId, on}
 *      | {action:"range", topicId, from, to}  สรุปรวมหลายวัน — ทำเบื้องหลัง ตอบ {id, status: "pending"|"done"}
 */
const isBoss = (roles: string[]) => roles.includes("CEO");

export async function GET(req: Request) {
  const session = await requireOrg();
  const sp = new URL(req.url).searchParams;
  const topicId = sp.get("topicId") ?? "";
  const briefId = sp.get("briefId") ?? undefined;
  const boss = isBoss(session.roles);
  if (boss && claimSweep("boss-brief", session.orgId, 50_000)) {
    // ไม่รอผล — รอบตรวจเรียก AI ได้นานหลายสิบวินาที การ์ดจะเห็นผลรอบถัดไป
    void runBossBriefSweep(session.orgId)
      .catch((e) => console.error("[boss-brief] sweep on open", e))
      .finally(() => releaseSweep("boss-brief", session.orgId));
  }
  return Response.json(await briefViewFor(session.orgId, topicId, boss, briefId));
}

export async function POST(req: Request) {
  const session = await requireOrg();
  if (!isBoss(session.roles)) return Response.json({ error: "เฉพาะ CEO" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.action === "ask") {
    const r = await askBrief(session.orgId, String(body.briefId ?? ""), String(body.question ?? ""));
    return r.ok ? Response.json(r) : Response.json({ error: r.error }, { status: 400 });
  }
  if (body.action === "range") {
    const r = await startRangeBrief(session.orgId, String(body.topicId ?? ""), String(body.from ?? ""), String(body.to ?? ""));
    return r.ok ? Response.json(r) : Response.json({ error: r.error }, { status: 400 });
  }
  if (body.action === "settings") {
    const s = await saveBriefSettings(session.orgId, {
      monthlyCapThb: typeof body.monthlyCapThb === "number" ? body.monthlyCapThb : undefined,
      summaryModel: typeof body.summaryModel === "string" ? body.summaryModel : undefined,
      askModel: typeof body.askModel === "string" ? body.askModel : undefined,
      detailModel: typeof body.detailModel === "string" ? body.detailModel : undefined,
    });
    return Response.json({ settings: s });
  }
  if (body.action === "toggleRoom") {
    const topicId = String(body.topicId ?? "");
    const cur = await readBriefSettings(session.orgId);
    const topicIds = body.on ? [...cur.topicIds, topicId] : cur.topicIds.filter((t) => t !== topicId);
    const s = await saveBriefSettings(session.orgId, { topicIds, enabled: topicIds.length > 0 });
    return Response.json({ settings: s });
  }
  return Response.json({ error: "ไม่รู้จักคำสั่ง" }, { status: 400 });
}
