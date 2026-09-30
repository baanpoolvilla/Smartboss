import "server-only";
import { prisma } from "@smartboss/database";
import {
  aggregate,
  changePct,
  evaluate,
  ruleFindings,
  wastedSearchTerms,
  type BenchmarkMap,
  type DailyRaw,
  type Evaluated,
  type RuleFinding,
} from "../lib/rules";
import { addDays, daysInPeriod, fromDbDate, toDbDate, type Period } from "../lib/periods";
import { getAccount, type AdsAccountRow } from "./accounts";
import { loadAnalysisSettings, loadBenchmarks, type AnalysisSettings } from "./settings";

/**
 * ประกอบรายงานจากฐานข้อมูล (spec §1 ขั้น 3) — อ่านจากตาราง ads_* อย่างเดียว
 * ไม่เรียก API ซ้ำ ทุกหน้า/REST/อีเมล/AI/ส่งออก ใช้ฟังก์ชันนี้ตัวเดียว ตัวเลขจึงตรงกันทุกที่
 */

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const optNum = (v: unknown): number | null => (v == null ? null : Number(v));

export interface CampaignRow extends Evaluated {
  id: string;
  name: string | null;
  status: string | null;
  channel_type: string | null;
  daily_budget: number | null;
  cost_change_pct: number | null;
  conversions_change_pct: number | null;
  cpa_change_pct: number | null;
}

export interface AdGroupRow extends Evaluated {
  id: string;
  campaign_id: string;
  campaign_name: string | null;
  name: string | null;
  status: string | null;
}

export interface KeywordRow extends Evaluated {
  id: string;
  ad_group_id: string;
  text: string | null;
  match_type: string | null;
}

export interface DailyPoint {
  date: string;
  cost: number;
  clicks: number;
  impressions: number;
  conversions: number;
}

export type TotalsWithChange = Evaluated & {
  change: Partial<Record<"cost" | "clicks" | "impressions" | "conversions" | "ctr" | "cpc" | "conv_rate" | "cpa" | "roas", number | null>>;
};

export interface ReportData {
  account: AdsAccountRow;
  period: Period & { days: number };
  compare: Period | null;
  benchmarks: BenchmarkMap;
  settings: AnalysisSettings;
  totals: TotalsWithChange;
  daily: DailyPoint[];
  campaigns: CampaignRow[];
  adGroups: AdGroupRow[];
  keywords: KeywordRow[];
  wastedTerms: ReturnType<typeof wastedSearchTerms>;
  findings: RuleFinding[];
}

function toRaw(r: {
  date: Date;
  impressions: bigint | null;
  clicks: bigint | null;
  cost: unknown;
  conversions: unknown;
  conversionsValue?: unknown;
  searchImprShare?: unknown;
  searchBudgetLostIs?: unknown;
  searchRankLostIs?: unknown;
  topImprPct?: unknown;
  absTopImprPct?: unknown;
}): DailyRaw {
  return {
    date: fromDbDate(r.date),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    cost: num(r.cost),
    conversions: num(r.conversions),
    conversionsValue: num(r.conversionsValue),
    searchImprShare: optNum(r.searchImprShare),
    budgetLostIs: optNum(r.searchBudgetLostIs),
    rankLostIs: optNum(r.searchRankLostIs),
    topImprPct: optNum(r.topImprPct),
    absTopImprPct: optNum(r.absTopImprPct),
  };
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

const dateRange = (p: Period) => ({ gte: toDbDate(p.from), lte: toDbDate(p.to) });

async function campaignDaily(orgId: string, campaignIds: bigint[], p: Period) {
  if (campaignIds.length === 0) return [];
  return prisma.adsCampaignDaily.findMany({ where: { orgId, campaignId: { in: campaignIds }, date: dateRange(p) } });
}

export async function buildReport(
  orgId: string,
  customerId: string,
  period: Period,
  compare: Period | null
): Promise<ReportData> {
  const account = await getAccount(orgId, customerId);
  if (!account) throw new Error("ไม่พบบัญชีโฆษณานี้");

  const [{ map: benchmarks }, settings, campaignDims] = await Promise.all([
    loadBenchmarks(orgId, customerId),
    loadAnalysisSettings(orgId, customerId),
    prisma.adsCampaign.findMany({ where: { orgId, customerId } }),
  ]);
  const campaignIds = campaignDims.map((c) => c.campaignId);
  const campaignById = new Map(campaignDims.map((c) => [String(c.campaignId), c]));

  const adGroupDims = campaignIds.length
    ? await prisma.adsAdGroup.findMany({ where: { orgId, campaignId: { in: campaignIds } } })
    : [];
  const adGroupIds = adGroupDims.map((a) => a.adGroupId);
  const adGroupById = new Map(adGroupDims.map((a) => [String(a.adGroupId), a]));

  const [curRows, prevRows, agRows, kwGroups, stGroups] = await Promise.all([
    campaignDaily(orgId, campaignIds, period),
    compare ? campaignDaily(orgId, campaignIds, compare) : Promise.resolve([]),
    adGroupIds.length
      ? prisma.adsAdGroupDaily.findMany({ where: { orgId, adGroupId: { in: adGroupIds }, date: dateRange(period) } })
      : Promise.resolve([]),
    adGroupIds.length
      ? prisma.adsKeywordDaily.groupBy({
          by: ["adGroupId", "criterionId", "keywordText", "matchType"],
          where: { orgId, adGroupId: { in: adGroupIds }, date: dateRange(period) },
          _sum: { impressions: true, clicks: true, cost: true, conversions: true },
        })
      : Promise.resolve([]),
    adGroupIds.length
      ? prisma.adsSearchTermDaily.groupBy({
          by: ["adGroupId", "searchTerm"],
          where: { orgId, adGroupId: { in: adGroupIds }, date: dateRange(period) },
          _sum: { impressions: true, clicks: true, cost: true, conversions: true },
        })
      : Promise.resolve([]),
  ]);

  const rule = { minClicksToJudge: settings.minClicksToJudge };

  // ── รวมทั้งบัญชี + เปลี่ยนแปลงจากช่วงเทียบ ──
  const curRaw = curRows.map(toRaw);
  const cur = evaluate(aggregate(curRaw), benchmarks, rule);
  const prev = compare ? evaluate(aggregate(prevRows.map(toRaw)), benchmarks, rule) : null;
  const totals: TotalsWithChange = {
    ...cur,
    change: prev
      ? {
          cost: changePct(cur.cost, prev.cost),
          clicks: changePct(cur.clicks, prev.clicks),
          impressions: changePct(cur.impressions, prev.impressions),
          conversions: changePct(cur.conversions, prev.conversions),
          ctr: changePct(cur.ctr, prev.ctr),
          cpc: changePct(cur.cpc, prev.cpc),
          conv_rate: changePct(cur.conv_rate, prev.conv_rate),
          cpa: changePct(cur.cpa, prev.cpa),
          roas: changePct(cur.roas, prev.roas),
        }
      : {},
  };

  // ── รายวันสำหรับกราฟ (วันที่ไม่มีข้อมูล = 0) ──
  const byDate = groupBy(curRaw, (r) => r.date);
  const daily: DailyPoint[] = [];
  for (let d = period.from; d <= period.to; d = addDays(d, 1)) {
    const rows = byDate.get(d) ?? [];
    daily.push({
      date: d,
      cost: Math.round(rows.reduce((a, r) => a + r.cost, 0) * 100) / 100,
      clicks: rows.reduce((a, r) => a + r.clicks, 0),
      impressions: rows.reduce((a, r) => a + r.impressions, 0),
      conversions: Math.round(rows.reduce((a, r) => a + r.conversions, 0) * 100) / 100,
    });
  }

  // ── แคมเปญ ──
  const curByCampaign = groupBy(curRaw.map((r, i) => ({ r, id: String(curRows[i]!.campaignId) })), (x) => x.id);
  const prevByCampaign = groupBy(prevRows.map((r) => ({ r: toRaw(r), id: String(r.campaignId) })), (x) => x.id);
  const campaigns: CampaignRow[] = [...curByCampaign.entries()]
    .map(([id, list]) => {
      const dim = campaignById.get(id);
      const budget = dim?.dailyBudget == null ? null : Number(dim.dailyBudget);
      const ev = evaluate(aggregate(list.map((x) => x.r)), benchmarks, rule, budget);
      const pv = prevByCampaign.get(id);
      const pev = pv ? evaluate(aggregate(pv.map((x) => x.r)), benchmarks, rule, budget) : null;
      return {
        id,
        name: dim?.name ?? null,
        status: dim?.status ?? null,
        channel_type: dim?.channelType ?? null,
        daily_budget: budget,
        ...ev,
        cost_change_pct: pev ? changePct(ev.cost, pev.cost) : null,
        conversions_change_pct: pev ? changePct(ev.conversions, pev.conversions) : null,
        cpa_change_pct: pev ? changePct(ev.cpa, pev.cpa) : null,
      };
    })
    .filter((c) => c.impressions > 0 || c.cost > 0)
    .sort((a, b) => b.cost - a.cost);

  // ── กลุ่มโฆษณา ──
  const agByGroup = groupBy(agRows, (r) => String(r.adGroupId));
  const adGroups: AdGroupRow[] = [...agByGroup.entries()]
    .map(([id, list]) => {
      const dim = adGroupById.get(id);
      const campaignId = dim ? String(dim.campaignId) : "";
      return {
        id,
        campaign_id: campaignId,
        campaign_name: campaignById.get(campaignId)?.name ?? null,
        name: dim?.name ?? null,
        status: dim?.status ?? null,
        ...evaluate(aggregate(list.map(toRaw)), benchmarks, rule),
      };
    })
    .filter((a) => a.impressions > 0 || a.cost > 0)
    .sort((a, b) => b.cost - a.cost);

  // ── คีย์เวิร์ด (รวมทั้งช่วง) ──
  const keywordMap = new Map<string, KeywordRow>();
  for (const g of kwGroups) {
    const key = `${g.adGroupId}|${g.criterionId}`;
    const raw = {
      impressions: num(g._sum.impressions),
      clicks: num(g._sum.clicks),
      cost: num(g._sum.cost),
      conversions: num(g._sum.conversions),
    };
    const prevKw = keywordMap.get(key);
    const merged = prevKw
      ? { impressions: prevKw.impressions + raw.impressions, clicks: prevKw.clicks + raw.clicks, cost: prevKw.cost + raw.cost, conversions: prevKw.conversions + raw.conversions }
      : raw;
    keywordMap.set(key, {
      id: String(g.criterionId),
      ad_group_id: String(g.adGroupId),
      text: g.keywordText ?? prevKw?.text ?? null,
      match_type: g.matchType ?? prevKw?.match_type ?? null,
      ...evaluate(
        { ...merged, conversionsValue: 0, daysRan: 0, searchImprShare: null, budgetLostIs: null, rankLostIs: null, topImprPct: null, absTopImprPct: null },
        benchmarks,
        rule
      ),
    });
  }
  const keywords = [...keywordMap.values()].filter((k) => k.impressions > 0 || k.cost > 0).sort((a, b) => b.cost - a.cost);

  // ── คำค้นหาที่เสียเงิน + ข้อสังเกต ──
  const wastedTerms = wastedSearchTerms(
    stGroups.map((g) => ({
      search_term: g.searchTerm ?? "",
      ad_group_id: String(g.adGroupId),
      impressions: num(g._sum.impressions),
      clicks: num(g._sum.clicks),
      cost: num(g._sum.cost),
      conversions: num(g._sum.conversions),
    })),
    settings
  );
  const findings = ruleFindings(
    campaigns,
    wastedTerms,
    new Map(adGroupDims.map((a) => [String(a.adGroupId), a.name])),
    settings
  );

  return {
    account,
    period: { ...period, days: daysInPeriod(period) },
    compare,
    benchmarks,
    settings,
    totals,
    daily,
    campaigns,
    adGroups,
    keywords,
    wastedTerms,
    findings,
  };
}
