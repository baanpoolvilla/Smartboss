import "server-only";
import OpenAI from "openai";
import { prisma } from "@smartboss/database";
import { readStoreCached } from "@/modules/report_task/lib/db/store-cached-read";
import { localDateStr } from "@/modules/report_task/lib/now";
import { wfTry } from "@/modules/hr/lib/api";
import { withSalaryTenant } from "@/modules/salary/lib/db";
import { withRequestsTenant } from "@/modules/requests/lib/db";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import type { BossBrief } from "./types";
import { listBriefs, readImageTextStore } from "./server";
import { aiClientFor } from "./ai-billing";

/**
 * ผู้ช่วย AI ที่รู้ข้อมูลทั้งบริษัท — เฉพาะ Boss (13/11/2569)
 *
 * ผู้ใช้: "ให้ AI รู้ข้อมูลเราทั้งหมด ในห้องแชทและข้อมูลบริษัท" → ตัดสินใจ: Boss คนเดียว · แชทเฉพาะห้องกลุ่ม (ไม่อ่าน DM)
 * · ข้อมูลบริษัททั้งหมดรวมเงินเดือน · ถามผ่านปุ่ม "ถาม AI" ในสรุปรายงาน
 *
 * ไม่ส่งข้อมูลทั้งหมดให้ AI ทุกครั้ง (แพง + เกินที่อ่านได้) — ให้ AI เรียก "เครื่องมือค้นข้อมูล" เอง
 * (OpenAI tool calling) เซิร์ฟเวอร์ค้นจากฐานข้อมูลของบริษัทนี้ (orgId) แล้วส่งกลับเฉพาะที่เกี่ยวข้อง แบบย่อ
 * ห้ามส่ง: เลขบัญชีธนาคาร (เข้ารหัสอยู่แล้ว ไม่เลือกมาเลย) · ข้อความแชทส่วนตัว (dm)
 * ข้อมูล HR (ลงเวลา/ลา) อยู่บน workforce — เรียกด้วย token ของ Boss ที่กำลังถาม (cookie) สิทธิ์เท่ากับที่ Boss เห็นเอง
 */

// คิดได้ไม่เกิน 4 รอบ (เดิม 6) — ค่าใช้จ่ายโตตามจำนวนรอบ เพราะทุกรอบส่งข้อมูลที่ค้นมาแล้วซ้ำ (วัดจริง: sol ค้น tasks 4 รอบ = ฿2.14)
const MAX_STEPS = 4;
// ข้อมูลที่ส่งให้ AI ต่อเครื่องมือ — ส่วนใหญ่ของค่าใช้จ่ายคือ "ข้อมูลที่ AI อ่าน" (ส่งซ้ำทุกรอบที่คิด)
// 13/11/2569 ผู้ใช้: "ทำไมราคาแพงจัง" (฿0.89/คำถาม) → ลดจาก 14k ตัวอักษร
const MAX_TOOL_CHARS = 8_000;
const DAY = 86_400_000;

type Ctx = { orgId: string; today: string; names: Map<string, string>; teams: Map<string, string>; pages?: { label: string; path: string }[] };
type Args = Record<string, unknown>;

const s = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const num = (v: unknown) => (v == null ? 0 : Number(v));
function span(a: Args, ctx: Ctx, defDays = 30, maxDays = 365): { from: string; to: string } {
  const to = isDay(a.to) && a.to <= ctx.today ? a.to : ctx.today;
  let from = isDay(a.from) ? a.from : localDateStr(new Date(Date.parse(`${to}T12:00:00`) - (defDays - 1) * DAY));
  // ไม่เกิน 1 ปีต่อครั้ง (นับจำนวนได้ 3 ปี — ไม่ต้องส่งเนื้อหาให้ AI อ่าน)
  const min = localDateStr(new Date(Date.parse(`${to}T12:00:00`) - maxDays * DAY));
  if (from < min) from = min;
  if (from > to) from = to;
  return { from, to };
}
const has = (text: string, kw: string) => !kw || text.toLowerCase().includes(kw.toLowerCase());
const dayOf = (d: Date | string | null | undefined) => (d ? localDateStr(new Date(d)) : null);
const nameOf = (ctx: Ctx, id: string | null | undefined) => (id ? ctx.names.get(id) ?? "ไม่ทราบชื่อ" : null);
/** ชื่อคนที่ AI ส่งมา → userId ที่ตรง (มีคำนั้นในชื่อ) · ว่าง = ไม่กรอง */
function peopleMatching(ctx: Ctx, person: string): Set<string> | null {
  if (!person) return null;
  return new Set([...ctx.names].filter(([, n]) => has(n, person)).map(([id]) => id));
}
function clip(rows: unknown[], note = ""): string {
  let out = JSON.stringify(rows);
  if (out.length <= MAX_TOOL_CHARS) return note ? JSON.stringify({ note, rows }) : out;
  // ตัดท้าย (รายการเก่าสุด/น้อยสำคัญสุดอยู่ท้าย) จนพอดี
  let n = rows.length;
  while (n > 1 && out.length > MAX_TOOL_CHARS) {
    n = Math.floor(n * 0.75);
    out = JSON.stringify(rows.slice(0, n));
  }
  return JSON.stringify({ note: `${note ? note + " · " : ""}แสดง ${n} จาก ${rows.length} รายการ (ถามให้แคบลงเพื่อดูเพิ่ม)`, rows: rows.slice(0, n) });
}
const postText = (p: ReportPost) => [p.title, ...p.sections.flatMap((x) => [x.heading, ...x.bullets])].filter(Boolean).join("\n");
/** ข้อความที่อ่านจากรูปแนบ (รายงาน weekly/monthly) ต่อโพสต์ — อ่านไว้ตอนสรุปรอบ ไม่อ่านรูปใหม่ตอนถาม */
async function imageTextByPost(orgId: string): Promise<Map<string, string>> {
  const store = await readImageTextStore(orgId);
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(store)) {
    const postId = k.split("|")[0]!;
    out.set(postId, out.has(postId) ? `${out.get(postId)}\n---\n${v.text}` : v.text);
  }
  return out;
}

/* ───────── เครื่องมือ ───────── */

const day = { type: "string", description: "YYYY-MM-DD (ค.ศ.) ว่าง = ใช้ค่าเริ่มต้น 30 วันล่าสุด" };

const TOOLS: OpenAI.Responses.FunctionTool[] = [
  fn("search_reports", "ค้นรายงานจากห้องรายงาน (daily/weekly/monthly และห้องอื่น) ตามช่วงวัน คำค้น คน หรือห้อง — คืนข้อความรายงานแบบย่อ + ความคิดเห็นใต้รายงาน", {
    from: day, to: day, keyword: str("คำที่ต้องมีในรายงาน เช่น HS2, สินเชื่อ"), person: str("ชื่อคนส่ง (บางส่วนก็ได้)"), room: str("ชื่อห้อง (บางส่วนก็ได้)"),
    page: { type: "integer", description: "หน้าที่ 1–3 (หน้าละ 80 ฉบับ ใหม่สุดก่อน) ใช้เมื่อหน้าแรกบอกว่ามีอีก" },
  }),
  fn("count_mentions", "นับว่าเรื่อง/คำนี้ถูกพูดถึงในรายงานและแชทกลุ่มกี่ครั้ง แยกตามเดือน/สัปดาห์/คน/ห้อง พร้อมวันแรก-วันล่าสุดและตัวอย่างสั้น ๆ — ใช้ก่อนเสมอกับคำถามแบบ 'กี่ครั้ง' 'บ่อยแค่ไหน' 'ช่วงไหน' 'ใครพูดถึง' หรือช่วงเวลายาว (ย้อนได้ 3 ปี) ถูกกว่าอ่านรายงานทีละฉบับมาก", {
    keyword: str("คำที่ต้องการนับ เช่น HS2, เครื่องเกลือ, น้ำรั่ว (จำเป็น)"), from: day, to: day, by: str("month | week | person | room (ค่าเริ่มต้น month)"),
  }),
  fn("report_summaries", "สรุปรายรอบที่ AI ทำเก็บไว้แล้ว (ด่วน/รอ Boss/ค้าง/รายคน) — สั้นกว่ารายงานเต็ม ถูกกว่า เหมาะดูภาพรวมหลายวัน/หลายเดือน (เก็บถาวรตั้งแต่เปิดใช้สรุป)", { from: day, to: day }),
  fn("search_group_chat", "ค้นข้อความในห้องแชทกลุ่ม (ไม่รวมแชทส่วนตัว)", {
    from: day, to: day, keyword: str("คำในข้อความ"), person: str("ชื่อคนพิมพ์"), room: str("ชื่อห้องแชท"),
  }),
  fn("tasks", "งาน/โปรเจกต์บนบอร์ดงาน: ใครทำอะไร สถานะ กำหนดส่ง เลยกำหนด", {
    status: str("todo | in_progress | review | done | overdue (เลยกำหนดยังไม่เสร็จ) | open (ทุกอันที่ยังไม่เสร็จ)"), person: str("ชื่อผู้รับผิดชอบหรือคนสั่ง"), keyword: str("คำในชื่องาน"),
    from: day, to: day,
  }),
  fn("work_orders", "ใบแจ้งซ่อม / PM ของบ้าน: เรื่องอะไร บ้านไหน ใครรับ สถานะ กำหนดเสร็จ", {
    from: day, to: day, status: str("open | in_progress | done | ว่าง=ทั้งหมด"), keyword: str("คำในหัวข้อ/เลขใบ"), house: str("ชื่อบ้าน"), person: str("ชื่อผู้รับผิดชอบ"),
  }),
  fn("purchases_expenses", "ใบสั่งซื้อ (PR/PO) และค่าใช้จ่ายซ่อมบำรุง: ซื้ออะไร เท่าไร บ้านไหน รวมยอด", { from: day, to: day, keyword: str("คำในรายการ"), house: str("ชื่อบ้าน") }),
  fn("money_requests", "คำขอเบิกเงิน / เงินทดรอง / OT / เงินสดย่อย: ใครขอ เท่าไร อนุมัติหรือยัง", {
    from: day, to: day, kind: str("ชนิด เช่น ot, advance, reimburse (ว่าง=ทั้งหมด)"), status: str("สถานะ (ว่าง=ทั้งหมด)"), person: str("ชื่อคนขอ/ผู้รับเงิน"),
  }),
  fn("attendance", "การลงเวลาเข้างาน: สาย ขาด ไม่ได้ลงเวลา วันลา รายคน (สรุปต่อคน)", { from: day, to: day, person: str("ชื่อพนักงาน") }),
  fn("leave", "ใบลา/วันหยุด: ใครลา วันไหน ประเภท สถานะ", { from: day, to: day, person: str("ชื่อพนักงาน"), status: str("APPROVED | SUBMITTED (รออนุมัติ) | ว่าง=ทั้งหมด") }),
  fn("salary", "เงินเดือน/ค่าแรงรายงวด: รายได้รวม หักรวม ภาษี ประกันสังคม รับสุทธิ ต่อคน และยอดรวมของงวด (ไม่มีเลขบัญชี)", {
    period: str("งวด YYYY-MM (ว่าง = งวดล่าสุด)"), person: str("ชื่อพนักงาน"),
  }),
  fn("scores", "คะแนนประเมิน/คะแนนที่ถูกหัก: ใครโดนหักเรื่องอะไร รวมกี่คะแนน", { from: day, to: day, person: str("ชื่อพนักงาน") }),
  fn("people", "รายชื่อพนักงานทั้งหมดและแผนก — ใช้ตอนไม่แน่ใจชื่อหรือทีม", {}),
  fn("app_pages", "รายชื่อหน้าต่าง ๆ ในระบบ SmartBoss ที่ Boss เปิดได้ (ชื่อ + ลิงก์) — ใช้ตอนต้องพา Boss ไปหน้าไหน เช่น 'ไปหน้าเงินเดือน' 'ดูใบแจ้งซ่อมทั้งหมดที่ไหน'", {}),
];
function fn(name: string, description: string, props: Record<string, unknown>): OpenAI.Responses.FunctionTool {
  return { type: "function", name, description, parameters: { type: "object", properties: props, additionalProperties: false }, strict: false };
}
function str(description: string) {
  return { type: "string", description };
}

/** ใช้ในเทสต์แยกบริษัท (.scratch-sim/tenant-ai-isolation.ts) — เรียกเครื่องมือตรง ๆ ในนามบริษัทหนึ่ง */
export async function runCompanyToolForTest(orgId: string, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const users = await prisma.user.findMany({ where: { orgId }, select: { id: true, name: true, department: { select: { name: true } } } });
  return runTool(name, args, { orgId, today: localDateStr(new Date()), names: new Map(users.map((u) => [u.id, u.name])), teams: new Map(users.map((u) => [u.id, u.department?.name ?? ""])) });
}

async function runTool(name: string, a: Args, ctx: Ctx): Promise<string> {
  const { orgId } = ctx;
  switch (name) {
    case "app_pages": {
      return clip((ctx.pages ?? []).map((p) => ({ name: p.label, link: p.path })));
    }
    case "people": {
      return clip([...ctx.names].map(([id, n]) => ({ name: n, team: ctx.teams.get(id) || "" })));
    }
    case "search_reports": {
      const { from, to } = span(a, ctx);
      const kw = s(a.keyword, 60), room = s(a.room, 60);
      const who = peopleMatching(ctx, s(a.person, 60));
      const [{ data }, imgText] = await Promise.all([readStoreCached<{ topics?: ReportTopic[]; posts?: ReportPost[] }>(orgId, "report-feed"), imageTextByPost(orgId)]);
      const topicName = new Map((data?.topics ?? []).map((t) => [t.id, t.name]));
      const rows = (data?.posts ?? [])
        .filter((p) => {
          const d = dayOf(p.createdAt)!;
          if (d < from || d > to) return false;
          if (who && !who.has(p.authorId)) return false;
          if (room && !has(topicName.get(p.topicId) ?? "", room)) return false;
          const replies = (p.replies ?? []).map((r) => r.body).join("\n");
          return has(postText(p) + "\n" + replies + "\n" + (imgText.get(p.id) ?? ""), kw);
        })
        .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
      const page = Math.min(3, Math.max(1, Math.floor(Number(a.page) || 1)));
      const total = rows.length;
      const pageRows = rows
        .slice((page - 1) * 80, page * 80)
        .map((p) => ({
          link: `/chat-report/report-feed?topic=${encodeURIComponent(p.topicId)}&post=${encodeURIComponent(p.id)}`,
          date: dayOf(p.createdAt),
          room: topicName.get(p.topicId) ?? "",
          person: nameOf(ctx, p.authorId),
          text: postText(p).slice(0, kw ? 900 : 450),
          imageText: imgText.get(p.id)?.slice(0, kw ? 1500 : 600) || undefined,
          comments: (p.replies ?? []).slice(-2).map((r) => `${nameOf(ctx, r.authorId)}: ${r.body.slice(0, 120)}`),
        }));
      const more = total > page * 80 && page < 3 ? ` · มีอีก ${total - page * 80} ฉบับ (ขอ page ${page + 1} ได้)` : "";
      return clip(pageRows, `รายงาน ${from} ถึง ${to} · ทั้งหมด ${total} ฉบับ · หน้า ${page}${more}`);
    }
    case "count_mentions": {
      const kw = s(a.keyword, 60);
      if (!kw) return JSON.stringify({ error: "ต้องระบุ keyword" });
      const { from, to } = span(a, ctx, 365, 3 * 365);
      const by = ["month", "week", "person", "room"].includes(s(a.by, 10)) ? s(a.by, 10) : "month";
      const [{ data }, imgText] = await Promise.all([readStoreCached<{ topics?: ReportTopic[]; posts?: ReportPost[] }>(orgId, "report-feed"), imageTextByPost(orgId)]);
      const topicName = new Map((data?.topics ?? []).map((t) => [t.id, t.name]));
      type Hit = { date: string; person: string; room: string; snippet: string; kind: "report" | "chat" };
      const hits: Hit[] = [];
      const snip = (text: string) => {
        const i = text.toLowerCase().indexOf(kw.toLowerCase());
        return text.slice(Math.max(0, i - 40), i + kw.length + 60).replace(/\s+/g, " ");
      };
      for (const p of data?.posts ?? []) {
        const d = dayOf(p.createdAt)!;
        if (d < from || d > to) continue;
        const text = postText(p) + "\n" + (p.replies ?? []).map((r) => r.body).join("\n") + "\n" + (imgText.get(p.id) ?? "");
        if (has(text, kw)) hits.push({ date: d, person: nameOf(ctx, p.authorId)!, room: topicName.get(p.topicId) ?? "", snippet: snip(text), kind: "report" });
      }
      const channels = await prisma.chatChannel.findMany({ where: { orgId, type: { not: "dm" } }, select: { id: true, name: true, type: true } });
      const chName = new Map(channels.map((c) => [c.id, c.name || (c.type === "org" ? "ห้องรวมบริษัท" : "ห้องกลุ่ม")]));
      const msgs = await prisma.chatMessage.findMany({
        where: { orgId, channelId: { in: channels.map((c) => c.id) }, deletedAt: null, kind: "text", body: { contains: kw, mode: "insensitive" }, createdAt: { gte: new Date(`${from}T00:00:00+07:00`), lte: new Date(`${to}T23:59:59+07:00`) } },
        select: { channelId: true, authorId: true, body: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 5000,
      });
      for (const m of msgs) hits.push({ date: dayOf(m.createdAt)!, person: nameOf(ctx, m.authorId)!, room: `แชท: ${chName.get(m.channelId)}`, snippet: snip(m.body ?? ""), kind: "chat" });
      const weekOf = (d: string) => {
        const t = new Date(`${d}T12:00:00`);
        t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
        return `สัปดาห์ ${localDateStr(t)}`;
      };
      const keyOf = (h: Hit) => (by === "person" ? h.person : by === "room" ? h.room : by === "week" ? weekOf(h.date) : h.date.slice(0, 7));
      const groups = new Map<string, { key: string; count: number; reports: number; chats: number; first: string; last: string }>();
      for (const h of hits) {
        const k = keyOf(h);
        const g = groups.get(k) ?? { key: k, count: 0, reports: 0, chats: 0, first: h.date, last: h.date };
        g.count++;
        if (h.kind === "report") g.reports++; else g.chats++;
        if (h.date < g.first) g.first = h.date;
        if (h.date > g.last) g.last = h.date;
        groups.set(k, g);
      }
      const latest = [...hits].sort((x, y) => y.date.localeCompare(x.date)).slice(0, 6).map((h) => `${h.date} ${h.person} (${h.room}): …${h.snippet}…`);
      return JSON.stringify({
        keyword: kw, from, to, total: hits.length, inReports: hits.filter((h) => h.kind === "report").length, inChats: hits.filter((h) => h.kind === "chat").length,
        groups: [...groups.values()].sort((x, y) => (by === "month" || by === "week" ? y.key.localeCompare(x.key) : y.count - x.count)).slice(0, 60),
        latestExamples: latest,
      });
    }
    case "report_summaries": {
      const { from, to } = span(a, ctx, 14);
      const rows = (await listBriefs(orgId, { from, to, isRange: false, take: 200 }))
        .map((b) => ({
          date: b.day,
          room: b.topicName,
          round: b.roundLabel,
          headline: b.headline,
          urgent: b.detail?.urgent.map((u) => `${u.title} (${u.name}, กระทบ${u.impact})`),
          waitingBoss: b.detail?.decisions.map((x) => `${x.what} (${x.name}, ตั้งแต่ ${x.since})`),
          carry: b.detail?.carry.map((x) => `${x.what} (${x.name})`),
          people: b.people.map((p) => `${p.name}: ${p.oneLine}`),
        }));
      return clip(rows, `สรุปรายรอบ ${from} ถึง ${to}`);
    }
    case "search_group_chat": {
      const { from, to } = span(a, ctx, 14);
      const kw = s(a.keyword, 60), room = s(a.room, 60);
      const who = peopleMatching(ctx, s(a.person, 60));
      const channels = await prisma.chatChannel.findMany({ where: { orgId, type: { not: "dm" } }, select: { id: true, name: true, type: true } });
      const chName = new Map(channels.map((c) => [c.id, c.name || (c.type === "org" ? "ห้องรวมบริษัท" : "ห้องกลุ่ม")]));
      const ids = channels.filter((c) => !room || has(chName.get(c.id)!, room)).map((c) => c.id);
      const msgs = await prisma.chatMessage.findMany({
        where: {
          orgId,
          channelId: { in: ids },
          deletedAt: null,
          kind: "text",
          createdAt: { gte: new Date(`${from}T00:00:00+07:00`), lte: new Date(`${to}T23:59:59+07:00`) },
          ...(kw ? { body: { contains: kw, mode: "insensitive" as const } } : {}),
          ...(who ? { authorId: { in: [...who] } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { channelId: true, authorId: true, body: true, createdAt: true },
      });
      return clip(
        msgs.map((m) => ({ at: new Date(m.createdAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" }), room: chName.get(m.channelId), person: nameOf(ctx, m.authorId), text: (m.body ?? "").slice(0, 200) })),
        `แชทกลุ่ม ${from} ถึง ${to}`
      );
    }
    case "tasks": {
      const st = s(a.status, 20), kw = s(a.keyword, 60);
      const who = peopleMatching(ctx, s(a.person, 60));
      const dueSpan = isDay(a.from) || isDay(a.to) ? span(a, ctx) : null;
      const rows = await prisma.reportTask.findMany({
        where: { orgId },
        select: { id: true, code: true, title: true, status: true, priority: true, assignedById: true, assigneeIds: true, dueDate: true, completedAt: true, data: true },
        orderBy: { dueDate: "desc" },
        take: 3000,
      });
      const today = ctx.today;
      const out = rows
        .filter((t) => {
          const due = t.dueDate.slice(0, 10);
          if (st === "overdue") { if (t.status === "done" || due >= today) return false; }
          else if (st === "open") { if (t.status === "done") return false; }
          else if (st && t.status !== st) return false;
          if (who && !(who.has(t.assignedById) || t.assigneeIds.some((x) => who.has(x)))) return false;
          if (dueSpan && (due < dueSpan.from || due > dueSpan.to)) return false;
          return has(t.title, kw);
        })
        .slice(0, 60)
        .map((t) => {
          const d = t.data as { description?: string; projectId?: string } | null;
          return {
            link: `/report-task/tasks?task=${encodeURIComponent(t.id)}`,
            code: t.code, title: t.title, status: t.status, priority: t.priority,
            by: nameOf(ctx, t.assignedById), to: t.assigneeIds.map((x) => nameOf(ctx, x)),
            due: t.dueDate.slice(0, 10), done: t.completedAt?.slice(0, 10) ?? null,
            late: t.status !== "done" && t.dueDate.slice(0, 10) < today,
            detail: s(d?.description, 160) || undefined,
          };
        });
      return clip(out, `งาน ${out.length} รายการ`);
    }
    case "work_orders": {
      const { from, to } = span(a, ctx, 60);
      const kw = s(a.keyword, 60), house = s(a.house, 60), st = s(a.status, 20);
      const who = peopleMatching(ctx, s(a.person, 60));
      const props = await prisma.property.findMany({ where: { orgId }, select: { id: true, name: true } });
      const pName = new Map(props.map((p) => [p.id, p.name]));
      const rows = await prisma.workOrder.findMany({
        where: {
          orgId,
          createdAt: { gte: new Date(`${from}T00:00:00+07:00`), lte: new Date(`${to}T23:59:59+07:00`) },
          ...(st ? { status: st } : {}),
          ...(who ? { assignedTo: { in: [...who] } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 400,
        select: { id: true, code: true, title: true, status: true, priority: true, propertyId: true, assignedTo: true, dueDate: true, completedAt: true, createdAt: true, autoCreated: true, completionNotes: true },
      });
      const out = rows
        .filter((w) => has(`${w.title} ${w.code}`, kw) && (!house || has(pName.get(w.propertyId) ?? "", house)))
        .map((w) => ({
          link: `/maintenance/work-orders/${w.id}`,
          code: w.code, title: w.title, house: pName.get(w.propertyId), status: w.status, priority: w.priority, pm: w.autoCreated || undefined,
          to: nameOf(ctx, w.assignedTo), opened: dayOf(w.createdAt), due: dayOf(w.dueDate), done: dayOf(w.completedAt), note: s(w.completionNotes, 120) || undefined,
        }));
      return clip(out, `ใบงาน ${from} ถึง ${to}: ${out.length} ใบ`);
    }
    case "purchases_expenses": {
      const { from, to } = span(a, ctx, 60);
      const kw = s(a.keyword, 60), house = s(a.house, 60);
      const props = await prisma.property.findMany({ where: { orgId }, select: { id: true, name: true } });
      const pName = new Map(props.map((p) => [p.id, p.name]));
      const range = { gte: new Date(`${from}T00:00:00+07:00`), lte: new Date(`${to}T23:59:59+07:00`) };
      const [pos, exps] = await Promise.all([
        prisma.purchaseOrder.findMany({ where: { orgId, createdAt: range }, orderBy: { createdAt: "desc" }, take: 300, select: { code: true, title: true, status: true, totalPrice: true, propertyId: true, createdBy: true, createdAt: true, isEmergencyPurchase: true } }),
        prisma.expense.findMany({ where: { orgId, expenseDate: range, isNoExpense: false }, orderBy: { expenseDate: "desc" }, take: 500, select: { amount: true, description: true, category: true, propertyId: true, expenseDate: true, payee: true } }),
      ]);
      const okHouse = (id: string | null) => !house || has(pName.get(id ?? "") ?? "", house);
      const po = pos.filter((x) => has(`${x.title} ${x.code}`, kw) && okHouse(x.propertyId)).map((x) => ({ code: x.code, title: x.title, status: x.status, baht: num(x.totalPrice), house: pName.get(x.propertyId ?? ""), by: nameOf(ctx, x.createdBy), date: dayOf(x.createdAt), emergency: x.isEmergencyPurchase || undefined }));
      const ex = exps.filter((x) => has(`${x.description ?? ""} ${x.category ?? ""} ${x.payee ?? ""}`, kw) && okHouse(x.propertyId)).map((x) => ({ date: dayOf(x.expenseDate), baht: num(x.amount), what: s(x.description, 100), category: x.category, house: pName.get(x.propertyId ?? ""), payee: x.payee }));
      const total = (xs: { baht: number }[]) => Math.round(xs.reduce((t, x) => t + x.baht, 0));
      return clip([{ purchaseOrders: po, poTotalBaht: total(po), expenses: ex, expenseTotalBaht: total(ex) }], `${from} ถึง ${to}`);
    }
    case "money_requests": {
      const { from, to } = span(a, ctx, 60);
      const kind = s(a.kind, 30), st = s(a.status, 30), person = s(a.person, 60);
      // ตาราง requests เปิด RLS แบบ FORCE — อ่านผ่าน withRequestsTenant (ตั้งบริษัทใน transaction) เท่านั้น · กรอง orgId ซ้ำอีกชั้น
      const rows = await withRequestsTenant(orgId, (tx) => tx.moneyRequest.findMany({
        where: { orgId, createdAt: { gte: new Date(`${from}T00:00:00+07:00`), lte: new Date(`${to}T23:59:59+07:00`) }, ...(kind ? { kind: { contains: kind, mode: "insensitive" as const } } : {}), ...(st ? { status: { contains: st, mode: "insensitive" as const } } : {}) },
        orderBy: { createdAt: "desc" },
        take: 300,
        select: { code: true, kind: true, status: true, title: true, beneficiaryName: true, createdByName: true, amount: true, netAmount: true, workDate: true, otMinutes: true, decidedByName: true, decisionNote: true, createdAt: true },
      }));
      const out = rows
        .filter((r) => !person || has(`${r.beneficiaryName} ${r.createdByName}`, person))
        .map((r) => ({ code: r.code, kind: r.kind, status: r.status, title: r.title, for: r.beneficiaryName, by: r.createdByName, baht: num(r.netAmount || r.amount), workDate: dayOf(r.workDate), otMinutes: r.otMinutes ?? undefined, decidedBy: r.decidedByName ?? undefined, note: s(r.decisionNote, 100) || undefined, date: dayOf(r.createdAt) }));
      return clip(out, `คำขอ ${from} ถึง ${to}: ${out.length} รายการ`);
    }
    case "attendance": {
      const { from, to } = span(a, ctx, 30);
      const person = s(a.person, 60);
      const [res, emps] = await Promise.all([
        wfTry<{ items: { employment_id: string; work_date: string; actual_in_at: string | null; actual_out_at: string | null; late_minutes: number; absence_minutes: number; is_on_leave: boolean; is_holiday: boolean; is_rest_day: boolean }[] }>(`/attendance-results?from=${from}&to=${to}`),
        wfTry<{ items: { id: string; display_name: string }[] }>("/employments"),
      ]);
      if (!res || !emps) return JSON.stringify({ error: "เชื่อมต่อระบบลงเวลาไม่ได้ตอนนี้" });
      const nm = new Map(emps.items.map((e) => [e.id, e.display_name]));
      const by = new Map<string, { name: string; workDays: number; lateDays: number; lateMinutes: number; absentDays: number; noCheckIn: number; noCheckOut: number; leaveDays: number; lateDates: string[]; absentDates: string[] }>();
      for (const r of res.items) {
        const name = nm.get(r.employment_id) ?? r.employment_id;
        if (person && !has(name, person)) continue;
        const x = by.get(r.employment_id) ?? { name, workDays: 0, lateDays: 0, lateMinutes: 0, absentDays: 0, noCheckIn: 0, noCheckOut: 0, leaveDays: 0, lateDates: [], absentDates: [] };
        if (r.is_on_leave) x.leaveDays++;
        else if (!r.is_holiday && !r.is_rest_day) {
          x.workDays++;
          if (r.late_minutes > 0) { x.lateDays++; x.lateMinutes += r.late_minutes; x.lateDates.push(r.work_date); }
          if (r.absence_minutes > 0 && !r.actual_in_at) { x.absentDays++; x.absentDates.push(r.work_date); }
          else if (!r.actual_in_at) x.noCheckIn++;
          else if (!r.actual_out_at) x.noCheckOut++;
        }
        by.set(r.employment_id, x);
      }
      const out = [...by.values()].sort((p, q) => q.lateDays + q.absentDays - (p.lateDays + p.absentDays)).map((x) => ({ ...x, lateDates: x.lateDates.slice(-10), absentDates: x.absentDates.slice(-10) }));
      return clip(out, `ลงเวลา ${from} ถึง ${to}`);
    }
    case "leave": {
      const { from, to } = span(a, ctx, 30);
      const person = s(a.person, 60), st = s(a.status, 20);
      const [lr, emps, types] = await Promise.all([
        wfTry<{ items: { employment_id: string; leave_type_id: string; starts_on: string; ends_on: string; total_minutes: number; status: string; reason: string | null }[] }>(`/leave-requests?from=${from}&to=${to}${st ? `&status=${encodeURIComponent(st)}` : ""}`),
        wfTry<{ items: { id: string; display_name: string }[] }>("/employments"),
        wfTry<{ items: { id: string; name: string }[] }>("/leave-types"),
      ]);
      if (!lr || !emps) return JSON.stringify({ error: "เชื่อมต่อระบบลาไม่ได้ตอนนี้" });
      const nm = new Map(emps.items.map((e) => [e.id, e.display_name]));
      const tn = new Map((types?.items ?? []).map((t) => [t.id, t.name]));
      const out = lr.items
        .map((l) => ({ name: nm.get(l.employment_id) ?? "", type: tn.get(l.leave_type_id) ?? "", from: l.starts_on, to: l.ends_on, hours: Math.round(l.total_minutes / 6) / 10, status: l.status === "SUBMITTED" ? "รออนุมัติ" : l.status, reason: s(l.reason, 80) || undefined }))
        .filter((l) => !person || has(l.name, person));
      return clip(out, `ใบลา ${from} ถึง ${to}`);
    }
    case "salary": {
      const period = /^\d{4}-\d{2}$/.test(s(a.period, 7)) ? s(a.period, 7) : "";
      const person = s(a.person, 60);
      // ตาราง salary เปิด RLS แบบ FORCE — อ่านผ่าน withSalaryTenant เท่านั้น (เห็นได้แค่บริษัทนี้) · กรอง orgId ซ้ำอีกชั้น
      const got = await withSalaryTenant(orgId, async (tx) => {
        const run = await tx.salaryRun.findFirst({ where: { orgId, ...(period ? { period } : {}) }, orderBy: { period: "desc" }, select: { id: true, period: true, status: true, startsOn: true, endsOn: true, payDate: true } });
        if (!run) return null;
        // ไม่เลือก bankName/bankAccount/accountName เลย — ไม่มีทางหลุดไปถึง AI
        const lines = await tx.salaryRunLine.findMany({ where: { orgId, runId: run.id }, select: { name: true, department: true, gross: true, deductions: true, net: true, tax: true, ssoEmployee: true } });
        return { run, lines };
      });
      if (!got) return JSON.stringify({ error: "ยังไม่มีงวดเงินเดือน" });
      const { run, lines } = got;
      const rows = lines.filter((l) => !person || has(l.name, person)).map((l) => ({ name: l.name, team: l.department, gross: num(l.gross), deductions: num(l.deductions), tax: num(l.tax), sso: num(l.ssoEmployee), net: num(l.net) }));
      const sum = (k: "gross" | "net" | "deductions") => Math.round(rows.reduce((t, r) => t + r[k], 0));
      return clip([{ period: run.period, status: run.status, from: dayOf(run.startsOn), to: dayOf(run.endsOn), payDate: dayOf(run.payDate), people: rows, totalGross: sum("gross"), totalDeductions: sum("deductions"), totalNet: sum("net") }]);
    }
    case "scores": {
      const { from, to } = span(a, ctx, 30);
      const who = peopleMatching(ctx, s(a.person, 60));
      const ev = await prisma.performanceEvent.findMany({
        where: { orgId, occurredAt: { gte: new Date(`${from}T00:00:00+07:00`), lte: new Date(`${to}T23:59:59+07:00`) }, ...(who ? { userId: { in: [...who] } } : {}) },
        select: { userId: true, category: true, points: true, occurredAt: true, note: true },
        orderBy: { occurredAt: "desc" },
        take: 2000,
      });
      const by = new Map<string, { name: string; total: number; byCategory: Record<string, number>; latest: string[] }>();
      for (const e of ev) {
        const x = by.get(e.userId) ?? { name: nameOf(ctx, e.userId)!, total: 0, byCategory: {}, latest: [] };
        const pts = num(e.points);
        x.total += pts;
        x.byCategory[e.category] = (x.byCategory[e.category] ?? 0) + pts;
        if (x.latest.length < 5 && pts < 0) x.latest.push(`${dayOf(e.occurredAt)} ${e.category} ${pts}${e.note ? ` (${e.note.slice(0, 60)})` : ""}`);
        by.set(e.userId, x);
      }
      return clip([...by.values()].sort((p, q) => p.total - q.total), `คะแนน ${from} ถึง ${to}`);
    }
  }
  return JSON.stringify({ error: `ไม่รู้จักเครื่องมือ ${name}` });
}

/**
 * ถาม AI แบบรู้ข้อมูลทั้งบริษัท — AI เลือกเรียกเครื่องมือเอง (สูงสุด 6 รอบ) แล้วตอบ
 * brief = สรุปที่ Boss เปิดอยู่ตอนถาม (ใช้เป็นบริบทเริ่มต้น "อันนี้" "คนนี้")
 */
export async function askCompany(opts: {
  orgId: string;
  question: string;
  model: string;
  brief?: BossBrief | null;
  history: { q: string; a: string }[];
  /** หน้าที่ Boss เปิดได้ (จากเมนูของคนนั้น) — ใช้พาไปหน้าต่าง ๆ */
  pages?: { label: string; path: string }[];
  /** หน้าที่ Boss เปิดอยู่ตอนถาม เช่น /maintenance/work-orders */
  currentPath?: string;
  /** เงินที่เหลือของเดือนนี้ (บาท) — รอบถัดไปอาจเกิน = หยุดค้น ตอบจากที่ได้ (ไม่เกินเพดาน) */
  budgetThb?: number;
  costOf: (model: string, usage: { prompt_tokens?: number; completion_tokens?: number } | undefined) => number;
}): Promise<{ answer: string; costThb: number; tools: string[] }> {
  // คีย์/Project ของบริษัทนี้ (แยกบิลต่อบริษัทได้ — ai-billing.ts)
  const client = await aiClientFor(opts.orgId);
  const users = await prisma.user.findMany({ where: { orgId: opts.orgId }, select: { id: true, name: true, isActive: true, department: { select: { name: true } } } });
  const ctx: Ctx = {
    orgId: opts.orgId,
    today: localDateStr(new Date()),
    names: new Map(users.map((u) => [u.id, u.name])),
    teams: new Map(users.map((u) => [u.id, u.department?.name ?? ""])),
    pages: opts.pages,
  };
  const b = opts.brief;
  const briefCtx = b
    ? `\n\nตอนนี้ Boss กำลังเปิดสรุป "${b.topicName}" ${b.rangeFrom ? `ช่วง ${b.rangeFrom} ถึง ${b.day}` : `รอบ ${b.roundLabel} วันที่ ${b.day}`}: ${b.headline}\nคนในสรุปนี้: ${b.people.map((p) => `${p.name} (${p.oneLine})`).join(" · ").slice(0, 2500)}`
    : "";
  // Responses API — รุ่นที่ใช้ (gpt-6-sol) เรียกเครื่องมือพร้อมคิดก่อนตอบได้เฉพาะทางนี้ (chat/completions ไม่ให้ใช้ tools คู่กับ reasoning)
  const instructions = `คุณเป็นผู้ช่วยส่วนตัวของ Boss (เจ้าของบริษัท) วันนี้คือ ${ctx.today} (เวลาไทย)
ตอบจากข้อมูลจริงของบริษัทเท่านั้น โดยเรียกเครื่องมือค้นข้อมูลก่อนตอบทุกครั้งที่คำถามเกี่ยวกับข้อมูล เลือกเครื่องมือและช่วงวันให้ตรงคำถาม เรียกหลายเครื่องมือได้
ประหยัด: ค้นให้ครบในครั้งเดียว เรียกหลายเครื่องมือพร้อมกันในรอบเดียวได้ ห้ามเรียกเครื่องมือเดิมซ้ำด้วยเงื่อนไขเดิม ถ้าข้อมูลถูกตัดให้ตอบจากที่มีและบอกว่ามีอีกกี่รายการ · คำถามแบบนับ/บ่อยแค่ไหน/ช่วงเวลายาว ใช้ count_mentions ก่อน · ภาพรวมหลายวันใช้ report_summaries ก่อน · อ่านรายงานเต็ม (search_reports) เฉพาะเมื่อต้องการรายละเอียด และระบุ keyword/คน/ช่วงวันให้แคบที่สุด
ตอบภาษาไทยง่าย สั้น บอกชื่อคนและวันที่ (เช่น 12 พ.ย.) ทุกข้อ ตัวเลขเงินใส่ ฿ ไม่ใช้ตัวหนา/หัวข้อ markdown ถ้าค้นแล้วไม่มีข้อมูลให้บอกตรง ๆ ว่าไม่พบ ห้ามเดา ห้ามแต่ง
รูปแบบคำตอบ (หน้าจอจัดให้สวยตามนี้): บรรทัดแรก = สรุปคำตอบ 1 ประโยค · จากนั้นข้อย่อยขึ้นต้นด้วย "- " ข้อละเรื่อง ไม่เกิน 6 ข้อ แต่ละข้อขึ้นต้นด้วยชื่อคน/ชื่องานสั้น ๆ ตามด้วย " — " แล้วรายละเอียด ลิงก์ไว้ท้ายข้อ · ถ้ามีข้อเสนอ ให้ขึ้นบรรทัดใหม่ที่ขึ้นต้นด้วย "💡 " บรรทัดเดียว
คำนวณได้ (รวม เฉลี่ย เทียบ เปอร์เซ็นต์) — คิดจากตัวเลขที่ค้นได้ และบอกว่าคิดจากอะไร
ช่วยคิดแผน/ข้อเสนอได้ — อิงข้อมูลจริงที่ค้นได้ แยกให้ชัดว่าส่วนไหนคือข้อมูล ส่วนไหนคือข้อเสนอ
พาไปหน้า: ข้อมูลที่ค้นได้มี link ให้ใส่ลิงก์ในคำตอบแบบ [ข้อความสั้น](link) เฉพาะ link ที่ได้จากเครื่องมือเท่านั้น (ห้ามแต่งลิงก์เอง) ถ้า Boss อยากไปหน้าไหนให้ใช้ app_pages
ไม่มีสิทธิ์อ่านแชทส่วนตัว และไม่มีเลขบัญชีธนาคาร ถ้าถูกถามให้บอกว่าไม่มีข้อมูลส่วนนี้${opts.currentPath ? `\nตอนนี้ Boss เปิดหน้า ${opts.currentPath} อยู่ (คำว่า "หน้านี้" หมายถึงหน้านี้)` : ""}${briefCtx}`;
  const input: OpenAI.Responses.ResponseInputItem[] = [
    // ประวัติคุย 3 คำถามล่าสุด คำตอบเก่าตัดเหลือ 600 ตัวอักษร (พอให้ถามต่อเนื่องได้ ไม่ต้องส่งคำตอบยาว ๆ ซ้ำทุกครั้ง)
    ...opts.history.slice(-3).flatMap((x) => [
      { role: "user" as const, content: x.q },
      { role: "assistant" as const, content: x.a.slice(0, 600) },
    ]),
    { role: "user", content: opts.question },
  ];
  let cost = 0;
  let lastStep = 0;
  const budget = opts.budgetThb ?? Number.POSITIVE_INFINITY;
  const used: string[] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    // รอบถัดไปใช้ราวเท่ารอบก่อน + ข้อมูลที่เพิ่งค้นมา ⇒ เผื่อ 1.5 เท่า · ไม่พอ = รอบนี้ต้องเป็นรอบตอบ (ไม่ค้นต่อ)
    const near = step > 0 && cost + lastStep * 1.5 > budget;
    if (step > 0 && cost + lastStep > budget) {
      return { answer: "ค้นข้อมูลได้บางส่วน แต่ค่า AI เดือนนี้ใกล้ถึงเพดานแล้ว จึงหยุดก่อน ลองถามให้แคบลง หรือเพิ่มเพดานในตั้งค่าสรุป", costThb: cost, tools: used };
    }
    const last = step === MAX_STEPS - 1 || near;
    const res = await client.responses.create({
      model: opts.model,
      instructions,
      input,
      ...(last ? {} : { tools: TOOLS }),
      max_output_tokens: 2500,
    });
    const stepCost = opts.costOf(opts.model, { prompt_tokens: res.usage?.input_tokens, completion_tokens: res.usage?.output_tokens });
    cost += stepCost;
    lastStep = stepCost;
    const calls = res.output.filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === "function_call");
    if (calls.length === 0 || last) {
      return { answer: (res.output_text ?? "").replaceAll("**", "").trim() || "ตอบไม่ได้ ลองถามใหม่อีกครั้ง", costThb: cost, tools: used };
    }
    input.push(...(res.output as OpenAI.Responses.ResponseInputItem[]));
    for (const c of calls) {
      let args: Args = {};
      try { args = JSON.parse(c.arguments || "{}") as Args; } catch { /* ใช้ค่าเริ่มต้น */ }
      used.push(c.name);
      let out: string;
      try {
        out = await runTool(c.name, args, ctx);
      } catch (e) {
        console.error("[company-ai] tool", c.name, e instanceof Error ? e.message : e);
        out = JSON.stringify({ error: "ค้นข้อมูลส่วนนี้ไม่สำเร็จ" });
      }
      input.push({ type: "function_call_output", call_id: c.call_id, output: out });
    }
  }
  return { answer: "ค้นข้อมูลนานเกินไป ลองถามให้แคบลง เช่น ระบุช่วงวันหรือชื่อคน", costThb: cost, tools: used };
}
