import "server-only";
import OpenAI from "openai";
import { prisma } from "@smartboss/database";
import { createStoreIfAbsent, readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { readStoreCached } from "@/modules/report_task/lib/db/store-cached-read";
import { writeOwnNotificationsForUsers } from "@/modules/report_task/lib/server/retro-notify";
import { claimSweep, releaseSweep } from "@/modules/report_task/lib/server/sweep-throttle";
import { getOrgPlan, planAtLeast, type PlanCode } from "@/modules/report_task/lib/plan";
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
  type BriefItem,
  type BriefKind,
  type BriefUsageMonth,
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

async function effectiveCap(orgId: string, settings: BossBriefSettings): Promise<{ cap: number; planMax: number }> {
  const planMax = PLAN_MAX_CAP_THB[await getOrgPlan(orgId)];
  return { cap: Math.min(settings.monthlyCapThb, planMax), planMax };
}

const SETTINGS_KEY = "boss-brief-settings";
const RESULTS_KEY = "boss-brief-results";
const USAGE_KEY = "boss-brief-usage";
const KEEP_DAYS = 14;
/** สรุปหลังปิดรอบกี่นาที (ให้คนที่ส่งตอนเส้นตายทัน) */
const AFTER_CLOSE_MIN = 5;
/** มีโพสต์ใหม่/แก้ไขหลังสรุปแล้ว — สรุปใหม่ได้ไม่ถี่กว่านี้ (ประหยัดเงิน) */
const REGEN_GAP_MS = 10 * 60_000;
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
  return { ...DEFAULT_BRIEF_SETTINGS, ...(data ?? {}) };
}

export async function saveBriefSettings(orgId: string, patch: Partial<BossBriefSettings>): Promise<BossBriefSettings> {
  // เพดานที่ตั้งเกินแพ็กเกจไม่ได้ (เดิมเก็บได้ถึง ฿5,000 แล้วค่อยตัดตอนใช้ — ช่องในตั้งค่าเลยโชว์เลขที่ไม่ได้ใช้จริง)
  const planMax = PLAN_MAX_CAP_THB[await getOrgPlan(orgId)];
  for (let i = 0; i < 3; i++) {
    const { data, version } = await readStore<Partial<BossBriefSettings>>(orgId, SETTINGS_KEY);
    const cur = { ...DEFAULT_BRIEF_SETTINGS, ...(data ?? {}) };
    const next: BossBriefSettings = {
      enabled: typeof patch.enabled === "boolean" ? patch.enabled : cur.enabled,
      topicIds: Array.isArray(patch.topicIds) ? [...new Set(patch.topicIds.filter((x) => typeof x === "string"))].slice(0, 50) : cur.topicIds,
      monthlyCapThb:
        typeof patch.monthlyCapThb === "number" && Number.isFinite(patch.monthlyCapThb) ? Math.max(0, Math.min(5000, planMax, Math.round(patch.monthlyCapThb))) : cur.monthlyCapThb,
      summaryModel: patch.summaryModel && MODEL_PRICES_USD[patch.summaryModel] ? patch.summaryModel : cur.summaryModel,
      askModel: patch.askModel && MODEL_PRICES_USD[patch.askModel] ? patch.askModel : cur.askModel,
    };
    const w = version === 0 ? await createStoreIfAbsent(orgId, SETTINGS_KEY, next) : await writeStore(orgId, SETTINGS_KEY, next, version);
    if (w.ok) return next;
  }
  throw new Error("บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
}

async function readUsage(orgId: string, month: string): Promise<BriefUsageMonth> {
  const { data } = await readStore<Record<string, BriefUsageMonth>>(orgId, USAGE_KEY);
  return data?.[month] ?? { thb: 0, calls: 0 };
}

async function addUsage(orgId: string, month: string, thb: number): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const { data, version } = await readStore<Record<string, BriefUsageMonth>>(orgId, USAGE_KEY);
    const all = { ...(data ?? {}) };
    const cur = all[month] ?? { thb: 0, calls: 0 };
    all[month] = { thb: Math.round((cur.thb + thb) * 10000) / 10000, calls: cur.calls + 1 };
    const w = version === 0 ? await createStoreIfAbsent(orgId, USAGE_KEY, all) : await writeStore(orgId, USAGE_KEY, all, version);
    if (w.ok) return;
  }
}

async function saveBrief(orgId: string, brief: BossBrief): Promise<void> {
  const oldest = localDateStr(new Date(Date.now() - KEEP_DAYS * 86_400_000));
  for (let i = 0; i < 5; i++) {
    const { data, version } = await readStore<Results>(orgId, RESULTS_KEY);
    const briefs = Object.fromEntries(Object.entries(data?.briefs ?? {}).filter(([, b]) => b.day >= oldest));
    briefs[brief.id] = brief;
    const w = version === 0 ? await createStoreIfAbsent(orgId, RESULTS_KEY, { briefs }) : await writeStore(orgId, RESULTS_KEY, { briefs }, version);
    if (w.ok) return;
  }
  throw new Error("บันทึกสรุปไม่สำเร็จ");
}

function costThb(model: string, usage: { prompt_tokens?: number; completion_tokens?: number } | undefined): number {
  const p = MODEL_PRICES_USD[model] ?? MODEL_PRICES_USD["gpt-6-sol"]!;
  return (((usage?.prompt_tokens ?? 0) * p.input + (usage?.completion_tokens ?? 0) * p.output) / 1_000_000) * THB_PER_USD;
}

function openai(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY ยังไม่ได้ตั้งค่า");
  return new OpenAI({ apiKey });
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

/** สร้าง/สร้างใหม่ สรุปของรอบหนึ่ง — ประเภท/สีจากกฎ · ใจความย่อ + ภาพรวมจาก AI (ถ้าไม่เกินเพดาน) */
async function buildBrief(
  orgId: string,
  topic: ReportTopic,
  round: SubmissionRound,
  day: string,
  posts: ReportPost[],
  settings: BossBriefSettings,
  signature: string,
  keepQa: BossBrief["qa"]
): Promise<BossBrief> {
  const topics = round.requiredTopics ?? [];
  const users = await prisma.user.findMany({ where: { orgId, id: { in: [...new Set(posts.map((p) => p.authorId))] } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
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
  const usage = await readUsage(orgId, monthOf(day));
  if (usage.thb >= (await effectiveCap(orgId, settings)).cap) {
    aiSkipped = "cap";
  } else if (parsed.length > 0) {
    const input = parsed.map((x) => ({
      id: x.post.id,
      name: x.name,
      topics: x.blocks.map((b, i) => ({ i, topic: b.topic, text: b.nothing ? "ไม่มี" : b.content.slice(0, MAX_CONTENT) })),
    }));
    try {
      const res = await openai().chat.completions.create({
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
            content: `รายงานรอบ "${round.label}" ห้อง "${topic.name}" วันที่ ${day}:\n${JSON.stringify(input)}\n\nตอบ JSON: {"headline":"ภาพรวมรอบนี้ 1 ประโยค ไม่เกิน 90 ตัวอักษร บอกเรื่องที่สำคัญที่สุด","posts":[{"id":"...","oneLine":"สรุปทั้งฉบับ ไม่เกิน 60 ตัวอักษร","shorts":[{"i":0,"short":"ใจความหัวข้อนี้ ไม่เกิน 70 ตัวอักษร"}]}]} ใส่ shorts ทุกหัวข้อที่ text ไม่ใช่ "ไม่มี"`,
          },
        ],
      });
      cost = costThb(settings.summaryModel, res.usage);
      const out = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { headline?: string; posts?: { id: string; oneLine?: string; shorts?: { i: number; short: string }[] }[] };
      headline = String(out.headline ?? "").slice(0, 200);
      for (const p of out.posts ?? []) {
        if (p.oneLine) oneLine.set(p.id, String(p.oneLine).slice(0, 160));
        for (const s of p.shorts ?? []) if (s && typeof s.short === "string") shorts.set(`${p.id}|${s.i}`, s.short.slice(0, 200));
      }
      await addUsage(orgId, monthOf(day), cost);
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
      const text = shorts.get(`${x.post.id}|${i}`) ?? firstLine(b.content);
      if (isNothing(text)) return; // AI ย่อแล้วเหลือแค่ "ไม่มี…" = ไม่ใช่เรื่อง
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
    model: settings.summaryModel,
    costThb: cost,
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

function notifyText(b: BossBrief): string {
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
  const { data: stored } = await readStore<Results>(orgId, RESULTS_KEY);
  const briefs = stored?.briefs ?? {};

  for (const topicId of settings.topicIds) {
    const topic = feed.topics.find((t) => t.id === topicId);
    if (!topic) continue;
    const rounds = effectiveRoundsOf(topic).filter((r) => roundRunsOnDay(r, today));
    for (const round of rounds) {
      if (!(round.requiredTopics?.length)) continue;
      if (nowMin < minutesOf(round.time) + AFTER_CLOSE_MIN) continue;
      const posts = postsForRound(topic, feed.posts ?? [], round, today, rounds);
      if (posts.length === 0) continue;
      const signature = posts.map((p) => `${p.id}@${p.editedAt ?? p.createdAt}`).join(",");
      const id = `${today}|${topic.id}|${round.id}`;
      const prev = briefs[id];
      if (prev && prev.signature === signature) continue;
      if (prev && Date.now() - Date.parse(prev.generatedAt) < REGEN_GAP_MS) continue;
      // จองในฐานข้อมูลก่อนเรียก AI — การเปิดหน้ากับ cron อาจเริ่มพร้อมกัน (ตัวกันในหน่วยความจำไม่ข้ามกันระหว่าง route)
      if (!(await claimBriefLock(orgId, id))) continue;
      const brief = await buildBrief(orgId, topic, round, today, posts, settings, signature, prev?.qa ?? []);
      await saveBrief(orgId, brief);
      if (prev) {
        result.updated++;
      } else {
        result.made++;
        const bosses = await bossUserIds(orgId);
        await writeOwnNotificationsForUsers(
          orgId,
          bosses.map((uid) => ({
            id: `boss-brief|${id}|${uid}`,
            userId: uid,
            byUserId: "system",
            message: `[${topic.name}] ${notifyText(brief)}`,
            link: `/chat-report/report-feed?topic=${encodeURIComponent(topic.id)}&tab=stats`,
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
export async function briefViewFor(orgId: string, topicId: string, isBoss: boolean): Promise<BossBriefView> {
  const settings = await readBriefSettings(orgId);
  const today = localDateStr(new Date());
  const month = monthOf(today);
  const empty: BossBriefView = { allowed: false, settings, roundsWithTopics: [], briefs: [], usage: { month, thb: 0, calls: 0, capThb: settings.monthlyCapThb }, generating: false };
  if (!isBoss) return { ...empty, reason: "not-boss" };
  if (!planAtLeast(await getOrgPlan(orgId), "PRO")) return { ...empty, reason: "plan" };
  const [{ data: feed }, { data: stored }, usage] = await Promise.all([
    readStoreCached<{ topics?: ReportTopic[] }>(orgId, "report-feed"),
    readStore<Results>(orgId, RESULTS_KEY),
    readUsage(orgId, month),
  ]);
  const topic = feed?.topics?.find((t) => t.id === topicId);
  const roundsWithTopics = topic
    ? effectiveRoundsOf(topic).filter((r) => (r.requiredTopics?.length ?? 0) > 0).map((r) => ({ id: r.id, label: r.label, time: r.time }))
    : [];
  const yesterday = localDateStr(new Date(Date.now() - 86_400_000));
  const briefs = Object.values(stored?.briefs ?? {})
    .filter((b) => b.topicId === topicId && b.day >= yesterday)
    .sort((a, b) => b.day.localeCompare(a.day) || minutesOf(b.roundTime) - minutesOf(a.roundTime));
  const { cap, planMax } = await effectiveCap(orgId, settings);
  return { allowed: true, settings, roundsWithTopics, briefs, usage: { month, thb: usage.thb, calls: usage.calls, capThb: cap, planMaxThb: planMax }, generating: false };
}

/** Boss ถามต่อในการ์ด — ตอบจากรายงานของรอบนั้น + 3 วันก่อนหน้าของห้องเดียวกัน */
export async function askBrief(orgId: string, briefId: string, question: string): Promise<{ ok: true; brief: BossBrief } | { ok: false; error: string }> {
  const q = question.trim().slice(0, 500);
  if (!q) return { ok: false, error: "พิมพ์คำถามก่อน" };
  const settings = await readBriefSettings(orgId);
  const day = briefId.split("|")[0] ?? localDateStr(new Date());
  const usage = await readUsage(orgId, monthOf(day));
  const { cap } = await effectiveCap(orgId, settings);
  if (usage.thb >= cap) return { ok: false, error: `ใช้ครบเพดาน ฿${cap} ของเดือนนี้แล้ว` };
  const { data: stored } = await readStore<Results>(orgId, RESULTS_KEY);
  const brief = stored?.briefs?.[briefId];
  if (!brief) return { ok: false, error: "ไม่พบสรุปนี้" };
  const { data: feed } = await readStoreCached<{ posts?: ReportPost[] }>(orgId, "report-feed");
  const from = localDateStr(new Date(Date.parse(`${brief.day}T00:00:00`) - 3 * 86_400_000));
  const posts = (feed?.posts ?? [])
    .filter((p) => p.topicId === brief.topicId && !p.excludeFromSubmission)
    .filter((p) => {
      const d = localDateStr(new Date(p.createdAt));
      return d >= from && d <= brief.day;
    })
    .slice(-60);
  const users = await prisma.user.findMany({ where: { orgId, id: { in: [...new Set(posts.map((p) => p.authorId))] } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const context = posts.map((p) => `=== ${nameOf.get(p.authorId) ?? "?"} · ${new Date(p.createdAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} ===\n${postText(p).slice(0, 1500)}`).join("\n\n");
  const history = brief.qa.slice(-4).flatMap((x) => [
    { role: "user" as const, content: x.q },
    { role: "assistant" as const, content: x.a },
  ]);
  try {
    const res = await openai().chat.completions.create({
      model: settings.askModel,
      max_completion_tokens: 3000,
      messages: [
        {
          role: "system",
          content: `คุณเป็นผู้ช่วยของ Boss ตอบจากรายงานด้านล่างเท่านั้น ภาษาไทย สั้น เป็นข้อ ๆ ไม่เกิน 8 บรรทัด บอกชื่อคนทุกข้อ ถ้าในรายงานไม่มีข้อมูลให้บอกตรง ๆ ว่าไม่มี\n\nรายงานห้อง "${brief.topicName}" ${from} ถึง ${brief.day}:\n${context}`,
        },
        ...history,
        { role: "user", content: q },
      ],
    });
    const thb = costThb(settings.askModel, res.usage);
    await addUsage(orgId, monthOf(day), thb);
    const answer = (res.choices[0]?.message?.content ?? "").trim() || "ตอบไม่ได้ ลองถามใหม่อีกครั้ง";
    for (let i = 0; i < 5; i++) {
      const { data, version } = await readStore<Results>(orgId, RESULTS_KEY);
      const cur = data?.briefs?.[briefId];
      if (!cur || !data) break;
      const next = { ...cur, qa: [...cur.qa, { at: new Date().toISOString(), q, a: answer, costThb: thb }].slice(-20) };
      const w = await writeStore(orgId, RESULTS_KEY, { briefs: { ...data.briefs, [briefId]: next } }, version);
      if (w.ok) return { ok: true, brief: next };
    }
    return { ok: false, error: "บันทึกคำตอบไม่สำเร็จ ลองใหม่" };
  } catch (e) {
    console.error("[boss-brief] ask", orgId, e instanceof Error ? e.message : e);
    return { ok: false, error: "AI ตอบไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
