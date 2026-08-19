import { requireOrg } from "@smartboss/auth";
import { getAiInsightStatus, runAiInsightAnalysis } from "@/modules/report_task/lib/ai-insight/analyze";

export const dynamic = "force-dynamic";

/** Current cached state — settings, last result, this month's usage. No
 * OpenAI call happens here, so it's cheap to poll on every dashboard load. */
export async function GET() {
  const session = await requireOrg();
  const status = await getAiInsightStatus(session.orgId);
  return Response.json(status);
}

/** Triggers one real analysis round (aggregate → OpenAI → cache). Gated by
 * plan + the org's own toggle + monthly quota, all re-checked here — see
 * runAiInsightAnalysis's own comment on why this can't just trust the UI. */
export async function POST() {
  const session = await requireOrg();
  const outcome = await runAiInsightAnalysis(session.orgId);
  if (!outcome.ok) {
    const messages: Record<typeof outcome.reason, string> = {
      locked: "ฟีเจอร์นี้อยู่ในแพ็กเกจ Pro ขึ้นไป",
      disabled: "ปิดการวิเคราะห์ AI อยู่ — เปิดสวิตช์ก่อน",
      quota: "ใช้ครบโควตาการวิเคราะห์ของเดือนนี้แล้ว",
    };
    return Response.json({ error: messages[outcome.reason], reason: outcome.reason }, { status: 409 });
  }
  return Response.json(outcome.status);
}
