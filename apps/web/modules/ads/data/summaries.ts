import "server-only";
import { prisma, type Prisma } from "@smartboss/database";
import { fromDbDate, isDate, toDbDate } from "../lib/periods";
import { postBotText } from "./bot";

/**
 * บทสรุปที่ AI บน n8n เขียนแล้วส่งเข้ามา — โชว์บนแดชบอร์ด · ส่งเข้ากลุ่ม 🤖 Ads Agent ด้วยได้ (notify: true)
 */

type Obj = Record<string, unknown>;

export interface SummaryView {
  id: string;
  customerId: string | null;
  period: { from: string; to: string } | null;
  title: string;
  body: string;
  highlights: { label: string; value: string; tone: "good" | "bad" | "neutral" }[];
  createdAt: Date;
}

export async function createSummary(orgId: string, body: Obj): Promise<{ id: string; chat_message_id: string | null }> {
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 255) : "";
  const text = typeof body.body === "string" ? body.body.trim().slice(0, 20000) : "";
  if (!title || !text) throw new Error("ต้องส่ง title และ body");
  const customerId = body.customer_id != null ? String(body.customer_id).replace(/\D/g, "") || null : null;
  if (customerId && !(await prisma.adsAccount.findFirst({ where: { orgId, customerId }, select: { customerId: true } }))) {
    throw new Error("ไม่พบบัญชีโฆษณานี้ในบริษัท");
  }
  const highlights = Array.isArray(body.highlights)
    ? body.highlights
        .filter((h): h is Obj => !!h && typeof h === "object" && (h as Obj).label != null && (h as Obj).value != null)
        .slice(0, 8)
        .map((h) => ({ label: String(h.label).slice(0, 60), value: String(h.value).slice(0, 60), tone: h.tone === "good" || h.tone === "bad" ? h.tone : "neutral" }))
    : null;
  const row = await prisma.adsSummary.create({
    data: {
      orgId,
      customerId,
      periodFrom: isDate(body.period_from) ? toDbDate(body.period_from as string) : null,
      periodTo: isDate(body.period_to) ? toDbDate(body.period_to as string) : null,
      title,
      body: text,
      highlights: (highlights ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    select: { id: true },
  });

  // notify = true → ส่งเข้ากลุ่ม 🤖 Ads Agent ด้วย · ไม่ส่ง/false = โชว์บนแดชบอร์ดอย่างเดียว
  let chatMessageId: string | null = null;
  if (body.notify === true) {
    const message = typeof body.chat_text === "string" && body.chat_text.trim() ? body.chat_text : `📊 ${title}\n\n${text}`;
    chatMessageId = (await postBotText(orgId, message)).message_id;
  }
  return { id: String(row.id), chat_message_id: chatMessageId };
}

export async function latestSummary(orgId: string, customerId: string | null): Promise<SummaryView | null> {
  const row = await prisma.adsSummary.findFirst({
    where: { orgId, ...(customerId ? { OR: [{ customerId }, { customerId: null }] } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  return {
    id: String(row.id),
    customerId: row.customerId,
    period: row.periodFrom && row.periodTo ? { from: fromDbDate(row.periodFrom), to: fromDbDate(row.periodTo) } : null,
    title: row.title,
    body: row.body,
    highlights: Array.isArray(row.highlights) ? (row.highlights as SummaryView["highlights"]) : [],
    createdAt: row.createdAt,
  };
}
