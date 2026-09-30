import { adsRoute, readJson } from "@/modules/ads/data/access";
import { askReport } from "@/modules/ads/data/ai";
import { ADS_PERMS } from "@/modules/ads/permissions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/ads/ai-reports/{id}/ask — ถามคำถามเกี่ยวกับรายงาน (spec §6.5)
 * body: { question, history?: [{ q, a }] } — AI เห็นแค่ input/output ของรายงานนี้
 */
export const POST = adsRoute<{ id: string }>(ADS_PERMS.access, async (req, session, { id }) => {
  const body = await readJson(req);
  const history = Array.isArray(body.history)
    ? (body.history as { q?: unknown; a?: unknown }[])
        .filter((h) => typeof h?.q === "string" && typeof h?.a === "string")
        .map((h) => ({ q: h.q as string, a: h.a as string }))
    : [];
  return { answer: await askReport(session.orgId, id, String(body.question ?? ""), history) };
});
