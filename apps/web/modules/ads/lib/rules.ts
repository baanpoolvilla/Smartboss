/**
 * Rule Engine (spec §5) — โค้ดเป็นผู้คำนวณตัวเลขและสถานะทั้งหมด AI ห้ามคิดเอง
 *
 * ไฟล์นี้เป็นฟังก์ชันล้วน ไม่แตะฐานข้อมูล (ทดสอบได้จาก __tests__/rules.test.ts)
 * ทุกเกณฑ์รับเข้ามาเป็นพารามิเตอร์ที่อ่านจาก ads_kpi_benchmarks /
 * ads_analysis_settings ของบริษัท — ค่า DEFAULT_* ข้างล่างเป็นแค่ค่าตั้งต้นให้
 * บริษัทที่ยังไม่เคยตั้ง **ห้ามอ่านไปใช้ตรง ๆ** ให้ผ่าน data/settings.ts เสมอ
 */

export const METRICS = ["ctr", "cpc", "conv_rate", "cpa", "top_impr_pct", "abs_top_impr_pct"] as const;
export type MetricKey = (typeof METRICS)[number];
export type Direction = "higher_better" | "lower_better";
export type Status = "good" | "normal" | "poor" | "low_data";

export interface Benchmark {
  direction: Direction;
  poor: number;
  good: number;
}
export type BenchmarkMap = Record<MetricKey, Benchmark>;

/** ค่าตั้งต้น (spec §5.2 จากสกิล ad-performance-report) — ใช้ seed ลงฐานข้อมูลเท่านั้น */
export const DEFAULT_BENCHMARKS: BenchmarkMap = {
  ctr: { direction: "higher_better", poor: 5, good: 10 },
  cpc: { direction: "lower_better", poor: 10, good: 3 },
  conv_rate: { direction: "higher_better", poor: 3, good: 7 },
  cpa: { direction: "lower_better", poor: 200, good: 80 },
  top_impr_pct: { direction: "higher_better", poor: 50, good: 80 },
  abs_top_impr_pct: { direction: "higher_better", poor: 10, good: 25 },
};

export interface RuleSettings {
  minClicksToJudge: number;
  minBudgetUtilToScale: number;
  budgetLostIsLimit: number;
  rankLostIsLimit: number;
  wastedTermMinClicks: number;
}

/** ค่าตั้งต้นของกฎ (spec §5.4 / ค่า DEFAULT ของ ads_analysis_settings) — ห้ามอ่านตรง */
export const DEFAULT_RULE_SETTINGS: RuleSettings = {
  minClicksToJudge: 50,
  minBudgetUtilToScale: 80,
  budgetLostIsLimit: 10,
  rankLostIsLimit: 30,
  wastedTermMinClicks: 10,
};

/**
 * ตรวจทิศทางของเกณฑ์ (spec §5.2 ข้อควรระวัง: Excel เดิมเคยใส่ CPC กลับด้าน)
 * สูง = ดี → เกณฑ์แดงต้องต่ำกว่าเกณฑ์เขียว · ต่ำ = ดี → เกณฑ์แดงต้องสูงกว่า
 */
export function benchmarkError(b: Benchmark): string | null {
  if (!Number.isFinite(b.poor) || !Number.isFinite(b.good)) return "ต้องเป็นตัวเลข";
  if (b.poor < 0 || b.good < 0) return "ต้องไม่ติดลบ";
  if (b.direction === "higher_better" && !(b.poor < b.good)) return "สูง = ดี: เกณฑ์ \"ต้องแก้\" ต้องน้อยกว่าเกณฑ์ \"ดี\"";
  if (b.direction === "lower_better" && !(b.poor > b.good)) return "ต่ำ = ดี: เกณฑ์ \"ต้องแก้\" ต้องมากกว่าเกณฑ์ \"ดี\"";
  return null;
}

/**
 * สถานะสีของค่าหนึ่งค่า — ขอบเขตนับเป็น "ปกติ" (ตาราง §5.2: CTR 5–10% = ปกติ)
 *   สูง = ดี: < poor แดง · > good เขียว · นอกนั้นเหลือง
 *   ต่ำ = ดี: > poor แดง · < good เขียว · นอกนั้นเหลือง
 */
export function statusOf(value: number | null, b: Benchmark): Status | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (b.direction === "higher_better") {
    if (value < b.poor) return "poor";
    if (value > b.good) return "good";
    return "normal";
  }
  if (value > b.poor) return "poor";
  if (value < b.good) return "good";
  return "normal";
}

export const round = (v: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
const r2 = (v: number | null): number | null => (v == null ? null : round(v, 2));

/** ค่าดิบรายวัน — impression share / top % เป็นเศษส่วน 0–1 ตามที่ API ส่งมา */
export interface DailyRaw {
  date: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
  searchImprShare?: number | null;
  budgetLostIs?: number | null;
  rankLostIs?: number | null;
  topImprPct?: number | null;
  absTopImprPct?: number | null;
}

export interface Totals {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
  /** จำนวนวันที่แคมเปญวิ่งจริง (มี impressions หรือค่าใช้จ่าย) */
  daysRan: number;
  /** ค่าเป็น % (0–100) ถ่วงน้ำหนักด้วย impressions — null = ไม่มีข้อมูล */
  searchImprShare: number | null;
  budgetLostIs: number | null;
  rankLostIs: number | null;
  topImprPct: number | null;
  absTopImprPct: number | null;
}

/**
 * รวมค่าดิบตามช่วง (spec §3.3: คำนวณจากผลรวมค่าดิบเสมอ ห้ามเฉลี่ย CTR/CPC รายวัน)
 * อัตราส่วน impression share ใช้ค่าเฉลี่ยถ่วงน้ำหนักด้วย impressions
 */
export function aggregate(rows: DailyRaw[]): Totals {
  const t = { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0, daysRan: 0 };
  const weighted: Record<"searchImprShare" | "budgetLostIs" | "rankLostIs" | "topImprPct" | "absTopImprPct", [number, number]> = {
    searchImprShare: [0, 0],
    budgetLostIs: [0, 0],
    rankLostIs: [0, 0],
    topImprPct: [0, 0],
    absTopImprPct: [0, 0],
  };
  const ran = new Set<string>();
  for (const r of rows) {
    t.impressions += r.impressions;
    t.clicks += r.clicks;
    t.cost += r.cost;
    t.conversions += r.conversions;
    t.conversionsValue += r.conversionsValue;
    if (r.impressions > 0 || r.cost > 0) ran.add(r.date);
    for (const key of Object.keys(weighted) as (keyof typeof weighted)[]) {
      const v = r[key];
      if (v != null && r.impressions > 0) {
        weighted[key][0] += v * r.impressions;
        weighted[key][1] += r.impressions;
      }
    }
  }
  const avg = (k: keyof typeof weighted) => (weighted[k][1] > 0 ? (weighted[k][0] / weighted[k][1]) * 100 : null);
  return {
    ...t,
    daysRan: ran.size,
    searchImprShare: avg("searchImprShare"),
    budgetLostIs: avg("budgetLostIs"),
    rankLostIs: avg("rankLostIs"),
    topImprPct: avg("topImprPct"),
    absTopImprPct: avg("absTopImprPct"),
  };
}

/** สูตร KPI (spec §5.1) */
export function kpis(t: Pick<Totals, "impressions" | "clicks" | "cost" | "conversions" | "conversionsValue">) {
  return {
    ctr: t.impressions > 0 ? (t.clicks / t.impressions) * 100 : null,
    cpc: t.clicks > 0 ? t.cost / t.clicks : null,
    conv_rate: t.clicks > 0 ? (t.conversions / t.clicks) * 100 : null,
    // conversions = 0 → N/A (null) และสถานะแดง — ดู evaluate()
    cpa: t.conversions > 0 ? t.cost / t.conversions : null,
    // แสดงเฉพาะเมื่อมี conversion value
    roas: t.conversionsValue > 0 && t.cost > 0 ? t.conversionsValue / t.cost : null,
  };
}

/** ตัวเลข + สถานะของหนึ่งหน่วย (บัญชี / แคมเปญ / กลุ่มโฆษณา / คีย์เวิร์ด) — ชื่อฟิลด์ตาม spec §6.1 */
export interface Evaluated {
  cost: number;
  clicks: number;
  impressions: number;
  conversions: number;
  conversions_value: number;
  ctr: number | null;
  ctr_status: Status | null;
  cpc: number | null;
  cpc_status: Status | null;
  conv_rate: number | null;
  conv_rate_status: Status | null;
  cpa: number | null;
  cpa_status: Status | null;
  roas: number | null;
  top_impr_pct: number | null;
  top_impr_pct_status: Status | null;
  abs_top_impr_pct: number | null;
  abs_top_impr_pct_status: Status | null;
  search_impr_share: number | null;
  budget_lost_is: number | null;
  rank_lost_is: number | null;
  /** null = ไม่มีงบรายวัน (กลุ่มโฆษณา/บัญชี) */
  budget_util_pct: number | null;
  low_data: boolean;
}

export function evaluate(
  t: Totals,
  bm: BenchmarkMap,
  settings: Pick<RuleSettings, "minClicksToJudge">,
  dailyBudget: number | null = null
): Evaluated {
  const k = kpis(t);
  const lowData = t.clicks < settings.minClicksToJudge;
  const ctr = r2(k.ctr);
  const cpc = r2(k.cpc);
  const convRate = r2(k.conv_rate);
  const cpa = r2(k.cpa);
  const top = r2(t.topImprPct);
  const absTop = r2(t.absTopImprPct);
  return {
    cost: round(t.cost),
    clicks: t.clicks,
    impressions: t.impressions,
    conversions: round(t.conversions),
    conversions_value: round(t.conversionsValue),
    ctr,
    ctr_status: statusOf(ctr, bm.ctr),
    cpc,
    cpc_status: statusOf(cpc, bm.cpc),
    conv_rate: convRate,
    // คลิกน้อยกว่าเกณฑ์ → ติดป้าย "ข้อมูลน้อย" ห้ามสรุปดี/แย่จาก Conv. Rate (§5.4)
    conv_rate_status: lowData && convRate != null ? "low_data" : statusOf(convRate, bm.conv_rate),
    cpa,
    // conversions = 0 แต่มีค่าใช้จ่าย → CPA N/A สถานะแดง (§5.1)
    cpa_status: cpa == null ? (t.cost > 0 ? "poor" : null) : statusOf(cpa, bm.cpa),
    roas: r2(k.roas),
    top_impr_pct: top,
    top_impr_pct_status: statusOf(top, bm.top_impr_pct),
    abs_top_impr_pct: absTop,
    abs_top_impr_pct_status: statusOf(absTop, bm.abs_top_impr_pct),
    search_impr_share: r2(t.searchImprShare),
    budget_lost_is: r2(t.budgetLostIs),
    rank_lost_is: r2(t.rankLostIs),
    budget_util_pct:
      dailyBudget && dailyBudget > 0 && t.daysRan > 0 ? round((t.cost / t.daysRan / dailyBudget) * 100) : null,
    low_data: lowData,
  };
}

/** % เปลี่ยนแปลงจากช่วงเปรียบเทียบ (ปัด 1 ตำแหน่ง) */
export function changePct(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return round(((current - previous) / Math.abs(previous)) * 100, 1);
}

export interface SearchTermTotals {
  search_term: string;
  ad_group_id: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
}

/** คำค้นหาใช้เงินแต่ไม่มี conversion (§5.4) เรียงตามค่าใช้จ่าย */
export function wastedSearchTerms(terms: SearchTermTotals[], settings: Pick<RuleSettings, "wastedTermMinClicks">) {
  return terms
    .filter((t) => t.clicks >= settings.wastedTermMinClicks && t.conversions === 0)
    .sort((a, b) => b.cost - a.cost)
    .map((t) => ({ ...t, cost: round(t.cost) }));
}

export type FindingType =
  | "low_data"
  | "budget_not_limiting"
  | "budget_limited"
  | "rank_limited"
  | "wasted_search_term"
  | "no_conversion";

export interface RuleFinding {
  type: FindingType;
  entity_type: "campaign" | "ad_group";
  entity_id: string;
  entity_name?: string;
  message: string;
}

export const FINDING_LABEL: Record<FindingType, string> = {
  low_data: "ข้อมูลน้อย",
  budget_not_limiting: "งบไม่ใช่ตัวจำกัด",
  budget_limited: "งบเป็นตัวจำกัด",
  rank_limited: "Ad Rank เป็นตัวจำกัด",
  wasted_search_term: "เสนอ Negative keyword",
  no_conversion: "ควรตรวจสอบ",
};

const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** กฎตรวจสอบก่อนส่งให้ AI (spec §5.4) — สร้าง "ข้อสังเกต" จากตัวเลขที่คำนวณแล้ว */
export function ruleFindings(
  campaigns: ({ id: string; name: string | null } & Evaluated)[],
  wasted: ReturnType<typeof wastedSearchTerms>,
  adGroupNames: Map<string, string | null>,
  settings: RuleSettings
): RuleFinding[] {
  const out: RuleFinding[] = [];
  for (const c of campaigns) {
    const base = { entity_type: "campaign" as const, entity_id: c.id, entity_name: c.name ?? undefined };
    if (c.low_data && c.clicks > 0) {
      out.push({ ...base, type: "low_data", message: `คลิก ${fmt(c.clicks)} ครั้ง ต่ำกว่าเกณฑ์ ${settings.minClicksToJudge} คลิก — ยังสรุปดี/แย่จาก Conv. Rate ไม่ได้` });
    }
    if (c.budget_util_pct != null && c.budget_util_pct < settings.minBudgetUtilToScale) {
      out.push({ ...base, type: "budget_not_limiting", message: `ใช้งบ ${fmt(c.budget_util_pct)}% ของงบรายวัน (ต่ำกว่าเกณฑ์ ${settings.minBudgetUtilToScale}%) — ไม่ควรแนะนำเพิ่มงบ` });
    }
    if (c.budget_lost_is != null && c.budget_lost_is > settings.budgetLostIsLimit) {
      out.push({ ...base, type: "budget_limited", message: `เสีย impression share เพราะงบ ${fmt(c.budget_lost_is)}% (เกินเกณฑ์ ${settings.budgetLostIsLimit}%) — งบเป็นตัวจำกัด เพิ่มงบได้ผล` });
    }
    if (c.rank_lost_is != null && c.rank_lost_is > settings.rankLostIsLimit) {
      out.push({ ...base, type: "rank_limited", message: `เสีย impression share เพราะอันดับ ${fmt(c.rank_lost_is)}% (เกินเกณฑ์ ${settings.rankLostIsLimit}%) — Ad Rank เป็นตัวจำกัด แนะนำปรับ bid หรือคุณภาพโฆษณา` });
    }
    if (c.cost > 0 && c.conversions === 0) {
      out.push({ ...base, type: "no_conversion", message: `มีค่าใช้จ่าย ${fmt(c.cost)} แต่ไม่มี conversion — ควรตรวจสอบ` });
    }
  }
  for (const w of wasted) {
    out.push({
      type: "wasted_search_term",
      entity_type: "ad_group",
      entity_id: w.ad_group_id,
      entity_name: adGroupNames.get(w.ad_group_id) ?? undefined,
      message: `คำค้นหา "${w.search_term}" คลิก ${fmt(w.clicks)} ครั้ง ใช้เงิน ${fmt(w.cost)} ไม่มี conversion — เสนอเป็น Negative keyword`,
    });
  }
  return out;
}
