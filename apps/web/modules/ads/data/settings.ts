import "server-only";
import { prisma } from "@smartboss/database";
import {
  DEFAULT_BENCHMARKS,
  DEFAULT_RULE_SETTINGS,
  METRICS,
  benchmarkError,
  type Benchmark,
  type BenchmarkMap,
  type Direction,
  type MetricKey,
  type RuleSettings,
} from "../lib/rules";
import { getAccount } from "./accounts";

/**
 * เกณฑ์ KPI (ads_kpi_benchmarks) และกฎ/เป้าหมาย (ads_analysis_settings)
 * สีในรายงานคำนวณจากค่าในฐานข้อมูลทุกครั้ง แก้เกณฑ์แล้วสีเปลี่ยนตามทันที (spec §5.3)
 */

/** บริษัทที่ยังไม่มีเกณฑ์ค่าเริ่มต้นในฐานข้อมูล → ลงค่าตั้งต้นจาก spec §5.2 ให้ครั้งเดียว */
async function ensureDefaultBenchmarks(orgId: string): Promise<void> {
  const count = await prisma.adsKpiBenchmark.count({ where: { orgId, customerId: null } });
  if (count > 0) return;
  await prisma.adsKpiBenchmark.createMany({
    data: METRICS.map((metric) => ({
      orgId,
      customerId: null,
      metric,
      direction: DEFAULT_BENCHMARKS[metric].direction,
      poorThreshold: DEFAULT_BENCHMARKS[metric].poor,
      goodThreshold: DEFAULT_BENCHMARKS[metric].good,
    })),
  });
}

export interface LoadedBenchmarks {
  map: BenchmarkMap;
  /** แต่ละตัวชี้วัดมาจากค่าเฉพาะบัญชีหรือค่าเริ่มต้นของบริษัท */
  source: Record<MetricKey, "account" | "default">;
}

/** เกณฑ์ที่ใช้กับบัญชีนี้ = ค่าเฉพาะบัญชี (ถ้ามี) ทับค่าเริ่มต้นของบริษัท */
export async function loadBenchmarks(orgId: string, customerId: string | null): Promise<LoadedBenchmarks> {
  await ensureDefaultBenchmarks(orgId);
  const rows = await prisma.adsKpiBenchmark.findMany({
    where: { orgId, OR: [{ customerId: null }, ...(customerId ? [{ customerId }] : [])] },
  });
  const map = {} as BenchmarkMap;
  const source = {} as LoadedBenchmarks["source"];
  for (const metric of METRICS) {
    const own = customerId ? rows.find((r) => r.metric === metric && r.customerId === customerId) : undefined;
    const row = own ?? rows.find((r) => r.metric === metric && r.customerId === null);
    // แถวค่าเริ่มต้นถูกลบทิ้งทีละตัวไม่ได้จากหน้าจอ แต่ถ้าหายไปจริงก็ยังไม่ให้รายงานพัง
    map[metric] = row
      ? { direction: row.direction as Direction, poor: Number(row.poorThreshold), good: Number(row.goodThreshold) }
      : DEFAULT_BENCHMARKS[metric];
    source[metric] = own ? "account" : "default";
  }
  return { map, source };
}

export async function saveBenchmarks(orgId: string, customerId: string | null, input: unknown): Promise<void> {
  if (customerId && !(await getAccount(orgId, customerId))) throw new Error("ไม่พบบัญชีโฆษณานี้");
  const obj = (input ?? {}) as Record<string, Partial<Benchmark>>;
  const clean = {} as BenchmarkMap;
  for (const metric of METRICS) {
    const b = obj[metric];
    if (!b) throw new Error(`ไม่มีเกณฑ์ของ ${metric}`);
    const direction = b.direction;
    if (direction !== "higher_better" && direction !== "lower_better") throw new Error(`ทิศทางของ ${metric} ไม่ถูกต้อง`);
    const item = { direction, poor: Number(b.poor), good: Number(b.good) };
    const err = benchmarkError(item);
    if (err) throw new Error(`${metric}: ${err}`);
    clean[metric] = item;
  }
  await prisma.$transaction([
    prisma.adsKpiBenchmark.deleteMany({ where: { orgId, customerId } }),
    prisma.adsKpiBenchmark.createMany({
      data: METRICS.map((metric) => ({
        orgId,
        customerId,
        metric,
        direction: clean[metric].direction,
        poorThreshold: clean[metric].poor,
        goodThreshold: clean[metric].good,
      })),
    }),
  ]);
}

/** เลิกใช้เกณฑ์เฉพาะบัญชี กลับไปใช้ค่าเริ่มต้นของบริษัท */
export async function resetAccountBenchmarks(orgId: string, customerId: string): Promise<void> {
  await prisma.adsKpiBenchmark.deleteMany({ where: { orgId, customerId } });
}

export interface AnalysisSettings extends RuleSettings {
  primaryGoal: "lead" | "sales";
  targetCpa: number | null;
  avgLeadValue: number | null;
  businessContext: string;
  emailRecipients: string[];
  /** false = ยังไม่เคยบันทึก ใช้ค่าตั้งต้น */
  saved: boolean;
}

export function parseRecipients(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function loadAnalysisSettings(orgId: string, customerId: string): Promise<AnalysisSettings> {
  const row = await prisma.adsAnalysisSetting.findFirst({ where: { orgId, customerId } });
  if (!row) {
    return {
      ...DEFAULT_RULE_SETTINGS,
      primaryGoal: "lead",
      targetCpa: null,
      avgLeadValue: null,
      businessContext: "",
      emailRecipients: [],
      saved: false,
    };
  }
  return {
    minClicksToJudge: row.minClicksToJudge,
    minBudgetUtilToScale: Number(row.minBudgetUtilToScale),
    budgetLostIsLimit: Number(row.budgetLostIsLimit),
    rankLostIsLimit: Number(row.rankLostIsLimit),
    wastedTermMinClicks: row.wastedTermMinClicks,
    primaryGoal: row.primaryGoal === "sales" ? "sales" : "lead",
    targetCpa: row.targetCpa == null ? null : Number(row.targetCpa),
    avgLeadValue: row.avgLeadValue == null ? null : Number(row.avgLeadValue),
    businessContext: row.businessContext ?? "",
    emailRecipients: parseRecipients(row.emailRecipients),
    saved: true,
  };
}

function num(v: unknown, label: string, { min = 0, max = Infinity, int = false } = {}): number {
  const n = Number(v);
  if (v === "" || v == null || !Number.isFinite(n)) throw new Error(`${label} ต้องเป็นตัวเลข`);
  if (n < min || n > max) throw new Error(`${label} ต้องอยู่ระหว่าง ${min}–${max}`);
  if (int && !Number.isInteger(n)) throw new Error(`${label} ต้องเป็นจำนวนเต็ม`);
  return n;
}

function optionalNum(v: unknown, label: string): number | null {
  if (v === "" || v == null) return null;
  return num(v, label);
}

export async function saveAnalysisSettings(orgId: string, customerId: string, input: unknown): Promise<void> {
  if (!(await getAccount(orgId, customerId))) throw new Error("ไม่พบบัญชีโฆษณานี้");
  const o = (input ?? {}) as Record<string, unknown>;
  const recipients = parseRecipients(Array.isArray(o.emailRecipients) ? o.emailRecipients.join(",") : String(o.emailRecipients ?? ""));
  const bad = recipients.filter((e) => !EMAIL_RE.test(e));
  if (bad.length) throw new Error(`อีเมลไม่ถูกต้อง: ${bad.join(", ")}`);
  const goal = o.primaryGoal === "sales" ? "sales" : o.primaryGoal === "lead" ? "lead" : null;
  if (!goal) throw new Error("เป้าหมายหลักต้องเป็น lead หรือ sales");

  const data = {
    minClicksToJudge: num(o.minClicksToJudge, "จำนวนคลิกขั้นต่ำ", { int: true }),
    minBudgetUtilToScale: num(o.minBudgetUtilToScale, "Budget utilization ขั้นต่ำ", { max: 100 }),
    budgetLostIsLimit: num(o.budgetLostIsLimit, "เกณฑ์เสีย IS เพราะงบ", { max: 100 }),
    rankLostIsLimit: num(o.rankLostIsLimit, "เกณฑ์เสีย IS เพราะอันดับ", { max: 100 }),
    wastedTermMinClicks: num(o.wastedTermMinClicks, "คลิกขั้นต่ำของคำค้นหาที่เสียเงิน", { int: true }),
    primaryGoal: goal,
    targetCpa: optionalNum(o.targetCpa, "Target CPA"),
    avgLeadValue: optionalNum(o.avgLeadValue, "มูลค่าเฉลี่ยต่อ Lead"),
    businessContext: typeof o.businessContext === "string" ? o.businessContext.slice(0, 4000) : null,
    emailRecipients: recipients.join(", ") || null,
  };
  await prisma.adsAnalysisSetting.upsert({
    where: { customerId },
    create: { customerId, orgId, ...data },
    update: data,
  });
}
