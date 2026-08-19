import "server-only";
import OpenAI from "openai";
import type { AiInsightAggregate } from "./aggregate";
import type { AiInsightResult } from "./types";

/** One shared key for the whole platform — every org's analysis runs
 * through this same OpenAI account, billed centrally to us, not per-org
 * (see AI-Insight report §4). Never expose this client or the key to any
 * client-side code. */
const MODEL = "gpt-4o-mini";

// Per-million-token pricing, gpt-4o-mini — used only to estimate/display
// cost, has no effect on the actual OpenAI bill. Re-check openai.com/pricing
// before relying on this for real accounting; providers change prices.
const PRICE_PER_1M_INPUT_USD = 0.15;
const PRICE_PER_1M_OUTPUT_USD = 0.6;

function client(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY ยังไม่ได้ตั้งค่า");
  return new OpenAI({ apiKey });
}

function buildPrompt(agg: AiInsightAggregate): string {
  const lines: string[] = [];
  lines.push(`บริษัทนี้มีพนักงาน ${agg.headcount} คน`);
  lines.push(`งานทั้งหมดในระบบ ${agg.totalTask} งาน — เสร็จตรงเวลา ${agg.task.onTime}, เสร็จช้า ${agg.task.lateDone}, ยังไม่เสร็จในกำหนด ${agg.task.pending}, เลยกำหนด ${agg.task.overdue} (อัตราสำเร็จ ${agg.task.successRate}%)`);
  lines.push(`รายงานทั้งหมดในระบบ ${agg.totalReport} ครั้ง — ส่งตรงเวลา ${agg.report.onTime}, ส่งช้า ${agg.report.lateDone}, ยังไม่ส่งในกำหนด ${agg.report.pending}, ขาดส่ง ${agg.report.overdue} (อัตราสำเร็จ ${agg.report.successRate}%)`);
  lines.push("");
  lines.push("จุดที่มีปัญหา เรียงจากมากไปน้อย (ชื่อคนที่เกี่ยวข้องมากที่สุดในแต่ละจุด):");
  for (const g of agg.flagged) {
    const people = g.people.map((p) => `${p.name} (${p.count})`).join(", ") || "ไม่ระบุตัวบุคคล";
    lines.push(`- [${g.domain === "task" ? "งาน" : "รายงาน"}] ${g.label}: รวม ${g.count} รายการ — ${people}`);
  }
  return lines.join("\n");
}

const SYSTEM_PROMPT = `คุณเป็นผู้ช่วยวิเคราะห์ข้อมูลการทำงานของบริษัทหนึ่ง ได้รับสรุปตัวเลขงาน+รายงานของบริษัททั้งหมด (ไม่ใช่ข้อมูลดิบ) ให้สรุปเป็นภาษาไทยที่หัวหน้าอ่านแล้วเข้าใจทันที ไม่ใช่ศัพท์เทคนิค

ตอบกลับเป็น JSON เท่านั้น ตามรูปแบบนี้เป๊ะๆ:
{
  "insightText": "ย่อหน้าเดียว 2-3 ประโยค สรุปภาพรวมและต้นเหตุหลัก ใส่ตัวเลข/ชื่อคนสำคัญ ห่อตัวเลขด้วย ** เช่น **10%**",
  "stats": [ { "label": "คนควรคุยด่วน", "count": 3, "tone": "red" }, ... อีก 3 ตัวรวมเป็น 4 ตัว โทน red/amber/green ตามความรุนแรง ],
  "actions": [ { "who": "ชื่อคนหรือแผนก", "detail": "คำแนะนำสั้นๆ เจาะจงตามข้อมูลจริง", "severity": "high|mid|good" }, ... สูงสุด 3 ข้อ เรียงตามความสำคัญ ]
}

ห้ามแต่งชื่อคนหรือตัวเลขที่ไม่มีในข้อมูลที่ให้มา ถ้าข้อมูลไม่มีปัญหาเลย ให้ stats เป็นศูนย์ทั้งหมดและ actions ว่างเปล่า พร้อม insightText ที่ชื่นชมทีมงาน`;

export async function callOpenAiInsight(agg: AiInsightAggregate): Promise<{ result: AiInsightResult; inputTokens: number; outputTokens: number; estCostUsd: number }> {
  const prompt = buildPrompt(agg);
  const completion = await client().chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    temperature: 0.4,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("OpenAI ไม่ตอบข้อความกลับมา");
  const parsed = JSON.parse(raw) as Partial<AiInsightResult>;
  if (!parsed.insightText || !Array.isArray(parsed.stats) || !Array.isArray(parsed.actions)) {
    throw new Error("รูปแบบผลลัพธ์จาก AI ไม่ตรงตามที่กำหนด");
  }

  const inputTokens = completion.usage?.prompt_tokens ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;
  const estCostUsd = (inputTokens / 1_000_000) * PRICE_PER_1M_INPUT_USD + (outputTokens / 1_000_000) * PRICE_PER_1M_OUTPUT_USD;

  return {
    result: { insightText: parsed.insightText, stats: parsed.stats as AiInsightResult["stats"], actions: parsed.actions as AiInsightResult["actions"] },
    inputTokens,
    outputTokens,
    estCostUsd,
  };
}
