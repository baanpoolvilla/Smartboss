import "server-only";
import OpenAI from "openai";
import { prisma, type Prisma } from "@smartboss/database";
import { createStoreIfAbsent, readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { readStoreCached } from "@/modules/report_task/lib/db/store-cached-read";
import { writeOwnNotificationsForUsers } from "@/modules/report_task/lib/server/retro-notify";
import { claimSweep, releaseSweep } from "@/modules/report_task/lib/server/sweep-throttle";
import { getOrgPlan, planAtLeast, type PlanCode } from "@/modules/report_task/lib/plan";
import { askCompany } from "./company-ai";
import { withAiLock, worstCaseThb } from "./ai-budget";
import { aiClientFor, readActualCost, syncActualCost } from "./ai-billing";
import { readStoredBytes } from "@/lib/storage";
import { splitReportTopics } from "@/modules/report_task/lib/report-format";
import { attributePostToRound, effectiveRoundsOf, roundRunsOnDay } from "@/modules/report_task/lib/submission-rounds";
import { localDateStr } from "@/modules/report_task/lib/now";
import type { ReportPost, ReportTopic, SubmissionRound } from "@/modules/report_task/store/report-feed-store";
import {
  DEFAULT_BRIEF_SETTINGS,
  MODEL_PRICES_USD,
  THB_PER_USD,
  briefKindOfTopic,
  isNothing,
  type BossBrief,
  type BossBriefSettings,
  type BossBriefView,
  type BriefColor,
  type BriefDetail,
  type BriefImpact,
  type BriefItem,
  type BriefKind,
  type BriefUsageMonth,
  estimateThb,
} from "./types";

/**
 * สรุปรายงานให้ Boss — ฝั่งเซิร์ฟเวอร์ (ดู types.ts)
 *
 * คีย์ในตาราง report_task.stores (ไม่อยู่ใน store-registry ⇒ ฝั่งเบราว์เซอร์อ่านตรงไม่ได้ ต้องผ่าน API ที่เช็กว่าเป็น CEO)
 *   boss-brief-settings  ตั้งค่าของบริษัท
 *   boss-brief-results   { briefs: Record<id, BossBrief> } เก็บ 14 วันล่าสุด
 *   boss-brief-usage     Record<"YYYY-MM", { thb, calls }>
 *
 * ใช้คีย์ OpenAI กลางของแพลตฟอร์ม (เหมือน AI Insight) · แพ็กเกจ PRO ขึ้นไป · ปิดเป็นค่าเริ่มต้น
 */

/**
 * เพดานสูงสุดต่อเดือนตามแพ็กเกจ (บาท) — บริษัทลูกค้าตั้งเพดานเองได้ไม่เกินนี้ เพราะเงินออกจากบัญชี OpenAI ของเรา
 * (ใช้จริงประมาณ ฿30–150/เดือน/ห้อง) · เปลี่ยนตัวเลขที่นี่ที่เดียว
 */
export const PLAN_MAX_CAP_THB: Record<PlanCode, number> = { FREE: 0, PRO: 500, ENTERPRISE: 3000 };

export async function effectiveCap(orgId: string, settings: BossBriefSettings): Promise<{ cap: number; planMax: number }> {
  const planMax = PLAN_MAX_CAP_THB[await getOrgPlan(orgId)];
  return { cap: Math.min(settings.monthlyCapThb, planMax), planMax };
}

const SETTINGS_KEY = "boss-brief-settings";
const RESULTS_KEY = "boss-brief-results";
const USAGE_KEY = "boss-brief-usage";
/** การ์ดโหลดรายการวันย้อนหลังกี่วัน (แบบย่อ) — เก่ากว่านี้ยังอยู่ในตาราง ใช้ถาม AI / สรุปรวมได้ */
const INDEX_DAYS = 60;
/** สรุปหลังปิดรอบกี่นาที (ให้คนที่ส่งตอนเส้นตายทัน) */
const AFTER_CLOSE_MIN = 5;
/** มีโพสต์ใหม่/แก้ไขหลังสรุปแล้ว — สรุปใหม่ได้ไม่ถี่กว่านี้ (ประหยัดเงิน) */
const REGEN_GAP_MS = 10 * 60_000;
/** สรุปซ้ำ (มีคนส่งช้า/แก้โพสต์หลังสรุปแล้ว) ได้ไม่เกินกี่ครั้งต่อรอบ และภายในกี่ชั่วโมงหลังปิดรอบ — 13/11/2569 กันเงินรั่ว
 *  (เดิมสรุปใหม่ทุกครั้งที่มีการแก้ ห่างกัน 10 นาที ไม่จำกัดจำนวน) */
const MAX_REGENS = 2;
const REGEN_WINDOW_MIN = 3 * 60;
const MAX_CONTENT = 500;

type Results = { briefs: Record<string, BossBrief> };

const bkkNow = (now = new Date()) => new Date(now.getTime());
const monthOf = (day: string) => day.slice(0, 7);
const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export async function readBriefSettings(orgId: string): Promise<BossBriefSettings> {
  const { data } = await readStore<Partial<BossBriefSettings>>(orgId, SETTINGS_KEY);
  const s = { ...DEFAULT_BRIEF_SETTINGS, ...(data ?? {}) };
  // ตั้งค่าที่บันทึกก่อนเปลี่ยนรุ่นเริ่มต้น (มีแต่ค่า sol ติดมาจากค่าเริ่มต้นเดิม) → ใช้รุ่นเริ่มต้นใหม่ · บันทึกใหม่เมื่อไรก็ใช้ค่าที่เลือก
  if ((data?.modelVersion ?? 0) < 2) return { ...s, askModel: DEFAULT_BRIEF_SETTINGS.askModel, detailModel: DEFAULT_BRIEF_SETTINGS.detailModel, modelVersion: 2 };
  return s;
}

export async function saveBriefSettings(orgId: string, patch: Partial<BossBriefSettings>): Promise<BossBriefSettings> {
  // เพดานที่ตั้งเกินแพ็กเกจไม่ได้ (เดิมเก็บได้ถึง ฿5,000 แล้วค่อยตัดตอนใช้ — ช่องในตั้งค่าเลยโชว์เลขที่ไม่ได้ใช้จริง)
  const planMax = PLAN_MAX_CAP_THB[await getOrgPlan(orgId)];
  for (let i = 0; i < 3; i++) {
    const { version } = await readStore<Partial<BossBriefSettings>>(orgId, SETTINGS_KEY);
    const cur = await readBriefSettings(orgId);
    const next: BossBriefSettings = {
      enabled: typeof patch.enabled === "boolean" ? patch.enabled : cur.enabled,
      topicIds: Array.isArray(patch.topicIds) ? [...new Set(patch.topicIds.filter((x) => typeof x === "string"))].slice(0, 50) : cur.topicIds,
      monthlyCapThb:
        typeof patch.monthlyCapThb === "number" && Number.isFinite(patch.monthlyCapThb) ? Math.max(0, Math.min(5000, planMax, Math.round(patch.monthlyCapThb))) : cur.monthlyCapThb,
      summaryModel: patch.summaryModel && MODEL_PRICES_USD[patch.summaryModel] ? patch.summaryModel : cur.summaryModel,
      askModel: patch.askModel && MODEL_PRICES_USD[patch.askModel] ? patch.askModel : cur.askModel,
      detailModel: patch.detailModel && MODEL_PRICES_USD[patch.detailModel] ? patch.detailModel : cur.detailModel,
      modelVersion: 2,
    };
    const w = version === 0 ? await createStoreIfAbsent(orgId, SETTINGS_KEY, next) : await writeStore(orgId, SETTINGS_KEY, next, version);
    if (w.ok) return next;
  }
  throw new Error("บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
}

/** ยอดใช้เดือนนี้ — เพดานยึด "ค่าที่สูงกว่า" ระหว่างยอดที่นับเองกับยอดจริงจาก OpenAI (ai-billing.ts) */
export async function readUsage(orgId: string, month: string): Promise<BriefUsageMonth> {
  const [{ data }, actual] = await Promise.all([readStore<Record<string, BriefUsageMonth>>(orgId, USAGE_KEY), readActualCost(orgId, month)]);
  const tracked = data?.[month] ?? { thb: 0, calls: 0 };
  const actualThb = actual ? actual.usd * THB_PER_USD : 0;
  return {
    thb: Math.max(tracked.thb, actualThb),
    calls: tracked.calls,
    trackedThb: tracked.thb,
    ...(actual ? { actualUsd: actual.usd, actualSyncedAt: actual.syncedAt } : {}),
  };
}

export async function addUsage(orgId: string, month: string, thb: number): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const { data, version } = await readStore<Record<string, BriefUsageMonth>>(orgId, USAGE_KEY);
    const all = { ...(data ?? {}) };
    const cur = all[month] ?? { thb: 0, calls: 0 };
    all[month] = { thb: Math.round((cur.thb + thb) * 10000) / 10000, calls: cur.calls + 1 };
    const w = version === 0 ? await createStoreIfAbsent(orgId, USAGE_KEY, all) : await writeStore(orgId, USAGE_KEY, all, version);
    if (w.ok) return;
  }
}

/*
 * ที่เก็บสรุป = ตาราง report_task.boss_briefs แถวละสรุป เก็บถาวร (13/11/2569)
 * เดิมเป็นก้อน JSON เดียวใน stores (เก็บ 14 วัน ทุกครั้งที่บันทึก/ถาม AI ต้องเขียนทั้งก้อน) — ตอนนี้เขียนแถวเดียว
 * ก้อนเดิม (ถ้ามี) คัดลอกเข้าตารางครั้งแรกที่อ่าน แล้วไม่แตะอีก (ไม่ลบ — ย้อนกลับได้)
 */
const legacyCopied = new Set<string>();
async function copyLegacyBriefs(orgId: string): Promise<void> {
  if (legacyCopied.has(orgId)) return;
  legacyCopied.add(orgId);
  const { data } = await readStore<Results>(orgId, RESULTS_KEY);
  const old = Object.values(data?.briefs ?? {});
  if (old.length === 0) return;
  const have = new Set((await prisma.reportBossBrief.findMany({ where: { orgId }, select: { id: true } })).map((r) => r.id));
  const todo = old.filter((b) => !have.has(b.id));
  if (todo.length) await prisma.reportBossBrief.createMany({ data: todo.map((b) => rowOf(orgId, b)), skipDuplicates: true });
}
const rowOf = (orgId: string, b: BossBrief) => ({
  orgId,
  id: b.id,
  topicId: b.topicId,
  day: b.day,
  isRange: !!b.rangeFrom,
  data: b as unknown as Prisma.InputJsonValue,
  generatedAt: new Date(b.generatedAt),
});
async function saveBrief(orgId: string, brief: BossBrief): Promise<void> {
  const row = rowOf(orgId, brief);
  await prisma.reportBossBrief.upsert({ where: { orgId_id: { orgId, id: brief.id } }, create: row, update: row });
}
async function getBrief(orgId: string, id: string): Promise<BossBrief | null> {
  await copyLegacyBriefs(orgId);
  const r = await prisma.reportBossBrief.findUnique({ where: { orgId_id: { orgId, id } }, select: { data: true } });
  return (r?.data as unknown as BossBrief) ?? null;
}
/** สรุปของห้อง (รอบปกติ/สรุปรวม) ตั้งแต่วัน `from` — ใช้ทั้งการ์ดและเครื่องมือ AI */
export async function listBriefs(orgId: string, opts: { topicId?: string; from?: string; to?: string; isRange?: boolean; take?: number }): Promise<BossBrief[]> {
  await copyLegacyBriefs(orgId);
  const rows = await prisma.reportBossBrief.findMany({
    where: {
      orgId,
      ...(opts.topicId ? { topicId: opts.topicId } : {}),
      ...(opts.isRange === undefined ? {} : { isRange: opts.isRange }),
      ...(opts.from || opts.to ? { day: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } } : {}),
    },
    orderBy: [{ day: "desc" }, { generatedAt: "desc" }],
    take: opts.take ?? 500,
    select: { data: true },
  });
  return rows.map((r) => r.data as unknown as BossBrief);
}
/**
 * แบบย่อสำหรับรายการวัน/วันอื่นๆ ของคนนี้ — ตัดรายละเอียดหนัก (รายการ/ถามตอบ/รายละเอียดรายคน) ออก
 * สีของคนใช้สีที่ AI ตัดสิน (ถ้ามี) จะได้ตรงกับที่เห็นตอนเปิดเต็ม
 */
function lightOf(b: BossBrief): BossBrief {
  return {
    ...b,
    items: { stuck: [], late: [], ask: [], done: [] },
    qa: [],
    people: b.people.map((p) => ({ ...p, worst: b.detail?.people[p.postId]?.color ?? p.worst })),
    ...(b.detail ? { detail: { roundKind: b.detail.roundKind, ...(b.detail.period ? { period: b.detail.period } : {}), urgent: [], decisions: [], carry: [], fixed: [], teams: [], people: {} } } : {}),
    light: true,
  };
}

export function costThb(model: string, usage: { prompt_tokens?: number; completion_tokens?: number } | undefined): number {
  const p = MODEL_PRICES_USD[model] ?? MODEL_PRICES_USD["gpt-6-sol"]!;
  return (((usage?.prompt_tokens ?? 0) * p.input + (usage?.completion_tokens ?? 0) * p.output) / 1_000_000) * THB_PER_USD;
}

/** client ของบริษัทนี้ — คีย์/Project แยกต่อบริษัทได้ (ai-billing.ts) */
async function openai(orgId: string): Promise<OpenAI> {
  return aiClientFor(orgId);
}

const postText = (p: ReportPost) =>
  [p.title, ...p.sections.flatMap((s) => [s.heading, ...s.bullets])].filter(Boolean).join("\n");

/** โพสต์ที่นับเข้ารอบนี้ของวันนั้น (กติกาเดียวกับตัวนับส่ง/หักคะแนน) */
function postsForRound(topic: ReportTopic, posts: ReportPost[], round: SubmissionRound, day: string, rounds: SubmissionRound[]): ReportPost[] {
  const dayPosts = posts.filter((p) => p.topicId === topic.id && !p.excludeFromSubmission && !p.retroFor && localDateStr(new Date(p.createdAt)) === day);
  const byAuthor = new Map<string, ReportPost[]>();
  for (const p of dayPosts) byAuthor.set(p.authorId, [...(byAuthor.get(p.authorId) ?? []), p]);
  const out: ReportPost[] = [];
  for (const list of byAuthor.values()) for (const p of list) if (attributePostToRound(p, rounds, list)?.id === round.id) out.push(p);
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const RANK: Record<BriefColor, number> = { red: 0, yellow: 1, green: 2, none: 3 };

/** รายเดือน = ตั้งวันที่ · รายสัปดาห์ = ส่ง 1–2 วันต่อสัปดาห์ · นอกนั้นรายวัน */
const periodOf = (round: SubmissionRound): NonNullable<BriefDetail["period"]> =>
  round.dayOfMonth ? "monthly" : round.weekdays && round.weekdays.length > 0 && round.weekdays.length <= 2 ? "weekly" : "daily";

/** มีรอบอื่นของวันเดียวกันที่ช้ากว่า = รอบนี้คือแผนงานของวันนี้ (รอบเช้า) · รอบสุดท้ายของวัน (หรือมีรอบเดียว) = ผลงาน */
const roundKindOf = (round: SubmissionRound, dayRounds: SubmissionRound[]): BriefDetail["roundKind"] =>
  dayRounds.some((r) => r.id !== round.id && minutesOf(r.time) > minutesOf(round.time)) ? "plan" : "result";

/**
 * รายงานก่อนหน้าที่ใช้เทียบ "ค้างมาหลายวัน / เมื่อวานค้างแต่เช้านี้ไม่พูดถึง" — ห้องเดียวกัน
 * รอบเย็น: 3 วันก่อนหน้า + โพสต์ก่อนหน้าของวันนี้ · รอบเช้า: เมื่อวานทั้งวัน · ไม่เกิน 40 โพสต์ล่าสุด
 */
function historyFor(
  topic: ReportTopic,
  all: ReportPost[],
  current: ReportPost[],
  kind: BriefDetail["roundKind"],
  day: string,
  period: NonNullable<BriefDetail["period"]> = "daily"
): ReportPost[] {
  const cur = new Set(current.map((p) => p.id));
  const plan = kind === "plan";
  // รายสัปดาห์ย้อน 3 สัปดาห์ · รายเดือนย้อน 3 เดือน (เทียบกับรายงานงวดก่อนของห้องเดียวกัน)
  const back = period === "monthly" ? 92 : period === "weekly" ? 21 : plan ? 1 : 3;
  const from = localDateStr(new Date(Date.parse(`${day}T12:00:00`) - back * 86_400_000));
  const firstAt = current[0]?.createdAt ?? `${day}T23:59:59`;
  return all
    .filter((p) => p.topicId === topic.id && !p.excludeFromSubmission && !p.retroFor && !cur.has(p.id))
    .filter((p) => {
      const d = localDateStr(new Date(p.createdAt));
      return d >= from && (d < day || (!plan && p.createdAt < firstAt));
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-40);
}

const IMPACTS: BriefImpact[] = ["เงิน", "ลูกค้า", "ความปลอดภัย", "กฎหมาย", "งานเดินไม่ได้"];
const asColor = (c: unknown): BriefColor => (c === "red" || c === "yellow" || c === "green" ? c : "none");
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v: unknown, max: number, n: number) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * สรุปละเอียดให้ Boss (13/11/2569) — AI ตัดสินว่าอะไรด่วน/อันตราย (ยกได้แม้คนเขียนไม่ใส่แดง), รอ Boss, ค้างข้ามวัน,
 * ภาพรวมทีม และรายคน (ทำอะไร/ติดอะไร/รออะไรจากใคร/จะทำต่อ) · ทุกข้ออ้างเลขรายงาน → แปลงกลับเป็น postId
 * ทีม = แผนกของคนส่งในระบบ · ล้ม = null (การ์ดใช้แบบเดิม)
 */
async function buildDetail(
  orgId: string,
  kind: BriefDetail["roundKind"],
  label: string,
  day: string,
  posts: ReportPost[],
  history: ReportPost[],
  settings: BossBriefSettings,
  nameOf: Map<string, string>,
  teamOf: Map<string, string>,
  period: NonNullable<BriefDetail["period"]> = "daily",
  /** ข้อความที่อ่านจากรูปแนบ (รายงาน weekly/monthly ที่ข้อมูลอยู่ในรูป) key = postId */
  imageText: Map<string, string> = new Map(),
  /** เงินที่เหลือของเดือนนี้ (บาท) — ค่ากรณีแย่สุดของการเรียกครั้งนี้เกิน = ไม่เรียก ("cap") */
  budgetLeft = Number.POSITIVE_INFINITY
): Promise<{ detail: BriefDetail; headline: string; oneLine: Map<string, string>; cost: number } | null | "cap"> {
  const byRef = new Map<number, ReportPost>();
  const row = (p: ReportPost, max: number) => {
    const ref = byRef.size + 1;
    byRef.set(ref, p);
    const img = imageText.get(p.id);
    const text = postText(p).slice(0, max) + (img ? `\n[ข้อความจากรูปที่แนบ]\n${img.slice(0, 2400)}` : "");
    return { ref, day: localDateStr(new Date(p.createdAt)), person: nameOf.get(p.authorId) ?? "ไม่ทราบชื่อ", team: teamOf.get(p.authorId) || "ไม่ระบุทีม", text };
  };
  const before = history.map((p) => row(p, 1500));
  const now = posts.map((p) => row(p, kind === "range" ? 900 : 2500));
  const nowRefs = new Set(now.map((r) => r.ref));
  const job =
    kind === "range"
      ? "นี่คือรายงานทั้งหมดของห้องในช่วงหลายวัน (หลายรอบ) Boss อยากรู้ภาพรวมทั้งช่วง: urgent = เรื่องด่วน/อันตรายที่ยังไม่จบ ณ วันสุดท้ายของช่วง · decisions = เรื่องที่ยังรอ Boss ตัดสินใจ · carry = เรื่องที่ค้างหรือเกิดซ้ำหลายวันในช่วงนี้ (since = วันแรกที่เจอ) · fixed = เรื่องที่แก้จบแล้วในช่วงนี้ · teams = ช่วงนี้แต่ละทีมเป็นยังไง · people = หนึ่งรายการต่อคน (ไม่ใช่ต่อรายงาน) ref = รายงานล่าสุดของคนนั้น did = งานหลักที่ทำในช่วงนี้ next = []"
      : period !== "daily" && kind === "result"
      ? `นี่คือรายงานประจำ${period === "weekly" ? "สัปดาห์" : "เดือน"} = ผลงานของ${period === "weekly" ? "สัปดาห์" : "เดือน"}นี้ Boss อยากรู้: ใครทำอะไร ได้ผลยังไง เจออะไร ติดอะไร รออะไรจาก Boss อะไรด่วน/อันตราย แต่ละทีมเป็นยังไง และเรื่องที่ค้างข้ามงวดจากรายงานงวดก่อน (ใส่ใน carry พร้อม since = วันแรกที่เจอ) เรื่องที่เคยค้างแต่งวดนี้แก้แล้วใส่ใน fixed next = แผน${period === "weekly" ? "สัปดาห์" : "เดือน"}หน้า`
      : kind === "plan"
      ? "รอบนี้คือรอบเช้า = แผนงานของวันนี้ Boss อยากรู้: วันนี้ใคร/ทีมไหนจะทำอะไร มีอะไรเสี่ยงหรือด่วน มีอะไรรอ Boss และเรื่องที่เมื่อวานยังค้าง/มีปัญหา แต่แผนเช้านี้ไม่มีใครพูดถึง (เสี่ยงหลุด → ใส่ใน carry ไม่ต้องมี since)"
      : "รอบนี้คือรอบเย็น = ผลงานของวันนี้ Boss อยากรู้: ใครทำอะไร เจออะไร ติดอะไร รออะไรจาก Boss อะไรด่วน/อันตราย แต่ละทีมเป็นยังไง และเรื่องที่ค้างมาหลายวัน (ใส่ใน carry พร้อม since = วันแรกที่เจอในรายงาน) เรื่องที่เคยค้างแต่วันนี้แก้แล้วใส่ใน fixed";
  const prompt = `คุณเป็นเลขาสรุปรายงานประจำวันให้ Boss เจ้าของบริษัท Boss ไม่อ่านรายงานเอง ${job}
กติกา: ภาษาไทยง่าย ประโยคสั้น ห้ามแต่งเรื่องที่ไม่มีในรายงาน ทุกข้อต้องมี ref = เลขรายงานต้นทาง ถ้าคนเขียนใส่ 🟢 แต่เนื้อหาเสี่ยงจริงให้ยกขึ้น urgent ได้ urgent = กระทบ ${IMPACTS.join(" / ")} เท่านั้น ไม่ใช่งานปกติที่ยังไม่เสร็จ
รายงานก่อนหน้า (ใช้เทียบเท่านั้น):
${JSON.stringify(before)}

รายงานที่ต้องสรุป (${label}):
${JSON.stringify(now)}

ตอบ JSON:
{"headline":"ภาพรวมรอบนี้ 1 ประโยค ≤100 ตัวอักษร ไม่ใส่เลข ref",
"urgent":[{"title":"≤60","impact":"${IMPACTS.join("|")}","why":"ถ้าไม่ทำอะไรจะเกิดอะไร ≤90","level":"ด่วนมาก|ด่วน","writerColor":"red|yellow|green|none","ref":0}],
"decisions":[{"what":"Boss ต้องตัดสินใจเรื่องอะไร ≤80","firstSeen":"YYYY-MM-DD วันแรกที่ขอ","ref":0}],
"teams":[{"team":"ชื่อทีมตาม team ของรายงาน","color":"red|yellow|green","line":"ทีมนี้${kind === "plan" ? "วันนี้จะทำอะไร" : kind === "range" ? "ช่วงนี้เป็นยังไง" : "วันนี้เป็นยังไง"} ≤90","people":["ชื่อคน"]}],
"people":[{"ref":0,"color":"red|yellow|green","oneLine":"${kind === "plan" ? "วันนี้จะทำอะไร มีอะไรเสี่ยง" : "ทำงานไหน เจออะไร ตอนนี้เป็นยังไง"} ≤90 ไม่ใส่ชื่อคน","did":["${kind === "plan" ? "วันนี้จะทำ" : kind === "range" ? "งานหลักที่ทำในช่วงนี้" : "ทำอะไรวันนี้"} ≤60"],"stuck":["ติดอะไร/ปัญหา/ความเสี่ยง ≤70"],"waiting":[{"what":"รออะไร ≤60","from":"รอใคร"}],"next":[${kind === "result" ? `"${period === "weekly" ? "สัปดาห์หน้าจะทำ" : period === "monthly" ? "เดือนหน้าจะทำ" : "พรุ่งนี้จะทำ"} ≤60"` : ""}]}],
"carry":[{"what":"≤80","since":"YYYY-MM-DD หรือว่าง","ref":0}],
"fixed":[{"what":"เรื่องที่เคยค้างแต่แก้แล้ว ≤70","ref":0}]}
${kind === "range" ? "people หนึ่งรายการต่อคน ครบทุกคนที่ส่งในช่วงนี้" : "people ต้องมีครบทุกรายงานในรอบนี้ ref ของ people/urgent/decisions ต้องเป็นรายงานรอบนี้"} did ไม่เกิน 5 ข้อ รวมงานเล็กๆ เข้าด้วยกัน ไม่มี = []`;
  // ค่ากรณีแย่สุด = ขนาดข้อความที่ส่งจริง + ตอบยาวสุด 8,000 token — เกินเงินที่เหลือ = ไม่เรียกเลย (ไม่เสี่ยงเกินเพดาน)
  const MAX_OUT = 8000;
  if (worstCaseThb(MODEL_PRICES_USD[settings.detailModel] ?? MODEL_PRICES_USD["gpt-6-sol"]!, prompt.length, MAX_OUT, THB_PER_USD) > budgetLeft) return "cap";
  try {
    const res = await (await openai(orgId)).chat.completions.create({
      model: settings.detailModel,
      response_format: { type: "json_object" },
      max_completion_tokens: MAX_OUT,
      messages: [{ role: "user", content: prompt }],
    });
    const cost = costThb(settings.detailModel, res.usage);
    await addUsage(orgId, monthOf(day), cost);
    const out = JSON.parse(res.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
    const arr = (k: string) => (Array.isArray(out[k]) ? (out[k] as Record<string, unknown>[]) : []);
    const postOf = (ref: unknown, mustBeNow = false) => {
      const n = Number(ref);
      if (mustBeNow && !nowRefs.has(n)) return null;
      return byRef.get(n) ?? null;
    };
    const who = (p: ReportPost) => nameOf.get(p.authorId) ?? "ไม่ทราบชื่อ";
    const detail: BriefDetail = { roundKind: kind, ...(kind === "range" ? {} : { period }), urgent: [], decisions: [], carry: [], fixed: [], teams: [], people: {} };
    const oneLine = new Map<string, string>();
    for (const x of arr("urgent")) {
      const p = postOf(x.ref, true);
      const title = str(x.title, 120);
      if (!p || !title) continue;
      const impact = IMPACTS.includes(x.impact as BriefImpact) ? (x.impact as BriefImpact) : "งานเดินไม่ได้";
      detail.urgent.push({ title, postId: p.id, name: who(p), impact, why: str(x.why, 200), level: x.level === "ด่วนมาก" ? "ด่วนมาก" : "ด่วน", writerRed: x.writerColor === "red" });
    }
    detail.urgent.sort((a, b) => (a.level === b.level ? 0 : a.level === "ด่วนมาก" ? -1 : 1));
    for (const x of arr("decisions")) {
      const p = postOf(x.ref, true);
      const what = str(x.what, 160);
      if (!p || !what) continue;
      detail.decisions.push({ what, postId: p.id, name: who(p), since: isDay(x.firstSeen) && x.firstSeen <= day ? x.firstSeen : day });
    }
    for (const x of arr("carry")) {
      const p = postOf(x.ref);
      const what = str(x.what, 160);
      if (!p || !what) continue;
      detail.carry.push({ what, postId: p.id, name: who(p), ...(isDay(x.since) && x.since < day ? { since: x.since } : {}) });
    }
    detail.carry.sort((a, b) => (a.since ?? "9").localeCompare(b.since ?? "9"));
    for (const x of arr("fixed")) {
      const p = postOf(x.ref);
      const what = str(x.what, 140);
      if (p && what) detail.fixed.push({ what, name: who(p) });
    }
    for (const x of arr("teams")) {
      const team = str(x.team, 60);
      if (team) detail.teams.push({ team, color: asColor(x.color), line: str(x.line, 200), names: strs(x.people, 40, 30) });
    }
    detail.teams.sort((a, b) => RANK[a.color] - RANK[b.color]);
    for (const x of arr("people")) {
      const p = postOf(x.ref, true);
      if (!p) continue;
      const line = str(x.oneLine, 160);
      if (line) oneLine.set(p.id, line);
      detail.people[p.id] = {
        team: teamOf.get(p.authorId) || "",
        color: asColor(x.color),
        did: strs(x.did, 140, 6),
        stuck: strs(x.stuck, 160, 6),
        waiting: (Array.isArray(x.waiting) ? (x.waiting as Record<string, unknown>[]) : [])
          .map((w) => ({ what: str(w?.what, 140), from: str(w?.from, 60) }))
          .filter((w) => w.what)
          .slice(0, 5),
        next: strs(x.next, 140, 5),
      };
    }
    if (Object.keys(detail.people).length === 0) return null;
    return { detail, headline: str(out.headline, 200), oneLine, cost };
  } catch (e) {
    console.error("[boss-brief] detail", orgId, e instanceof Error ? e.message : e);
    return null;
  }
}


/** สร้าง/สร้างใหม่ สรุปของรอบหนึ่ง — ประเภท/สีจากกฎ · ใจความย่อ + ภาพรวมจาก AI (ถ้าไม่เกินเพดาน) */
async function buildBrief(
  orgId: string,
  topic: ReportTopic,
  round: SubmissionRound,
  day: string,
  posts: ReportPost[],
  settings: BossBriefSettings,
  signature: string,
  keepQa: BossBrief["qa"],
  history: ReportPost[] = [],
  kind: BriefDetail["roundKind"] = "result"
): Promise<BossBrief> {
  const period = periodOf(round);
  const topics = round.requiredTopics ?? [];
  const users = await prisma.user.findMany({
    where: { orgId, id: { in: [...new Set([...posts, ...history].map((p) => p.authorId))] } },
    select: { id: true, name: true, department: { select: { name: true } } },
  });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const teamOf = new Map(users.map((u) => [u.id, u.department?.name ?? ""]));
  const parsed = posts.map((p) => ({
    post: p,
    name: nameOf.get(p.authorId) ?? "ไม่ทราบชื่อ",
    blocks: splitReportTopics(postText(p), topics)
      .filter((b) => !b.section)
      .map((b) => ({ ...b, kind: briefKindOfTopic(b.topic), nothing: isNothing(b.content) })),
  }));

  // AI: ย่อใจความทีละหัวข้อ + 1 บรรทัดต่อคน + ภาพรวม 1 ประโยค
  let headline = "";
  const oneLine = new Map<string, string>();
  const shorts = new Map<string, string>(); // `${postId}|${i}`
  let cost = 0;
  let aiSkipped: BossBrief["aiSkipped"];
  let detail: BriefDetail | undefined;
  // คุมเงิน (13/11/2569 "เกินได้นิดหน่อย ห้ามบานปลาย"): ต่อคิวต่อบริษัท + เช็กเงินที่เหลือกับค่ากรณีแย่สุดของแต่ละการเรียก (ai-budget.ts)
  let left = 0;
  await withAiLock(orgId, async () => {
    left = (await effectiveCap(orgId, settings)).cap - (await readUsage(orgId, monthOf(day))).thb;
    if (left < estimateThb(settings.detailModel, "summary")) {
      aiSkipped = "cap";
      return;
    }
    if (parsed.length === 0) return;
    // รอบรายสัปดาห์/รายเดือน: ข้อมูลมักอยู่ในรูป (คนละ 1 รูป) → อ่านรูปเป็นข้อความครั้งเดียว เก็บไว้ใช้ซ้ำ · รอบรายวันไม่อ่านรูป (รูปหน้างาน)
    let imageText = new Map<string, string>();
    if (period !== "daily") {
      const r = await readReportImages(orgId, [...posts, ...history], settings, left);
      imageText = r.text;
      left -= r.spent;
    }
    // สรุปละเอียดก่อน (13/11/2569) — ได้ = ใช้ภาพรวม/บรรทัดต่อคนจากตัวนี้ ไม่ต้องเรียกแบบเดิมซ้ำ · ล้ม = ตกไปใช้แบบเดิม
    const d = await buildDetail(orgId, kind, `${round.label} ${day}`, day, posts, history, settings, nameOf, teamOf, period, imageText, left);
    if (d === "cap") {
      aiSkipped = "cap";
      return;
    }
    if (d) {
      detail = d.detail;
      headline = d.headline;
      for (const [id, line] of d.oneLine) oneLine.set(id, line);
      cost += d.cost;
      left -= d.cost;
      return;
    }
    await legacySummary();
  });
  async function legacySummary() {
    const input = parsed.map((x) => ({
      id: x.post.id,
      name: x.name,
      topics: x.blocks.map((b, i) => ({ i, topic: b.topic, text: b.nothing ? "ไม่มี" : b.content.slice(0, MAX_CONTENT) })),
    }));
    if (worstCaseThb(MODEL_PRICES_USD[settings.summaryModel] ?? MODEL_PRICES_USD["gpt-6-sol"]!, JSON.stringify(input).length + 800, 6000, THB_PER_USD) > left) {
      aiSkipped = "cap";
      return;
    }
    try {
      const res = await (await openai(orgId)).chat.completions.create({
        model: settings.summaryModel,
        response_format: { type: "json_object" },
        max_completion_tokens: 6000,
        messages: [
          {
            role: "system",
            content:
              "คุณย่อรายงานประจำวันของพนักงานให้ Boss อ่านเร็ว ภาษาไทยง่าย ประโยคสั้น ห้ามแต่งข้อมูลที่ไม่มีในรายงาน ห้ามใส่ชื่อหัวข้อซ้ำในใจความ ตอบเป็น JSON เท่านั้น",
          },
          {
            role: "user",
            content: `รายงานรอบ "${round.label}" ห้อง "${topic.name}" วันที่ ${day}:\n${JSON.stringify(input)}\n\nตอบ JSON: {"headline":"ภาพรวมรอบนี้ 1 ประโยค ไม่เกิน 90 ตัวอักษร บอกเรื่องที่สำคัญที่สุด","posts":[{"id":"...","oneLine":"คนนี้ทำงานไหน เจออะไร ตอนนี้เป็นยังไง ไม่เกิน 90 ตัวอักษร ถ้ามีปัญหา/ค้าง/รอตัดสินใจ ให้พูดเรื่องนั้นก่อน ไม่ต้องใส่ชื่อคน","shorts":[{"i":0,"short":"ใจความหัวข้อนี้: งานไหน เจออะไร ยังไง ไม่เกิน 70 ตัวอักษร"}]}]} ใส่ shorts ทุกหัวข้อที่ text ไม่ใช่ "ไม่มี"`,
          },
        ],
      });
      const legacyCost = costThb(settings.summaryModel, res.usage);
      cost += legacyCost;
      const out = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { headline?: string; posts?: { id: string; oneLine?: string; shorts?: { i: number; short: string }[] }[] };
      headline = String(out.headline ?? "").slice(0, 200);
      for (const p of out.posts ?? []) {
        if (p.oneLine) oneLine.set(p.id, String(p.oneLine).slice(0, 160));
        for (const s of p.shorts ?? []) if (s && typeof s.short === "string") shorts.set(`${p.id}|${s.i}`, s.short.slice(0, 200));
      }
      await addUsage(orgId, monthOf(day), legacyCost);
    } catch (e) {
      console.error("[boss-brief] AI", orgId, e instanceof Error ? e.message : e);
      aiSkipped = "error";
    }
  }

  const firstLine = (s: string) => (s.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 120);
  const items: Record<BriefKind, BriefItem[]> = { stuck: [], late: [], ask: [], done: [] };
  const people = parsed.map((x) => {
    let worst: BriefColor = "none";
    x.blocks.forEach((b, i) => {
      const color: BriefColor = b.color ?? "none";
      if (RANK[color] < RANK[worst]) worst = color;
      if (!b.kind || b.nothing) return;
      let text = shorts.get(`${x.post.id}|${i}`) ?? firstLine(b.content);
      if (isNothing(text)) {
        // AI ย่อแล้วเหลือแค่ "ไม่มี…" — ตัดทิ้งได้เฉพาะที่คนเขียนไม่ได้ใส่สีเตือน
        // ถ้าคนเขียนใส่ 🔴/🟡 เอง AI ต้องไม่ทำให้เรื่องหายจากการ์ด → ใช้ข้อความจริงบรรทัดแรกแทน (12/11/2569)
        if (color !== "red" && color !== "yellow") return;
        text = firstLine(b.content);
      }
      items[b.kind].push({ postId: x.post.id, userId: x.post.authorId, name: x.name, text, color });
    });
    return { postId: x.post.id, userId: x.post.authorId, name: x.name, oneLine: oneLine.get(x.post.id) ?? firstLine(x.post.title), worst };
  });
  for (const k of Object.keys(items) as BriefKind[]) items[k].sort((a, b) => RANK[a.color] - RANK[b.color]);
  people.sort((a, b) => RANK[a.worst] - RANK[b.worst]);

  return {
    id: `${day}|${topic.id}|${round.id}`,
    topicId: topic.id,
    topicName: topic.name,
    roundId: round.id,
    roundLabel: round.label,
    roundTime: round.time,
    day,
    generatedAt: new Date().toISOString(),
    signature,
    postCount: posts.length,
    headline,
    people,
    items,
    qa: keepQa,
    model: detail ? settings.detailModel : settings.summaryModel,
    costThb: cost,
    ...(detail ? { detail } : {}),
    ...(aiSkipped ? { aiSkipped } : {}),
  };
}

const LOCKS_KEY = "boss-brief-locks";
const LOCK_MS = 3 * 60_000;

/** จองสิทธิ์สรุปรอบนี้ 3 นาที (compare-and-swap ผ่าน version) — ได้ false = มีอีกทางกำลังทำอยู่ ข้ามไป */
async function claimBriefLock(orgId: string, id: string): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    const { data, version } = await readStore<Record<string, string>>(orgId, LOCKS_KEY);
    const now = Date.now();
    const locks = Object.fromEntries(Object.entries(data ?? {}).filter(([, at]) => now - Date.parse(at) < LOCK_MS));
    if (locks[id]) return false;
    locks[id] = new Date(now).toISOString();
    const w = version === 0 ? await createStoreIfAbsent(orgId, LOCKS_KEY, locks) : await writeStore(orgId, LOCKS_KEY, locks, version);
    if (w.ok) return true;
  }
  return false;
}

async function bossUserIds(orgId: string): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { orgId, isActive: true, roles: { some: { role: { code: "CEO" } } } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * สรุปซ้ำมีอะไรใหม่ที่ Boss ควรรู้ — "" = ไม่มี (ไม่ต้องแจ้ง)
 * เทียบจาก "รายงานต้นทาง" ไม่ใช่ถ้อยคำ — AI เขียนเรื่องเดิมด้วยคำใหม่ได้ทุกครั้ง ถ้าเทียบคำจะแจ้งเตือนผิด
 * เรื่องด่วน/รอตัดสินใจใหม่ = มาจากรายงานที่รอบก่อนไม่มีเรื่องประเภทนั้นเลย
 */
function briefChangeText(prev: BossBrief, next: BossBrief): string {
  const freshPosts = (a: { postId: string }[], b: { postId: string }[]) => {
    const old = new Set(a.map((x) => x.postId));
    return new Set(b.filter((x) => !old.has(x.postId)).map((x) => x.postId)).size;
  };
  const more = next.postCount - prev.postCount;
  const urgent = freshPosts(prev.detail?.urgent ?? [], next.detail?.urgent ?? []);
  const decide = freshPosts(prev.detail?.decisions ?? [], next.detail?.decisions ?? []);
  return [more > 0 ? `ส่งเพิ่ม ${more} คน` : "", urgent > 0 ? `🚨 เรื่องด่วนใหม่ ${urgent}` : "", decide > 0 ? `🙋 รอคุณตัดสินใจเพิ่ม ${decide}` : ""].filter(Boolean).join(" · ");
}

function notifyText(b: BossBrief): string {
  if (b.detail) {
    const d = b.detail;
    return `สรุปรอบ ${b.roundLabel} พร้อมแล้ว · ส่ง ${b.postCount} คน · 🚨 ด่วน ${d.urgent.length} · 🙋 รอคุณ ${d.decisions.length} · ⏳ ค้าง ${d.carry.length}`;
  }
  const n = (k: BriefKind) => b.items[k].length;
  const red = b.items.stuck.filter((i) => i.color === "red").length + b.items.late.filter((i) => i.color === "red").length;
  return `สรุปรอบ ${b.roundLabel} พร้อมแล้ว · ⚠️ ปัญหา ${n("stuck")}${red ? ` (🔴 ${red})` : ""} · ⏰ ล่าช้า ${n("late")} · 🙋 รอคุณ ${n("ask")}`;
}

/**
 * รอบตรวจของบริษัทหนึ่ง: รอบไหนปิดไปแล้ว ≥5 นาทีวันนี้ แต่ยังไม่มีสรุป → สรุป + แจ้ง Boss
 * มีสรุปแล้วแต่มีคนส่งช้า/แก้ไข → สรุปใหม่ (ไม่แจ้งซ้ำ) ไม่ถี่กว่า 10 นาที
 */
export async function runBossBriefSweep(orgId: string, now = new Date()): Promise<{ made: number; updated: number }> {
  const settings = await readBriefSettings(orgId);
  const result = { made: 0, updated: 0 };
  if (!settings.enabled || settings.topicIds.length === 0) return result;
  if (!planAtLeast(await getOrgPlan(orgId), "PRO")) return result;
  const today = localDateStr(bkkNow(now));
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const { data: feed } = await readStoreCached<{ topics?: ReportTopic[]; posts?: ReportPost[] }>(orgId, "report-feed");
  if (!feed?.topics) return result;
  const briefs = Object.fromEntries((await listBriefs(orgId, { from: today, to: today, isRange: false })).map((b) => [b.id, b]));

  for (const topicId of settings.topicIds) {
    const topic = feed.topics.find((t) => t.id === topicId);
    if (!topic) continue;
    const rounds = effectiveRoundsOf(topic).filter((r) => roundRunsOnDay(r, today));
    for (const round of rounds) {
      // ห้องรายสัปดาห์/รายเดือนที่ไม่ได้ตั้งหัวข้อบังคับก็สรุปได้ (13/11/2569 "daily weekly monthly ต้องเก็บและให้ AI วิเคราะห์")
      // — สรุปละเอียดอ่านรายงานทั้งก้อน ไม่ต้องรู้หัวข้อ · กล่องนับแบบเดิมจะว่าง (ใช้เฉพาะตอน AI ล้ม)
      if (nowMin < minutesOf(round.time) + AFTER_CLOSE_MIN) continue;
      const posts = postsForRound(topic, feed.posts ?? [], round, today, rounds);
      if (posts.length === 0) continue;
      const signature = posts.map((p) => `${p.id}@${p.editedAt ?? p.createdAt}`).join(",");
      const id = `${today}|${topic.id}|${round.id}`;
      const prev = briefs[id];
      // รอบที่เคยข้าม AI เพราะเงินไม่พอ แล้ว Boss เพิ่มเพดานทีหลัง → สรุปให้ใหม่ (ไม่นับเป็นสรุปซ้ำ) แต่เฉพาะตอนเงินพอแล้วจริง
      // (13/11/2569 ผู้ใช้: "ถึงเพดานแล้ว จนกว่าจะปรับ" — เดิมรอบนั้นค้าง "ไม่มีใจความย่อ" ไปตลอดเพราะโพสต์ไม่เปลี่ยน)
      const capRetry = prev?.aiSkipped === "cap";
      if (capRetry) {
        const used = (await readUsage(orgId, monthOf(today))).thb;
        if (used + estimateThb(settings.detailModel, "summary") > (await effectiveCap(orgId, settings)).cap) continue;
      } else {
        if (prev && prev.signature === signature) continue;
        if (prev && Date.now() - Date.parse(prev.generatedAt) < REGEN_GAP_MS) continue;
        if (prev && ((prev.regens ?? 0) >= MAX_REGENS || nowMin > minutesOf(round.time) + REGEN_WINDOW_MIN)) continue;
      }
      // จองในฐานข้อมูลก่อนเรียก AI — การเปิดหน้ากับ cron อาจเริ่มพร้อมกัน (ตัวกันในหน่วยความจำไม่ข้ามกันระหว่าง route)
      if (!(await claimBriefLock(orgId, id))) continue;
      const brief = await buildBrief(orgId, topic, round, today, posts, settings, signature, prev?.qa ?? [], historyFor(topic, feed.posts ?? [], posts, roundKindOf(round, rounds), today, periodOf(round)), roundKindOf(round, rounds));
      if (prev) brief.regens = (prev.regens ?? 0) + (capRetry ? 0 : 1);
      await saveBrief(orgId, brief);
      const link = `/chat-report/report-feed?topic=${encodeURIComponent(topic.id)}&tab=stats`;
      if (prev) {
        result.updated++;
        // สรุปซ้ำแจ้ง Boss เฉพาะเมื่อมีของใหม่จริง (คนส่งเพิ่ม / เรื่องด่วน / เรื่องรอตัดสินใจใหม่) — แค่แก้คำในโพสต์ไม่แจ้ง ไม่กวน
        // (13/11/2569 ผู้ใช้: "ถ้ารอบแรกยังไม่ครบ แล้วสรุปซ้ำ บอสไม่ได้แจ้งเตือนใหม่เลยหรอ")
        const change = capRetry ? notifyText(brief) : briefChangeText(prev, brief);
        if (change) {
          const bosses = await bossUserIds(orgId);
          await writeOwnNotificationsForUsers(
            orgId,
            bosses.map((uid) => ({
              id: `boss-brief|${id}|${capRetry ? "cap" : `u${brief.regens}`}|${uid}`,
              userId: uid,
              byUserId: "system",
              message: `[${topic.name}] ${capRetry ? "" : `อัปเดตสรุปรอบ ${brief.roundLabel}: `}${change}`,
              link,
            }))
          );
        }
      } else {
        result.made++;
        const bosses = await bossUserIds(orgId);
        await writeOwnNotificationsForUsers(
          orgId,
          bosses.map((uid) => ({
            id: `boss-brief|${id}|${uid}`,
            userId: uid,
            byUserId: "system",
            // ข้าม AI เพราะเงินไม่พอ = บอกตรง ๆ ไม่ใช่ "พร้อมแล้ว · ปัญหา 0" (ชวนเข้าใจว่าไม่มีเรื่องอะไร)
            message: brief.aiSkipped === "cap"
              ? `[${topic.name}] สรุปรอบ ${brief.roundLabel} ยังไม่ได้ย่อ: ค่า AI เดือนนี้ใกล้ถึงเพดานแล้ว · เพิ่มเพดานในตั้งค่าสรุป แล้วระบบจะสรุปรอบนี้ให้เองภายใน 1 นาที`
              : `[${topic.name}] ${notifyText(brief)}`,
            link,
          }))
        );
      }
    }
  }
  return result;
}

/** cron ทุกนาที (พ่วงกับ attendance-chat) — ไม่มีรอบไหนถึงเวลา = จบเร็ว */
export async function runBossBriefAllOrgs(now = new Date()) {
  const orgs = await prisma.organization.findMany({ where: { isActive: true }, select: { id: true } });
  const out = { orgs: orgs.length, made: 0, updated: 0, errors: [] as string[] };
  for (const { id } of orgs) {
    if (!claimSweep("boss-brief", id, 50_000)) continue;
    try {
      // ย่อสรุปเก่ากว่า 12 เดือน — วันละครั้งต่อบริษัท (ไม่เรียก AI)
      if (claimSweep("boss-brief-compact", id, 12 * 3_600_000)) await compactOldBriefs(id).catch((e) => console.error("[cron] boss-brief compact", id, e));
      // ยอดจริงจาก OpenAI ทุก 3 ชม. (ต้องมี OPENAI_ADMIN_KEY + projectId) — ไม่มี = ข้ามเงียบ ๆ
      if (claimSweep("boss-brief-cost-sync", id, 3 * 3_600_000)) await syncActualCost(id, now).catch((e) => console.error("[cron] ai cost sync", id, e));
      const r = await runBossBriefSweep(id, now);
      out.made += r.made;
      out.updated += r.updated;
    } catch (e) {
      console.error("[cron] boss-brief", id, e);
      out.errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      releaseSweep("boss-brief", id);
    }
  }
  return out;
}

/** สำหรับการ์ด — สรุปของห้องนี้ (วันนี้และเมื่อวาน ใหม่สุดก่อน) */
export async function briefViewFor(orgId: string, topicId: string, isBoss: boolean, currentId?: string): Promise<BossBriefView> {
  const settings = await readBriefSettings(orgId);
  const today = localDateStr(new Date());
  const month = monthOf(today);
  const empty: BossBriefView = { allowed: false, settings, roundsWithTopics: [], briefs: [], usage: { month, thb: 0, calls: 0, capThb: settings.monthlyCapThb }, generating: false, ranges: [], rangePending: [], rangeFailed: [] };
  if (!isBoss) return { ...empty, reason: "not-boss" };
  if (!planAtLeast(await getOrgPlan(orgId), "PRO")) return { ...empty, reason: "plan" };
  const since = localDateStr(new Date(Date.now() - INDEX_DAYS * 86_400_000));
  const [{ data: feed }, dayBriefs, rangeBriefs, usage] = await Promise.all([
    readStoreCached<{ topics?: ReportTopic[] }>(orgId, "report-feed"),
    listBriefs(orgId, { topicId, from: since, isRange: false }),
    listBriefs(orgId, { topicId, isRange: true, take: 10 }),
    readUsage(orgId, month),
  ]);
  const topic = feed?.topics?.find((t) => t.id === topicId);
  const roundsWithTopics = topic
    ? effectiveRoundsOf(topic).map((r) => ({ id: r.id, label: r.label, time: r.time }))
    : [];
  // รายการวันย้อนหลัง 60 วันแบบย่อ + สรุปที่กำลังดูแบบเต็มอันเดียว (เดิมส่งทุกสรุปแบบเต็มทุกนาที)
  const sorted = dayBriefs.sort((a, b) => b.day.localeCompare(a.day) || minutesOf(b.roundTime) - minutesOf(a.roundTime));
  const ranges = rangeBriefs.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  const curFull = (currentId && [...sorted, ...ranges].find((b) => b.id === currentId)) || sorted[0] || null;
  const briefs = sorted.map(lightOf);
  // สถานะงานสรุปรวมในหน่วยความจำ ใส่รหัสบริษัทนำหน้าเสมอ (ห้องของคนละบริษัทอาจมีรหัสเดียวกัน) — ส่งให้หน้าจอเฉพาะของบริษัทนี้
  const jobs = rangeJobs();
  const prefix = `${orgId}::range|${topicId}|`;
  const strip = (k: string) => k.slice(orgId.length + 2);
  const rangePending = [...jobs.running].filter((k) => k.startsWith(prefix)).map(strip);
  const rangeFailed = [...jobs.failed.entries()].filter(([k, f]) => k.startsWith(prefix) && Date.now() - f.at < 10 * 60_000).map(([k, f]) => ({ id: strip(k), error: f.error }));
  const { cap, planMax } = await effectiveCap(orgId, settings);
  return {
    allowed: true, settings, roundsWithTopics, briefs, current: curFull,
    usage: { month, thb: usage.thb, calls: usage.calls, capThb: cap, planMaxThb: planMax, trackedThb: usage.trackedThb, actualUsd: usage.actualUsd, actualSyncedAt: usage.actualSyncedAt },
    generating: false, ranges: ranges.map(lightOf), rangePending, rangeFailed,
  };
}

/**
 * Boss ถามต่อในการ์ด — 13/11/2569 ขยายให้รู้ข้อมูลทั้งบริษัท (company-ai.ts: AI เรียกเครื่องมือค้นรายงานทุกห้อง/แชทกลุ่ม/งาน/
 * ใบซ่อม/สั่งซื้อ/คำขอเงิน/ลงเวลา/ลา/เงินเดือน/คะแนน เอง) · สรุปที่เปิดอยู่เป็นบริบทเริ่มต้น · เดิมเห็นแค่ห้องนี้ 3 วัน
 */
export async function askBrief(orgId: string, briefId: string, question: string): Promise<{ ok: true; brief: BossBrief } | { ok: false; error: string }> {
  const q = question.trim().slice(0, 500);
  if (!q) return { ok: false, error: "พิมพ์คำถามก่อน" };
  const settings = await readBriefSettings(orgId);
  const today = localDateStr(new Date());
  const usage = await readUsage(orgId, monthOf(today));
  const { cap } = await effectiveCap(orgId, settings);
  if (usage.thb + estimateThb(settings.askModel, "ask") > cap) return { ok: false, error: `ใกล้ครบเพดาน ฿${cap} ของเดือนนี้แล้ว` };
  const brief = await getBrief(orgId, briefId);
  if (!brief) return { ok: false, error: "ไม่พบสรุปนี้" };
  return withAiLock(orgId, async () => {
  // อ่านยอดใหม่ในคิว — อีกงานอาจเพิ่งใช้เงินไป
  const leftNow = (await effectiveCap(orgId, settings)).cap - (await readUsage(orgId, monthOf(today))).thb;
  if (leftNow < estimateThb(settings.askModel, "ask")) return { ok: false as const, error: `ใกล้ครบเพดาน ฿${cap} ของเดือนนี้แล้ว` };
  try {
    const r = await askCompany({ orgId, question: q, model: settings.askModel, brief, history: brief.qa, costOf: costThb, budgetThb: leftNow });
    await addUsage(orgId, monthOf(today), r.costThb);
    console.log("[boss-brief] ask", orgId, `฿${r.costThb.toFixed(2)}`, r.tools.join(","));
    // อ่านล่าสุดอีกรอบก่อนต่อท้าย (รอบตรวจอาจสรุปใหม่ระหว่าง AI กำลังตอบ) — แถวเดียว ไม่ต้องเขียนทั้งก้อนแล้ว
    const cur = (await getBrief(orgId, briefId)) ?? brief;
    const next = { ...cur, qa: [...cur.qa, { at: new Date().toISOString(), q, a: r.answer, costThb: r.costThb, sources: [...new Set(r.tools)] }].slice(-20) };
    await saveBrief(orgId, next);
    return { ok: true as const, brief: next };
  } catch (e) {
    console.error("[boss-brief] ask", orgId, e instanceof Error ? e.message : e);
    return { ok: false as const, error: "AI ตอบไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
  });
}

/* ───────── สรุปรวมหลายวัน (13/11/2569 ผู้ใช้: "ต้องมีสรุปรวมสิ") ─────────
 * Boss เลือกช่วงวันเอง → AI สรุปรายงานทั้งช่วงเป็นแบบเดียวกับสรุปรอบ (ด่วน/รอคุณ/ค้างหรือเกิดซ้ำ/ทีม/รายคน)
 * ใช้เวลา ~30–60 วิ → ทำเบื้องหลัง (ไม่ค้าง request) การ์ดถามซ้ำจนเสร็จ · เก็บผลไว้ เปิดซ้ำไม่เสียเงิน
 * ช่วงเดิมที่ไม่มีโพสต์ใหม่/แก้ไข = ใช้ผลเดิม · ยาวสุด 31 วัน · ไม่เกิน 150 โพสต์ล่าสุดของช่วง
 * สถานะงานอยู่ในหน่วยความจำ (เว็บมีโปรเซสเดียว) — รีสตาร์ตระหว่างทำ = กดใหม่ได้ (ล็อกในฐานข้อมูลหมดใน 3 นาที)
 */
const RANGE_MAX_DAYS = 31;
const RANGE_MAX_POSTS = 150;
type RangeJobs = { running: Set<string>; failed: Map<string, { error: string; at: number }> };
function rangeJobs(): RangeJobs {
  const g = globalThis as unknown as { __bossBriefRangeJobs?: RangeJobs };
  return (g.__bossBriefRangeJobs ??= { running: new Set(), failed: new Map() });
}

export async function startRangeBrief(
  orgId: string,
  topicId: string,
  from: string,
  to: string
): Promise<{ ok: true; id: string; status: "done" | "pending" } | { ok: false; error: string }> {
  if (!isDay(from) || !isDay(to) || from > to) return { ok: false, error: "เลือกช่วงวันไม่ถูกต้อง" };
  const today = localDateStr(new Date());
  if (to > today) return { ok: false, error: "เลือกวันในอนาคตไม่ได้" };
  if (daysApart(from, to) + 1 > RANGE_MAX_DAYS) return { ok: false, error: `เลือกได้ไม่เกิน ${RANGE_MAX_DAYS} วัน` };
  const settings = await readBriefSettings(orgId);
  if (!planAtLeast(await getOrgPlan(orgId), "PRO")) return { ok: false, error: "แพ็กเกจนี้ใช้สรุปไม่ได้" };
  const { data: feed } = await readStoreCached<{ topics?: ReportTopic[]; posts?: ReportPost[] }>(orgId, "report-feed");
  const topic = feed?.topics?.find((t) => t.id === topicId);
  if (!topic) return { ok: false, error: "ไม่พบห้องนี้" };
  const posts = (feed?.posts ?? [])
    .filter((p) => p.topicId === topicId && !p.excludeFromSubmission && !p.retroFor)
    .filter((p) => {
      const d = localDateStr(new Date(p.createdAt));
      return d >= from && d <= to;
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-RANGE_MAX_POSTS);
  if (posts.length === 0) return { ok: false, error: "ช่วงนี้ไม่มีรายงาน" };
  const id = `range|${topicId}|${from}|${to}`;
  const signature = posts.map((p) => `${p.id}@${p.editedAt ?? p.createdAt}`).join(",");
  const prev = await getBrief(orgId, id);
  if (prev?.detail && prev.signature === signature) return { ok: true, id, status: "done" };
  const jobs = rangeJobs();
  const jobKey = `${orgId}::${id}`;
  if (jobs.running.has(jobKey)) return { ok: true, id, status: "pending" };
  const usage = await readUsage(orgId, monthOf(today));
  const { cap } = await effectiveCap(orgId, settings);
  // สรุปรวมอ่านหลายวัน แพงกว่าสรุปรอบเดียว ⇒ เผื่อ 1.5 เท่า · เงินเหลือไม่พอ = ไม่เริ่ม (ไม่สรุปจนเกินเพดาน)
  if (usage.thb + estimateThb(settings.detailModel, "summary") * 1.5 > cap) return { ok: false, error: `เงินที่เหลือของเดือนนี้ไม่พอสำหรับสรุปรวม (เพดาน ฿${cap})` };
  if (!(await claimBriefLock(orgId, id))) return { ok: true, id, status: "pending" };
  jobs.running.add(jobKey);
  jobs.failed.delete(jobKey);
  void (async () => {
    try {
      const users = await prisma.user.findMany({
        where: { orgId, id: { in: [...new Set(posts.map((p) => p.authorId))] } },
        select: { id: true, name: true, department: { select: { name: true } } },
      });
      const nameOf = new Map(users.map((u) => [u.id, u.name]));
      const teamOf = new Map(users.map((u) => [u.id, u.department?.name ?? ""]));
      const d = await withAiLock(orgId, async () => {
        const leftNow = (await effectiveCap(orgId, settings)).cap - (await readUsage(orgId, monthOf(localDateStr(new Date())))).thb;
        return buildDetail(orgId, "range", `ช่วง ${from} ถึง ${to}`, to, posts, [], settings, nameOf, teamOf, "daily", new Map(), leftNow);
      });
      if (d === "cap") throw new Error("เงินที่เหลือของเดือนนี้ไม่พอสำหรับสรุปช่วงนี้ — เลือกช่วงสั้นลงหรือเพิ่มเพดาน");
      if (!d) throw new Error("AI สรุปไม่สำเร็จ ลองใหม่อีกครั้ง");
      const byId = new Map(posts.map((p) => [p.id, p]));
      const people = Object.entries(d.detail.people)
        .map(([postId, info]) => {
          const p = byId.get(postId)!;
          return { postId, userId: p.authorId, name: nameOf.get(p.authorId) ?? "ไม่ทราบชื่อ", oneLine: d.oneLine.get(postId) ?? "", worst: info.color };
        })
        .sort((a, b) => RANK[a.worst] - RANK[b.worst]);
      const brief: BossBrief = {
        id,
        topicId,
        topicName: topic.name,
        roundId: "range",
        roundLabel: "สรุปรวม",
        roundTime: "23:59",
        day: to,
        rangeFrom: from,
        generatedAt: new Date().toISOString(),
        signature,
        postCount: posts.length,
        headline: d.headline,
        people,
        items: { stuck: [], late: [], ask: [], done: [] },
        qa: prev?.qa ?? [],
        model: settings.detailModel,
        costThb: d.cost,
        detail: d.detail,
      };
      await saveBrief(orgId, brief);
    } catch (e) {
      console.error("[boss-brief] range", orgId, id, e instanceof Error ? e.message : e);
      jobs.failed.set(jobKey, { error: e instanceof Error ? e.message : "สรุปไม่สำเร็จ", at: Date.now() });
    } finally {
      jobs.running.delete(jobKey);
    }
  })();
  return { ok: true, id, status: "pending" };
}

const daysApart = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000);

/* ───────── อ่านรูปในรายงาน weekly/monthly (13/11/2569) ─────────
 * ผู้ใช้: "weekly monthly จะเป็นภาพส่วนใหญ่ คนละรูป · daily รูปหน้างานไม่สำคัญ อ่านด้วยเสียเงินฟรี"
 * อ่านเฉพาะรอบรายสัปดาห์/รายเดือน · ไม่เกิน 2 รูปต่อรายงาน · ไฟล์ไม่เกิน 6 MB · อ่านครั้งเดียวแล้วเก็บข้อความ (stores key
 * "boss-brief-image-text" ของบริษัทนั้น) ใช้ซ้ำทั้งสรุปถัดไป สรุปรวม และถาม AI · ใช้รุ่นประหยัด (summaryModel) อ่าน
 */
const IMAGE_TEXT_KEY = "boss-brief-image-text";
const MAX_IMAGES_PER_POST = 2;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
type ImageTextStore = Record<string, { text: string; at: string }>;
const imgKey = (postId: string, imageId: string) => `${postId}|${imageId}`;

/** ข้อความจากรูปที่เคยอ่านไว้ของโพสต์ต่าง ๆ — ใช้ในเครื่องมือถาม AI ด้วย */
export async function readImageTextStore(orgId: string): Promise<ImageTextStore> {
  const { data } = await readStore<ImageTextStore>(orgId, IMAGE_TEXT_KEY);
  return data ?? {};
}

async function imageDataUrl(img: ReportPost["images"][number]): Promise<string | null> {
  if (img.mime && !img.mime.startsWith("image/")) return null;
  if (img.dataUrl?.startsWith("data:image/")) return img.dataUrl.length <= MAX_IMAGE_BYTES * 1.4 ? img.dataUrl : null;
  const key = (img.url ?? "").replace(/^\/api\/files\//, "");
  if (!key || key.includes("..") || /^https?:/i.test(key)) return null;
  const bytes = await readStoredBytes(key);
  if (!bytes || bytes.byteLength > MAX_IMAGE_BYTES) return null;
  const ext = key.split(".").pop()?.toLowerCase();
  const mime = img.mime ?? (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg");
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function readReportImages(orgId: string, posts: ReportPost[], settings: BossBriefSettings, budgetLeft = Number.POSITIVE_INFINITY): Promise<{ text: Map<string, string>; spent: number }> {
  const store = await readImageTextStore(orgId);
  const out = new Map<string, string>();
  const fresh: ImageTextStore = {};
  let cost = 0;
  for (const p of posts) {
    const imgs = (p.images ?? []).filter((i) => !i.mime || i.mime.startsWith("image/")).slice(0, MAX_IMAGES_PER_POST);
    if (imgs.length === 0) continue;
    const parts: string[] = [];
    const todo: { img: (typeof imgs)[number]; url: string }[] = [];
    for (const img of imgs) {
      const hit = store[imgKey(p.id, img.id)];
      if (hit) parts.push(hit.text);
      else {
        const url = await imageDataUrl(img).catch(() => null);
        if (url) todo.push({ img, url });
      }
    }
    // รูปละราว 1,500 token (ความละเอียดสูง) + ตอบยาวสุด 2,500 token — เงินเหลือไม่พอ = ไม่อ่านรูปนี้ (สรุปจากข้อความแทน)
    const worst = worstCaseThb(MODEL_PRICES_USD[settings.summaryModel] ?? MODEL_PRICES_USD["gpt-6-sol"]!, 1500 * 1.2 * todo.length + 800, 2500, THB_PER_USD);
    if (todo.length && cost + worst <= budgetLeft) {
      try {
        const res = await (await openai(orgId)).responses.create({
          model: settings.summaryModel,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: "นี่คือรูปที่แนบในรายงานประจำสัปดาห์/เดือนของพนักงาน อ่านทุกอย่างที่เป็นข้อมูลออกมาเป็นข้อความภาษาไทย: หัวข้อ ตัวเลข ตาราง (เขียนเป็นบรรทัด) กราฟ (บอกค่าที่อ่านได้) สถานะ/สี ห้ามแต่งเพิ่ม ไม่เกิน 1200 ตัวอักษรต่อรูป ถ้ารูปไหนเป็นแค่รูปหน้างาน/บรรยากาศไม่มีข้อมูล ให้ตอบบรรทัดเดียวว่า 'รูปหน้างาน: <บรรยายสั้น>' แยกแต่ละรูปด้วยบรรทัด ---",
                },
                ...todo.map((t) => ({ type: "input_image" as const, image_url: t.url, detail: "high" as const })),
              ],
            },
          ],
          max_output_tokens: 2500,
        });
        cost += costThb(settings.summaryModel, { prompt_tokens: res.usage?.input_tokens, completion_tokens: res.usage?.output_tokens });
        const chunks = (res.output_text ?? "").split(/\n-{3,}\n/);
        todo.forEach((t, i) => {
          const text = (chunks[i] ?? chunks.join("\n")).trim().slice(0, 1500);
          if (!text) return;
          fresh[imgKey(p.id, t.img.id)] = { text, at: new Date().toISOString() };
          parts.push(text);
        });
      } catch (e) {
        console.error("[boss-brief] read images", orgId, p.id, e instanceof Error ? e.message : e);
      }
    }
    if (parts.length) out.set(p.id, parts.join("\n---\n"));
  }
  if (Object.keys(fresh).length) {
    await addUsage(orgId, monthOf(localDateStr(new Date())), cost);
    // เก็บข้อความ (ตัดของเก่ากว่า 400 วันทิ้ง) — compare-and-swap กันเขียนทับกัน
    const oldest = new Date(Date.now() - 400 * 86_400_000).toISOString();
    for (let i = 0; i < 5; i++) {
      const { data, version } = await readStore<ImageTextStore>(orgId, IMAGE_TEXT_KEY);
      const next = Object.fromEntries(Object.entries({ ...(data ?? {}), ...fresh }).filter(([, v]) => v.at >= oldest));
      const w = version === 0 ? await createStoreIfAbsent(orgId, IMAGE_TEXT_KEY, next) : await writeStore(orgId, IMAGE_TEXT_KEY, next, version);
      if (w.ok) break;
    }
  }
  return { text: out, spent: cost };
}

/* ───────── ย่อสรุปเก่ากว่า 12 เดือน (13/11/2569) ─────────
 * ผู้ใช้กังวลว่าเก็บถาวรทุกบริษัทจะหนัก → เก็บเต็ม 12 เดือน เก่ากว่านั้นเหลือภาพรวม เรื่องที่ต้องรู้ บรรทัดต่อคน และถาม-ตอบ
 * (ตัดรายละเอียดรายคน/ทีม/รายการตามหัวข้อ ~6 KB → ~1 KB) ไม่เรียก AI · ทำวันละครั้งต่อบริษัท ทีละ 300 แถว
 */
const FULL_DAYS = 365;
function compactOf(b: BossBrief): BossBrief {
  return {
    ...b,
    compact: true,
    items: { stuck: [], late: [], ask: [], done: [] },
    people: b.people.map((p) => ({ ...p, worst: b.detail?.people[p.postId]?.color ?? p.worst })),
    ...(b.detail
      ? {
          detail: {
            roundKind: b.detail.roundKind,
            ...(b.detail.period ? { period: b.detail.period } : {}),
            urgent: b.detail.urgent.map((u) => ({ ...u, why: "" })),
            decisions: b.detail.decisions,
            carry: b.detail.carry,
            fixed: [],
            teams: [],
            people: {},
          },
        }
      : {}),
  };
}
export async function compactOldBriefs(orgId: string): Promise<number> {
  const cutoff = localDateStr(new Date(Date.now() - FULL_DAYS * 86_400_000));
  const ids = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM report_task.boss_briefs
    WHERE org_id = ${orgId} AND day < ${cutoff} AND NOT (data ? 'compact')
    LIMIT 300`;
  let n = 0;
  for (const { id } of ids) {
    const b = await getBrief(orgId, id);
    if (!b || b.compact) continue;
    await saveBrief(orgId, compactOf(b));
    n++;
  }
  return n;
}
