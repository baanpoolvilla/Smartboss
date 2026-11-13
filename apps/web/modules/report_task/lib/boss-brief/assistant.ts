import "server-only";
import { createStoreIfAbsent, readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { getOrgPlan, planAtLeast } from "@/modules/report_task/lib/plan";
import { localDateStr } from "@/modules/report_task/lib/now";
import { askCompany } from "./company-ai";
import { withAiLock } from "./ai-budget";
import { addUsage, costThb, effectiveCap, readBriefSettings, readUsage } from "./server";
import { estimateThb, type BriefQa } from "./types";

/**
 * ผู้ช่วย AI ลอยมุมซ้ายล่างทุกหน้า (น้อง SmartBoss) — เฉพาะ Boss (13/11/2569)
 * ผู้ใช้: "เอาไว้มุมซ้ายทุกหน้า กดไปก็คุยแชทกับ AI แต่เป็นข้อมูลแต่ละบริษัทเอง คำนวณได้ หาได้ พาไปได้ คิดแผนได้"
 * ใช้เครื่องมือค้นข้อมูลชุดเดียวกับปุ่มในสรุปรายงาน (company-ai.ts) · เพดานเงินเดียวกับสรุป (boss-brief-usage)
 * แชทเก็บแยกต่อคน ต่อบริษัท: stores key `ai-assistant:<userId>` (ไม่อยู่ใน store-registry ⇒ อ่านได้ผ่าน API นี้เท่านั้น) · 40 ข้อความล่าสุด
 */

const KEEP = 40;
const keyOf = (userId: string) => `ai-assistant:${userId}`;
type Chat = { messages: BriefQa[] };

export interface AssistantView {
  allowed: boolean;
  messages: BriefQa[];
  usage: { thb: number; capThb: number };
}

export async function assistantView(orgId: string, userId: string, isBoss: boolean): Promise<AssistantView> {
  const none: AssistantView = { allowed: false, messages: [], usage: { thb: 0, capThb: 0 } };
  if (!isBoss || !planAtLeast(await getOrgPlan(orgId), "PRO")) return none;
  const settings = await readBriefSettings(orgId);
  const [{ data }, usage, { cap }] = await Promise.all([readStore<Chat>(orgId, keyOf(userId)), readUsage(orgId, localDateStr(new Date()).slice(0, 7)), effectiveCap(orgId, settings)]);
  return { allowed: true, messages: data?.messages ?? [], usage: { thb: usage.thb, capThb: cap } };
}

export async function askAssistant(
  orgId: string,
  userId: string,
  question: string,
  currentPath: string,
  pages: { label: string; path: string }[]
): Promise<{ ok: true; messages: BriefQa[] } | { ok: false; error: string }> {
  const q = question.trim().slice(0, 800);
  if (!q) return { ok: false, error: "พิมพ์คำถามก่อน" };
  const settings = await readBriefSettings(orgId);
  const month = localDateStr(new Date()).slice(0, 7);
  const usage = await readUsage(orgId, month);
  const { cap } = await effectiveCap(orgId, settings);
  if (usage.thb + estimateThb(settings.askModel, "ask") > cap) return { ok: false, error: `ใกล้ครบเพดาน ฿${cap} ของเดือนนี้แล้ว (ตั้งเพิ่มได้ที่ตั้งค่าสรุปในห้องรายงาน)` };
  const { data } = await readStore<Chat>(orgId, keyOf(userId));
  return withAiLock(orgId, async () => {
  const leftNow = cap - (await readUsage(orgId, month)).thb;
  if (leftNow < estimateThb(settings.askModel, "ask")) return { ok: false as const, error: `ใกล้ครบเพดาน ฿${cap} ของเดือนนี้แล้ว (ตั้งเพิ่มได้ที่ตั้งค่าสรุปในห้องรายงาน)` };
  try {
    const r = await askCompany({ orgId, question: q, model: settings.askModel, brief: null, history: data?.messages ?? [], pages, currentPath: currentPath.slice(0, 200), costOf: costThb, budgetThb: leftNow });
    await addUsage(orgId, month, r.costThb);
    const msg: BriefQa = { at: new Date().toISOString(), q, a: r.answer, costThb: r.costThb, sources: [...new Set(r.tools)] };
    for (let i = 0; i < 5; i++) {
      const cur = await readStore<Chat>(orgId, keyOf(userId));
      const messages = [...(cur.data?.messages ?? []), msg].slice(-KEEP);
      const w = cur.version === 0 ? await createStoreIfAbsent(orgId, keyOf(userId), { messages }) : await writeStore(orgId, keyOf(userId), { messages }, cur.version);
      if (w.ok) return { ok: true as const, messages };
    }
    return { ok: false as const, error: "บันทึกแชทไม่สำเร็จ ลองใหม่" };
  } catch (e) {
    console.error("[ai-assistant] ask", orgId, e instanceof Error ? e.message : e);
    return { ok: false as const, error: "AI ตอบไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
  });
}

export async function clearAssistant(orgId: string, userId: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const cur = await readStore<Chat>(orgId, keyOf(userId));
    if (cur.version === 0) return;
    const w = await writeStore(orgId, keyOf(userId), { messages: [] }, cur.version);
    if (w.ok) return;
  }
}
