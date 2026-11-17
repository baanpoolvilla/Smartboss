import "server-only";
import { prisma } from "@smartboss/database";
import { parsePeriodQuery } from "../lib/query";
import { round } from "../lib/rules";
import { toDbDate } from "../lib/periods";
import { listAccounts } from "./accounts";
import { loadAgentSettings } from "./agent-settings";
import { buildReport } from "./report";
import { loadAnalysisSettings, loadBenchmarks } from "./settings";

/**
 * ข้อมูลที่ AI บน n8n อ่านไปใช้ตัดสินใจ — ตัวเลขทุกตัวคิดโดย Rule Engine ชุดเดียวกับแดชบอร์ด
 * (AI ไม่ต้องคิดเลขเอง ใช้ *_status / rule_findings ได้เลย)
 */

async function resolveCustomer(orgId: string, raw: string | null): Promise<string> {
  const accounts = await listAccounts(orgId);
  const pick = raw ? accounts.find((a) => a.customerId === raw.replace(/\D/g, "")) : accounts[0];
  if (!pick) throw new Error(raw ? "ไม่พบบัญชีโฆษณานี้ในบริษัท" : "ยังไม่มีบัญชีโฆษณา — ส่งข้อมูลเข้ามาก่อน");
  return pick.customerId;
}

/** รายงานเต็มของช่วงเวลา: totals + daily + campaigns + ad_groups + keywords + wasted_terms + rule_findings */
export async function agentReport(orgId: string, sp: URLSearchParams) {
  const customerId = await resolveCustomer(orgId, sp.get("customer_id"));
  const { period, compare } = parsePeriodQuery(sp);
  const r = await buildReport(orgId, customerId, period, compare);
  return {
    account: r.account,
    period: r.period,
    compare: r.compare,
    goal: {
      primary: r.settings.primaryGoal,
      target_cpa: r.settings.targetCpa,
      avg_lead_value: r.settings.avgLeadValue,
      business_context: r.settings.businessContext,
    },
    benchmarks: r.benchmarks,
    rules: {
      min_clicks_to_judge: r.settings.minClicksToJudge,
      min_budget_util_to_scale: r.settings.minBudgetUtilToScale,
      budget_lost_is_limit: r.settings.budgetLostIsLimit,
      rank_lost_is_limit: r.settings.rankLostIsLimit,
      wasted_term_min_clicks: r.settings.wastedTermMinClicks,
    },
    totals: r.totals,
    daily: r.daily,
    campaigns: r.campaigns,
    ad_groups: r.adGroups,
    keywords: r.keywords,
    wasted_search_terms: r.wastedTerms,
    rule_findings: r.findings,
  };
}

/**
 * คำค้นหาจริงรวมตามช่วงเวลา — กรอง/เรียงได้ (ให้ AI ค้นเองแทนการได้แค่ 30 คำแรก)
 *   customer_id, from, to, campaign_id, ad_group_id, min_clicks, max_conversions, contains,
 *   sort = cost|clicks|impressions|conversions (มากไปน้อย), limit ≤ 500
 */
export async function agentSearchTerms(orgId: string, sp: URLSearchParams) {
  const customerId = await resolveCustomer(orgId, sp.get("customer_id"));
  const { period } = parsePeriodQuery(sp);
  const adGroupIds = sp.get("ad_group_id")
    ? [BigInt(sp.get("ad_group_id")!.replace(/\D/g, "") || "0")]
    : (
        await prisma.adsAdGroup.findMany({
          where: {
            orgId,
            ...(sp.get("campaign_id") ? { campaignId: BigInt(sp.get("campaign_id")!.replace(/\D/g, "") || "0") } : {}),
            campaignId: {
              in: (await prisma.adsCampaign.findMany({ where: { orgId, customerId }, select: { campaignId: true } })).map((c) => c.campaignId),
            },
          },
          select: { adGroupId: true },
        })
      ).map((a) => a.adGroupId);
  if (adGroupIds.length === 0) return { period, search_terms: [] };

  const contains = sp.get("contains")?.trim();
  const grouped = await prisma.adsSearchTermDaily.groupBy({
    by: ["adGroupId", "searchTerm"],
    where: {
      orgId,
      adGroupId: { in: adGroupIds },
      date: { gte: toDbDate(period.from), lte: toDbDate(period.to) },
      ...(contains ? { searchTerm: { contains, mode: "insensitive" as const } } : {}),
    },
    _sum: { impressions: true, clicks: true, cost: true, conversions: true },
  });
  const minClicks = Number(sp.get("min_clicks")) || 0;
  const maxConv = sp.get("max_conversions") != null ? Number(sp.get("max_conversions")) : null;
  const sort = ["cost", "clicks", "impressions", "conversions"].includes(sp.get("sort") ?? "") ? (sp.get("sort") as "cost") : "cost";
  const limit = Math.min(500, Math.max(1, Number(sp.get("limit")) || 100));
  const names = new Map(
    (await prisma.adsAdGroup.findMany({ where: { orgId, adGroupId: { in: [...new Set(grouped.map((g) => g.adGroupId))] } }, select: { adGroupId: true, name: true, campaignId: true } })).map(
      (a) => [String(a.adGroupId), a]
    )
  );
  const rows = grouped
    .map((g) => {
      const ag = names.get(String(g.adGroupId));
      return {
        search_term: g.searchTerm,
        ad_group_id: String(g.adGroupId),
        ad_group_name: ag?.name ?? null,
        campaign_id: ag ? String(ag.campaignId) : null,
        impressions: Number(g._sum.impressions ?? 0),
        clicks: Number(g._sum.clicks ?? 0),
        cost: round(Number(g._sum.cost ?? 0)),
        conversions: round(Number(g._sum.conversions ?? 0)),
      };
    })
    .filter((r) => r.clicks >= minClicks && (maxConv == null || r.conversions <= maxConv))
    .sort((a, b) => b[sort] - a[sort])
    .slice(0, limit);
  return { period, search_terms: rows };
}

/** เกณฑ์ KPI + กฎ + เป้าหมายธุรกิจ + นโยบายคำขอปรับ — ให้ AI รู้ว่าบริษัทนี้ตัดสินดี/แย่ยังไง และเสนออะไรได้ */
export async function agentSettingsView(orgId: string, sp: URLSearchParams) {
  const customerId = await resolveCustomer(orgId, sp.get("customer_id"));
  const [bm, analysis, agent] = await Promise.all([loadBenchmarks(orgId, customerId), loadAnalysisSettings(orgId, customerId), loadAgentSettings(orgId)]);
  return {
    customer_id: customerId,
    benchmarks: bm.map,
    rules: {
      min_clicks_to_judge: analysis.minClicksToJudge,
      min_budget_util_to_scale: analysis.minBudgetUtilToScale,
      budget_lost_is_limit: analysis.budgetLostIsLimit,
      rank_lost_is_limit: analysis.rankLostIsLimit,
      wasted_term_min_clicks: analysis.wastedTermMinClicks,
    },
    goal: {
      primary: analysis.primaryGoal,
      target_cpa: analysis.targetCpa,
      avg_lead_value: analysis.avgLeadValue,
      business_context: analysis.businessContext,
    },
    policy: {
      allowed_types: agent.allowedTypes,
      max_change_pct: agent.maxBudgetChangePct,
      proposal_expiry_hours: agent.proposalExpiryHours,
      self_approve: agent.selfApprove,
    },
  };
}
