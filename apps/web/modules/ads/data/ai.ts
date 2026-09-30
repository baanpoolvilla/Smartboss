import "server-only";
import OpenAI from "openai";
import { prisma, type Prisma } from "@smartboss/database";
import { hideFailed, parseAiOutput, validateAiOutput, type AiOutput, type HiddenPart, type ValidationIssue } from "../lib/ai-validate";
import { METRICS } from "../lib/rules";
import { fromDbDate, toDbDate, type Period } from "../lib/periods";
import { ACTION_STATUSES } from "../constants";
import { buildReport, type ReportData } from "./report";

/**
 * AI Analysis (spec §6) — รับ JSON ที่โค้ดคำนวณแล้ว ตอบกลับเป็น JSON
 * AI มีหน้าที่ตีความและเขียนคำแนะนำเท่านั้น ตัวเลขและสถานะมาจาก Rule Engine ทั้งหมด
 *
 * ใช้ OPENAI_API_KEY ตัวเดียวกับ AI Insight ของโมดูลรายงาน (บิลรวมที่แพลตฟอร์ม)
 * ADS_AI_MODEL ตั้งรุ่นโมเดลได้ ไม่ตั้ง = gpt-4o-mini เหมือน AI Insight
 */

export const PROMPT_VERSION = "1.0";
const model = () => process.env.ADS_AI_MODEL || "gpt-4o-mini";

function client(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY ยังไม่ได้ตั้งค่า");
  return new OpenAI({ apiKey });
}

// ─── 6.1 Input ───

const pick = <T extends object, K extends keyof T>(o: T, keys: K[]) =>
  Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>;

const KPI_FIELDS = [
  "cost", "clicks", "impressions", "conversions",
  "ctr", "ctr_status", "cpc", "cpc_status", "conv_rate", "conv_rate_status", "cpa", "cpa_status",
  "top_impr_pct", "top_impr_pct_status", "abs_top_impr_pct", "abs_top_impr_pct_status", "low_data",
] as const;

export interface PreviousAction {
  title: string | null;
  status: string;
  done_at: string | null;
  entity_type: string | null;
  entity_id: number | null;
}

export function buildAiInput(r: ReportData, previousActions: PreviousAction[]) {
  const t = r.totals;
  return {
    account: { name: r.account.name, currency: r.account.currencyCode },
    goal: { primary: r.settings.primaryGoal, target_cpa: r.settings.targetCpa, avg_lead_value: r.settings.avgLeadValue },
    business_context: r.settings.businessContext,
    period: { from: r.period.from, to: r.period.to, days: r.period.days },
    compare_period: r.compare ? { from: r.compare.from, to: r.compare.to } : null,
    benchmarks: Object.fromEntries(
      METRICS.map((m) => [m, { direction: r.benchmarks[m].direction, poor: r.benchmarks[m].poor, good: r.benchmarks[m].good }])
    ),
    rules: {
      min_clicks_to_judge: r.settings.minClicksToJudge,
      min_budget_util_to_scale: r.settings.minBudgetUtilToScale,
      budget_lost_is_limit: r.settings.budgetLostIsLimit,
      rank_lost_is_limit: r.settings.rankLostIsLimit,
      wasted_term_min_clicks: r.settings.wastedTermMinClicks,
    },
    account_totals: {
      ...pick(t, [...KPI_FIELDS, "conversions_value", "roas"]),
      cost_change_pct: t.change.cost ?? null,
      clicks_change_pct: t.change.clicks ?? null,
      conversions_change_pct: t.change.conversions ?? null,
      ctr_change_pct: t.change.ctr ?? null,
      cpc_change_pct: t.change.cpc ?? null,
      conv_rate_change_pct: t.change.conv_rate ?? null,
      cpa_change_pct: t.change.cpa ?? null,
      roas_change_pct: t.change.roas ?? null,
    },
    campaigns: r.campaigns.map((c) => ({
      id: Number(c.id),
      name: c.name,
      status: c.status,
      channel_type: c.channel_type,
      daily_budget: c.daily_budget,
      budget_util_pct: c.budget_util_pct,
      ...pick(c, [...KPI_FIELDS, "conversions_value", "roas", "search_impr_share"]),
      budget_lost_is: c.budget_lost_is,
      rank_lost_is: c.rank_lost_is,
      cost_change_pct: c.cost_change_pct,
      conversions_change_pct: c.conversions_change_pct,
      cpa_change_pct: c.cpa_change_pct,
    })),
    ad_groups: r.adGroups.slice(0, 50).map((a) => ({
      id: Number(a.id),
      campaign_id: Number(a.campaign_id),
      name: a.name,
      status: a.status,
      ...pick(a, [...KPI_FIELDS]),
    })),
    keywords: r.keywords.slice(0, 30).map((k) => ({
      id: Number(k.id),
      ad_group_id: Number(k.ad_group_id),
      text: k.text,
      match_type: k.match_type,
      ...pick(k, ["cost", "clicks", "impressions", "conversions", "ctr", "ctr_status", "cpc", "cpc_status", "conv_rate", "conv_rate_status", "cpa", "cpa_status", "low_data"]),
    })),
    wasted_search_terms: r.wastedTerms.slice(0, 30).map((w) => ({
      search_term: w.search_term,
      ad_group_id: Number(w.ad_group_id),
      clicks: w.clicks,
      impressions: w.impressions,
      cost: w.cost,
    })),
    rule_findings: r.findings.map((f) => ({ type: f.type, entity_type: f.entity_type, entity_id: Number(f.entity_id), message: f.message })),
    previous_actions: previousActions,
  };
}

export type AiInput = ReturnType<typeof buildAiInput>;

// ─── 6.2 System Prompt ───

const RULES = `กฎที่ต้องทำตามทุกข้อ:
1. ใช้เฉพาะตัวเลขใน JSON ที่ได้รับ ห้ามคำนวณใหม่ ห้ามปัดเศษต่างจากที่ได้รับ
2. ใช้สถานะ (*_status) ตามที่ระบบคำนวณมา ห้ามจัดสถานะเอง (good = ดี, normal = ปกติ, poor = ต้องแก้, low_data = ข้อมูลน้อย)
3. ห้ามระบุสาเหตุที่ไม่มีหลักฐานในข้อมูล ให้เขียนเป็น "ควรตรวจสอบ ..." แทน
4. ห้ามแนะนำเพิ่มงบให้แคมเปญที่ budget_util_pct ต่ำกว่าเกณฑ์ rules.min_budget_util_to_scale
5. รายการที่ low_data = true ห้ามสรุปว่าดีหรือแย่จาก Conversion Rate
6. ทุกข้อสังเกตต้องนำไปสู่การกระทำ ตัวเลขที่ไม่ช่วยตัดสินใจ ให้ตัดออก
7. แผนปฏิบัติการ (actions) 3–6 ข้อ เรียงตามความเร่งด่วน
8. ถ้ามี previous_actions ให้ประเมินว่าสิ่งที่ทำไปแล้วได้ผลหรือไม่ จากการเปลี่ยนแปลงของตัวเลข
9. เขียนภาษาไทย ใช้ศัพท์โฆษณาภาษาอังกฤษได้ตามที่ทีมคุ้นเคย
10. ตอบเป็น JSON ตาม schema เท่านั้น ไม่มีข้อความอื่น`;

const SYSTEM_PROMPT = `คุณเป็นนักวิเคราะห์โฆษณา Google Ads ของบริษัท ได้รับข้อมูลเป็น JSON ที่ระบบคำนวณตัวเลข สถานะ และข้อสังเกต (rule_findings) ไว้ให้แล้ว หน้าที่ของคุณคือตีความและเขียนสรุปพร้อมแผนปฏิบัติการ

ความหมายของข้อมูล:
- หน่วยเงินตาม account.currency · ctr, conv_rate, budget_util_pct, *_impr_*, *_is, *_change_pct เป็นเปอร์เซ็นต์
- cpa = null คือ N/A (ไม่มี conversion) · roas = null คือไม่มี conversion value
- rule_findings คือข้อสังเกตจากกฎของระบบ ต้องนำมาพิจารณาทุกข้อ
- entity_id ต้องเป็น id ที่มีอยู่ใน campaigns / ad_groups / keywords เท่านั้น ถ้าเป็นเรื่องระดับบัญชีใช้ entity_type "account" และ entity_id null

${RULES}

รูปแบบคำตอบ (JSON):
{
  "executive_summary": "3-5 ประโยค",
  "top_performers": [ { "entity_type": "campaign|ad_group|keyword", "entity_id": 0, "reason": "..." } ],
  "underperformers": [ { "entity_type": "campaign|ad_group|keyword", "entity_id": 0, "problem": "...", "recommendation": "..." } ],
  "previous_actions_review": [ { "title": "...", "result": "..." } ],
  "actions": [ { "title": "...", "rationale": "...", "impact": "high|medium|low", "urgency": "now|this_week|this_month", "entity_type": "campaign|ad_group|keyword|account", "entity_id": 0 } ]
}`;

const ASK_PROMPT = `คุณเป็นนักวิเคราะห์โฆษณา Google Ads ผู้ใช้จะถามคำถามเกี่ยวกับรายงานหนึ่งฉบับ บริบทที่ได้คือ input (ข้อมูลที่ระบบคำนวณไว้) และ output (รายงานที่ AI เขียนไว้) ของรายงานนั้นเท่านั้น คุณไม่มีสิทธิ์เข้าถึงฐานข้อมูล ถ้าคำถามต้องใช้ข้อมูลที่ไม่มีในบริบท ให้ตอบตรง ๆ ว่าไม่มีข้อมูลนั้นในรายงานนี้

${RULES}

รูปแบบคำตอบ (JSON): { "answer": "คำตอบ" }`;

type Msg = { role: "system" | "user" | "assistant"; content: string };

async function complete(messages: Msg[]): Promise<string> {
  const res = await client().chat.completions.create({
    model: model(),
    response_format: { type: "json_object" },
    temperature: 0.2,
    messages,
  });
  return res.choices[0]?.message?.content ?? "";
}

// ─── ประวัติแผนปฏิบัติการของรอบก่อน ───

async function previousActions(orgId: string, customerId: string): Promise<PreviousAction[]> {
  const last = await prisma.adsAiReport.findFirst({
    where: { orgId, customerId },
    orderBy: { createdAt: "desc" },
    include: { actions: { orderBy: { seq: "asc" } } },
  });
  return (last?.actions ?? []).map((a) => ({
    title: a.title,
    status: a.status,
    done_at: a.status === "done" && a.updatedAt ? fromDbDate(a.updatedAt) : null,
    entity_type: a.entityType,
    entity_id: a.entityId == null ? null : Number(a.entityId),
  }));
}

// ─── 6.4 ตรวจคำตอบ + ขอแก้ ───

function validationContext(input: AiInput) {
  return {
    input,
    entityIds: {
      campaign: new Set(input.campaigns.map((c) => String(c.id))),
      ad_group: new Set(input.ad_groups.map((a) => String(a.id))),
      keyword: new Set(input.keywords.map((k) => String(k.id))),
    },
    budgetBlockedCampaignIds: new Set(
      input.campaigns
        .filter((c) => c.budget_util_pct != null && c.budget_util_pct < input.rules.min_budget_util_to_scale)
        .map((c) => String(c.id))
    ),
  };
}

export interface StoredOutput extends AiOutput {
  validation: {
    /** parse ครั้งแรกไม่ผ่าน ต้องเรียก AI ใหม่ */
    parse_retried: boolean;
    /** ส่งกลับให้ AI แก้ 1 รอบ */
    fix_round: boolean;
    /** ส่วนที่ยังไม่ผ่านหลังแก้แล้ว — ซ่อนและแจ้งผู้ใช้ */
    hidden: HiddenPart[];
  };
}

async function analyze(input: AiInput): Promise<StoredOutput> {
  const messages: Msg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(input) },
  ];

  // 1) parse ไม่ผ่าน → เรียกใหม่ 1 ครั้ง
  let raw = await complete(messages);
  let out = parseAiOutput(raw);
  let parseRetried = false;
  if (!out) {
    parseRetried = true;
    raw = await complete(messages);
    out = parseAiOutput(raw);
    if (!out) throw new Error("AI ตอบกลับไม่ใช่ JSON ตามรูปแบบที่กำหนด (ลองแล้ว 2 ครั้ง)");
  }

  // 2–4) ตรวจ → ไม่ผ่านส่งกลับให้แก้ 1 รอบ
  const ctx = validationContext(input);
  let issues: ValidationIssue[] = validateAiOutput(out, ctx);
  let fixRound = false;
  if (issues.length > 0) {
    fixRound = true;
    const fixRaw = await complete([
      ...messages,
      { role: "assistant", content: raw },
      {
        role: "user",
        content:
          "คำตอบมีจุดที่ไม่ผ่านการตรวจ:\n" +
          issues.map((i) => `- ${i.message}`).join("\n") +
          "\nแก้ให้ถูกต้องตามกฎ แล้วตอบ JSON ใหม่ทั้งก้อนตาม schema เดิม",
      },
    ]);
    const fixed = parseAiOutput(fixRaw);
    if (fixed) {
      out = fixed;
      issues = validateAiOutput(out, ctx);
    }
  }

  // 5) ยังไม่ผ่าน → ซ่อนส่วนนั้น
  const { output, hidden } = hideFailed(out, issues);
  return { ...output, validation: { parse_retried: parseRetried, fix_round: fixRound, hidden } };
}

// ─── สร้าง / อ่านรายงาน ───

export async function runAnalysis(
  orgId: string,
  customerId: string,
  period: Period,
  compare: Period | null,
  createdBy: string
): Promise<string> {
  const report = await buildReport(orgId, customerId, period, compare);
  if (report.campaigns.length === 0) {
    throw new Error("ไม่มีข้อมูลโฆษณาในช่วงที่เลือก — ตรวจว่าซิงค์ข้อมูลแล้ว");
  }
  const input = buildAiInput(report, await previousActions(orgId, customerId));
  const output = await analyze(input);

  const created = await prisma.adsAiReport.create({
    data: {
      orgId,
      customerId,
      periodFrom: toDbDate(period.from),
      periodTo: toDbDate(period.to),
      compareFrom: compare ? toDbDate(compare.from) : null,
      compareTo: compare ? toDbDate(compare.to) : null,
      inputJson: input as unknown as Prisma.InputJsonValue,
      outputJson: output as unknown as Prisma.InputJsonValue,
      promptVersion: PROMPT_VERSION,
      model: model(),
      createdBy: createdBy.slice(0, 40),
      actions: {
        create: output.actions.map((a, i) => ({
          orgId,
          seq: i + 1,
          title: a.title.slice(0, 255),
          rationale: a.rationale,
          impact: a.impact,
          urgency: a.urgency,
          entityType: a.entity_type || null,
          entityId: a.entity_type !== "account" && a.entity_id != null && /^\d+$/.test(String(a.entity_id)) ? BigInt(a.entity_id) : null,
          status: "pending",
          updatedAt: new Date(),
        })),
      },
    },
    select: { id: true },
  });
  return String(created.id);
}

export interface AiReportView {
  id: string;
  customerId: string;
  period: Period;
  compare: Period | null;
  input: AiInput;
  output: StoredOutput;
  model: string | null;
  promptVersion: string | null;
  createdAt: Date | null;
  createdBy: string | null;
  actions: {
    id: string;
    seq: number | null;
    title: string | null;
    rationale: string | null;
    impact: string | null;
    urgency: string | null;
    entityType: string | null;
    entityId: string | null;
    status: string;
    updatedAt: Date | null;
  }[];
}

function toBigIntId(id: string): bigint | null {
  return /^\d+$/.test(id) ? BigInt(id) : null;
}

export async function getAiReport(orgId: string, id: string): Promise<AiReportView | null> {
  const bid = toBigIntId(id);
  if (bid == null) return null;
  const r = await prisma.adsAiReport.findFirst({
    where: { orgId, id: bid },
    include: { actions: { orderBy: { seq: "asc" } } },
  });
  if (!r) return null;
  return {
    id: String(r.id),
    customerId: r.customerId,
    period: { from: fromDbDate(r.periodFrom), to: fromDbDate(r.periodTo) },
    compare: r.compareFrom && r.compareTo ? { from: fromDbDate(r.compareFrom), to: fromDbDate(r.compareTo) } : null,
    input: r.inputJson as unknown as AiInput,
    output: r.outputJson as unknown as StoredOutput,
    model: r.model,
    promptVersion: r.promptVersion,
    createdAt: r.createdAt,
    createdBy: r.createdBy,
    actions: r.actions.map((a) => ({
      id: String(a.id),
      seq: a.seq,
      title: a.title,
      rationale: a.rationale,
      impact: a.impact,
      urgency: a.urgency,
      entityType: a.entityType,
      entityId: a.entityId == null ? null : String(a.entityId),
      status: a.status,
      updatedAt: a.updatedAt,
    })),
  };
}

export async function listAiReports(orgId: string, customerId: string, take = 20) {
  const rows = await prisma.adsAiReport.findMany({
    where: { orgId, customerId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, periodFrom: true, periodTo: true, createdAt: true, createdBy: true },
  });
  return rows.map((r) => ({
    id: String(r.id),
    period: { from: fromDbDate(r.periodFrom), to: fromDbDate(r.periodTo) },
    createdAt: r.createdAt,
    createdBy: r.createdBy,
  }));
}

export async function latestAiReport(orgId: string, customerId: string): Promise<AiReportView | null> {
  const r = await prisma.adsAiReport.findFirst({
    where: { orgId, customerId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return r ? getAiReport(orgId, String(r.id)) : null;
}

export async function updateActionStatus(orgId: string, actionId: string, status: string): Promise<void> {
  if (!(ACTION_STATUSES as readonly string[]).includes(status)) throw new Error("สถานะไม่ถูกต้อง");
  const bid = toBigIntId(actionId);
  if (bid == null) throw new Error("ไม่พบรายการนี้");
  const res = await prisma.adsAiAction.updateMany({ where: { orgId, id: bid }, data: { status, updatedAt: new Date() } });
  if (res.count === 0) throw new Error("ไม่พบรายการนี้");
}

// ─── 6.5 ช่องถาม AI ───

export async function askReport(
  orgId: string,
  reportId: string,
  question: string,
  history: { q: string; a: string }[] = []
): Promise<string> {
  const q = question.trim().slice(0, 2000);
  if (!q) throw new Error("พิมพ์คำถามก่อน");
  const report = await getAiReport(orgId, reportId);
  if (!report) throw new Error("ไม่พบรายงานนี้");

  const messages: Msg[] = [
    { role: "system", content: ASK_PROMPT },
    { role: "user", content: JSON.stringify({ input: report.input, output: report.output }) },
  ];
  for (const h of history.slice(-5)) {
    messages.push({ role: "user", content: h.q.slice(0, 2000) });
    messages.push({ role: "assistant", content: JSON.stringify({ answer: h.a.slice(0, 4000) }) });
  }
  messages.push({ role: "user", content: q });

  const raw = await complete(messages);
  try {
    const parsed = JSON.parse(raw) as { answer?: unknown };
    if (typeof parsed.answer === "string") return parsed.answer;
  } catch {
    /* ตกไปข้างล่าง */
  }
  throw new Error("AI ตอบกลับไม่ใช่รูปแบบที่กำหนด ลองถามใหม่อีกครั้ง");
}
