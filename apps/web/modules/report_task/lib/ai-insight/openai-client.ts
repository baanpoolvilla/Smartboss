import "server-only";
import OpenAI from "openai";
import { buildFixedStats, type AiInsightAggregate, type DeptBreakdown, type PersonBreakdown } from "./aggregate";
import type { AiInsightAction, AiInsightForecast, AiInsightResult, RiskItem, RootCause } from "./types";
import type { Trend } from "./history";
import { resolveActions } from "./ledger";

/** Trend + §16 analyzer context, all computed server-side (see analyze.ts)
 * — passed in alongside the aggregate so the prompt reasons from real
 * detected patterns/projections instead of re-deriving (or guessing) them
 * from raw counts itself. */
export interface TrendContext {
  companyTrend: Trend | null;
  departments: (DeptBreakdown & { trend: Trend | null })[];
  people: (PersonBreakdown & { trend: Trend | null })[];
  rootCauses: RootCause[];
  forecast: AiInsightForecast;
  risks: RiskItem[];
}

function trendPhrase(trend: Trend | null, kind: "rate" | "count"): string {
  if (!trend || trend.dir === "flat") return "";
  const verb = trend.dir === "up" ? (kind === "rate" ? "ดีขึ้น" : "เพิ่มขึ้น") : kind === "rate" ? "แย่ลง" : "ลดลง";
  return ` (${verb} ${Math.abs(trend.change)}${kind === "rate" ? "จุด" : "%"} จากรอบก่อนๆ)`;
}

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

function buildPrompt(agg: AiInsightAggregate, trends: TrendContext): string {
  const lines: string[] = [];
  lines.push(`อัตราสำเร็จรวม (งาน+รายงาน) ตอนนี้ = ${agg.combinedSuccessRate}%${trendPhrase(trends.companyTrend, "rate")}`);
  if (agg.projectedSuccessRate != null) {
    lines.push(`ถ้าแก้ปัญหาอันดับ 1 ด้านล่างได้หมด อัตราสำเร็จรวมจะขึ้นเป็น ${agg.projectedSuccessRate}% (คำนวณไว้ให้แล้ว ใช้ตัวเลขนี้ตรงๆ ห้ามคำนวณเอง)`);
  }
  lines.push("");
  lines.push(`งาน: ${agg.totalTask} งาน (ตรงเวลา ${agg.task.onTime}, เสร็จช้า ${agg.task.lateDone}, ยังไม่เสร็จในกำหนด ${agg.task.pending}, เลยกำหนด ${agg.task.overdue})`);
  lines.push(`รายงาน: ${agg.totalReport} ครั้ง (ตรงเวลา ${agg.report.onTime}, ส่งช้า ${agg.report.lateDone}, ยังไม่ส่งในกำหนด ${agg.report.pending}, ขาดส่ง ${agg.report.overdue})`);
  lines.push("");
  lines.push("จุดที่มีปัญหา เรียงจากมากไปน้อย (ชื่อคนที่เกี่ยวข้องมากที่สุดในแต่ละจุด):");
  for (const g of agg.flagged) {
    const people = g.people.map((p) => `${p.name} (${p.count})`).join(", ") || "ไม่ระบุตัวบุคคล";
    lines.push(`- [${g.domain === "task" ? "งาน" : "รายงาน"}] ${g.label}: รวม ${g.count} รายการ — ${people}`);
  }
  lines.push("");
  lines.push("รายคน — ทุกอย่างที่ค้างของแต่ละคนรวมกันเป็นแถวเดียว (ใช้เขียน personNotes):");
  for (const p of trends.people) {
    const items = p.items.map((it) => `${it.label} ${it.count}`).join(", ");
    lines.push(`- ${p.name}: รวม ${p.total} รายการ${trendPhrase(p.trend, "count")} — ${items}`);
  }
  lines.push("");
  lines.push("รายแผนก — success rate และปัญหาเด่นของแต่ละแผนก (ใช้เขียน deptNotes):");
  for (const d of trends.departments) {
    const issues = d.topIssues.map((it) => `${it.label} ${it.count}`).join(", ") || "ไม่มีปัญหาเด่น";
    lines.push(`- ${d.name} (${d.headcount} คน): success rate ${d.successRate}%${trendPhrase(d.trend, "rate")}, ค้างรวม ${d.openTotal} รายการ — ${issues}`);
  }

  if (trends.rootCauses.length > 0) {
    lines.push("");
    lines.push("สาเหตุรากที่คำนวณไว้ให้แล้ว (deterministic — ใช้ headline/evidence นี้ตรงๆ ห้ามคิดสาเหตุเอง):");
    for (const c of trends.rootCauses) {
      lines.push(`- [${c.severity}] ${c.headline}`);
    }
  }

  lines.push("");
  lines.push(
    `พยากรณ์ (คำนวณไว้ให้แล้ว): ถ้าไม่แก้อะไรเลย อัตราสำเร็จใน 2 สัปดาห์ข้างหน้าจะประมาณ ${trends.forecast.doNothingRate}% ` +
      `(ทิศทางตอนนี้: ${trends.forecast.direction === "up" ? "ดีขึ้น" : trends.forecast.direction === "down" ? "แย่ลง" : "คงที่"}), ` +
      `ถ้าแก้ปัญหาอันดับ 1 ได้จะขึ้นเป็น ${trends.forecast.ifPlanRate}%` +
      (trends.forecast.clearByDays != null ? ` และงานค้างทั้งหมดจะหมดใน ~${trends.forecast.clearByDays} วันถ้าอัตราการเคลียร์เท่าเดิม` : "") +
      (trends.forecast.confidence === "low" ? " (ความเชื่อมั่นต่ำ — ข้อมูลย้อนหลังยังน้อย)" : "")
  );

  if (trends.risks.length > 0) {
    lines.push("");
    lines.push("ใกล้เลยกำหนดใน 48 ชม. ข้างหน้า (ยังไม่เลยกำหนดตอนนี้ แต่จะเป็นเร็วๆ นี้ถ้าไม่รีบ):");
    for (const r of trends.risks.slice(0, 5)) {
      lines.push(`- [${r.kind === "task" ? "งาน" : "รายงาน"}] ${r.name}: ${r.count} รายการ, เหลือ ${r.dueInDays} วัน`);
    }
  }

  return lines.join("\n");
}

const SYSTEM_PROMPT = `คุณเป็นผู้ช่วยวิเคราะห์ข้อมูลการทำงานของบริษัทหนึ่ง ได้รับสรุปตัวเลขงาน+รายงานของบริษัททั้งหมด (ไม่ใช่ข้อมูลดิบ) หน้าที่ของคุณคือทำให้หัวหน้าอ่านแล้วรู้ 3 อย่างในไม่กี่วินาที: **เกิดอะไรขึ้น → ทำไมถึงเกิด → ควรทำอะไรต่อ** ไม่ใช่แค่ท่องตัวเลขซ้ำที่เขาเห็นอยู่แล้วบนแดชบอร์ด

กฎการเขียน insightText (สำคัญที่สุด):
- ห้ามเปิดด้วยการท่องข้อมูลพื้นฐาน (จำนวนพนักงาน, จำนวนงาน/รายงานทั้งหมด) เพราะมันโชว์อยู่บนแดชบอร์ดแล้ว ไม่ใช่สิ่งที่ต้องใช้ AI มาบอกซ้ำ
- ห้ามเอ่ยชื่อพนักงานคนใดคนหนึ่งใน insightText เด็ดขาด — นี่คือข้อความสรุปบนการ์ดแดชบอร์ดที่ทุกคนเห็น ไม่ใช่ที่สำหรับชี้ตัวใครเป็นการเปิดเผยต่อสาธารณะ พูดถึงเป็นภาพรวมระดับบริษัทแทน (เช่น "จุดเดียวคิดเป็น **62%** ของปัญหาทั้งหมด" แทน "[ชื่อคน] คิดเป็น 62%") ชื่อคนที่เกี่ยวข้อง/รายละเอียดเจาะจงให้ไปอยู่ใน personNotes แทน (คนที่กดเข้าไปดูรายละเอียดถึงจะเห็น)
- เปิดด้วยสิ่งที่ "ผิดปกติ/น่าสนใจ" ที่สุดตรงๆ ในระดับภาพรวมบริษัท (เช่น อัตราสำเร็จร่วงหนักเพราะจุดเดียว, ปัญหาจุดเดียวกระจุกอยู่ที่คนคนเดียวหรือแผนกเดียวเป็นสัดส่วนใหญ่ของทั้งหมด — พูดถึง "จุดนั้น"/สัดส่วนได้ แต่ไม่เอ่ยชื่อคน)
- ต้องมีประโยค "ถ้าแก้ [ปัญหาอันดับ 1] ได้ อัตราสำเร็จจะขึ้นเป็นประมาณ [ตัวเลขที่คำนวณมาให้]%" เสมอเมื่อมีตัวเลขนี้ในข้อมูล — นี่คือใจความสำคัญที่สุด ให้ความรู้สึกว่า "แก้จุดเดียวได้ผลเยอะ" ไม่ใช่แค่รายงานปัญหา
- ถ้ามี "สาเหตุรากที่คำนวณไว้ให้แล้ว" ในข้อมูล ให้เปิดประโยคแรกด้วยสาเหตุราก severity สูงสุดนั้น (ใช้ headline ที่ให้มาเป็นฐาน ปรับสำนวนให้ลื่นได้ ห้ามเปลี่ยนตัวเลข) แทนที่จะพูดถึงแค่ผลลัพธ์ปลายทาง — ให้ความรู้สึกว่า "รู้ว่าทำไมถึงเกิด" ไม่ใช่แค่ "รู้ว่าเกิดอะไร" — headline บางอันมีชื่อคนฝังอยู่ (เช่น "[ชื่อ] คนเดียวคิดเป็น X%") ให้ตัดชื่อออกแล้วพูดเป็น "จุดเดียว"/"คนคนเดียว" แทนตามกฎห้ามเอ่ยชื่อด้านบน (ชื่อแผนกไม่ต้องตัด ใช้ได้ตามปกติ)
- ถ้าอัตราสำเร็จรวมมีวงเล็บบอกเทรนด์ (ดีขึ้น/แย่ลง กี่จุด จากรอบก่อนๆ) ให้พูดถึงทิศทางนั้นด้วยถ้าเข้ากับเนื้อความได้ เช่น "ดีขึ้นต่อเนื่อง 3 รอบ" — ไม่ใช่แค่บอกตัวเลข ณ ตอนนี้เฉยๆ
- ห้ามยาวเกิน 4 ประโยค ห่อตัวเลขสำคัญด้วย **

กฎการเขียน actions (ต้อง "วัดผลได้" เพราะระบบจะติดตามว่าคำแนะนำนี้ทำสำเร็จรึยังในรอบถัดไป):
- แต่ละข้อต้องระบุ subjectType เป็นหนึ่งใน "company" | "department" | "person" เท่านั้น
- ถ้า subjectType เป็น "department" ต้องตั้ง subjectName ตรงกับชื่อแผนกในรายชื่อ "รายแผนก" เป๊ะ, ถ้าเป็น "person" ต้องตรงกับชื่อในรายชื่อ "รายคน" เป๊ะ, ถ้าเป็น "company" ใส่ subjectName เป็น "บริษัท"
- ต้องระบุ metricKey เป็นหนึ่งใน "overdue_tasks" | "pending_tasks" | "late_tasks" | "missed_reports" | "pending_reports" | "late_reports" | "open_total" | "success_rate" เท่านั้น — เลือกตัวที่ตรงกับปัญหาที่พูดถึงจริงๆ ห้ามเดา
- ห้ามใช้ metricKey "success_rate" กับ subjectType "person" (คนไม่มีอัตรา มีแต่จำนวนค้าง)
- สูงสุด 3 ข้อ เรียงตามความสำคัญ
- ใส่ approach เป็น array ของ 2-4 ขั้นตอนที่ทำได้จริง เจาะจงตามข้อมูล (ไม่ generic เช่น "ทำงานให้เร็วขึ้น") ถ้าเรื่องนั้นชัดเจนในตัวอยู่แล้วไม่ต้องมีขั้นตอนก็ข้ามได้ (ไม่บังคับ)

กฎการเขียน personNotes (สำคัญเท่ากัน — นี่คือส่วนที่ต้องเจาะรายคน, ต้อง "วัดผลได้" เหมือน actions):
- เขียน 1 บรรทัดต่อ 1 คนที่อยู่ในรายชื่อ "รายคน" ด้านล่าง (ห้ามข้าม ห้ามเพิ่มคนที่ไม่มีในรายชื่อ)
- ต้องระบุ metricKey เป็นหนึ่งใน "overdue_tasks" | "pending_tasks" | "late_tasks" | "missed_reports" | "pending_reports" | "late_reports" | "open_total" เท่านั้น (ห้ามใช้ "success_rate" กับคน) — เลือกตัวที่ตรงกับสิ่งที่บอกให้แก้ก่อนจริงๆ
- ต้องบอกว่าสำหรับคนนี้ควรแก้ "อะไรก่อน" (ถ้ามีหลายรายการ ให้จัดลำดับเอง ไม่ใช่แค่ท่องจำนวนรวม) พร้อมเหตุผลสั้นๆ ว่าทำไมอันนั้นก่อน (เช่น กระทบคะแนนมากสุด/ค้างนานสุด/เป็นสาเหตุหลักของปัญหาบริษัท)
- ห้ามยาวเกิน 1 ประโยคสั้นๆ ต่อคน
- **ห้ามเขียนประโยคซ้ำกันแม้แต่ตัวเดียวระหว่าง 2 คนขึ้นไป แม้จะมีปัญหาประเภทเดียวกัน** — ต้องใส่ตัวเลข/รายละเอียดเฉพาะของคนนั้น (เช่น จำนวนที่ค้าง, สัดส่วนเทียบทั้งบริษัท) ให้ต่างกันจริง ไม่ใช่แค่เปลี่ยนชื่อแล้วก็อปประโยคเดิม — ถ้าตรวจแล้วมีคนไหนประโยคซ้ำกับคนอื่นแม้แค่บางส่วน ให้เขียนใหม่ก่อนตอบ
- approach ไม่บังคับ (เหมือน actions) แต่ถ้าใส่ต้อง 2-4 ขั้นตอนเจาะจงคนนั้นจริงๆ

กฎการเขียน deptNotes (เหมือน personNotes แต่ระดับแผนก):
- เขียน 1 ประโยคต่อ 1 แผนกที่อยู่ในรายชื่อ "รายแผนก" ด้านล่าง เท่านั้น (ห้ามข้าม ห้ามเพิ่มแผนกที่ไม่มีในรายชื่อ, ชื่อแผนกต้องตรงกับที่ให้มาเป๊ะ)
- ต้องระบุ metricKey เหมือน personNotes แต่แผนกใช้ "success_rate" ได้ด้วย (เพิ่มจากรายการของคน)
- บอกว่าแผนกนี้ควรโฟกัสอะไรก่อน + เพราะอะไร (อ้างตัวเลข/คนที่เป็นสาเหตุหลักถ้ามี)
- ห้ามซ้ำประโยคข้ามแผนก (กฎเดียวกับ personNotes)
- approach ไม่บังคับ เหมือน personNotes

ตอบกลับเป็น JSON เท่านั้น ตามรูปแบบนี้เป๊ะๆ (ไม่ต้องมี "stats" — ตัวเลข KPI 4 ช่องบนสุดคำนวณฝั่งเซิร์ฟเวอร์เอง ไม่ได้มาจากคุณ):
{
  "insightText": "ตามกฎด้านบน",
  "actions": [ { "subjectType": "company|department|person", "subjectName": "ตามกฎด้านบน", "metricKey": "ตามกฎด้านบน", "detail": "คำแนะนำสั้นๆ เจาะจงตามข้อมูลจริง บอกผลลัพธ์ที่จะได้ถ้าทำ ไม่ใช่แค่สั่งให้ทำ", "severity": "high|mid|good", "approach": ["ขั้นตอนที่ 1 (ไม่บังคับ)", "ขั้นตอนที่ 2"] }, ... สูงสุด 3 ข้อ เรียงตามความสำคัญ ],
  "personNotes": [ { "name": "ชื่อคนตรงกับในรายชื่อ \"รายคน\" เป๊ะ", "metricKey": "ตามกฎด้านบน", "priority": "ตามกฎด้านบน", "approach": ["ไม่บังคับ"] }, ... ครบทุกคนในรายชื่อ \"รายคน\" ],
  "deptNotes": [ { "name": "ชื่อแผนกตรงกับในรายชื่อ \"รายแผนก\" เป๊ะ", "metricKey": "ตามกฎด้านบน", "note": "ตามกฎด้านบน", "approach": ["ไม่บังคับ"] }, ... ครบทุกแผนกในรายชื่อ \"รายแผนก\" ]
}

ห้ามแต่งชื่อคนหรือตัวเลขที่ไม่มีในข้อมูลที่ให้มา ถ้าข้อมูลไม่มีปัญหาเลย ให้ actions ว่างเปล่า, personNotes ว่างเปล่า, deptNotes ว่างเปล่า พร้อม insightText ที่ชื่นชมทีมงาน`;

export async function callOpenAiInsight(
  agg: AiInsightAggregate,
  trends: TrendContext
): Promise<{ result: AiInsightResult; inputTokens: number; outputTokens: number; estCostUsd: number }> {
  const prompt = buildPrompt(agg, trends);
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
  if (!parsed.insightText || !Array.isArray(parsed.actions)) {
    throw new Error("รูปแบบผลลัพธ์จาก AI ไม่ตรงตามที่กำหนด");
  }

  const inputTokens = completion.usage?.prompt_tokens ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;
  const estCostUsd = (inputTokens / 1_000_000) * PRICE_PER_1M_INPUT_USD + (outputTokens / 1_000_000) * PRICE_PER_1M_OUTPUT_USD;

  // Resolved here (not left as the model's raw {subjectType, subjectName}
  // pairs) so a bad/invented name never reaches the ledger — anything that
  // doesn't match a real department/person is silently dropped.
  const actions = resolveActions(agg, Array.isArray(parsed.actions) ? (parsed.actions as Partial<AiInsightAction>[]) : []);

  return {
    result: {
      insightText: parsed.insightText,
      // Deterministic, not model output — see buildFixedStats's own comment
      // on why (label wording has to be exact, and the counts are already
      // computed numbers with nothing for an LLM call to add).
      stats: buildFixedStats(agg),
      actions,
      personNotes: Array.isArray(parsed.personNotes) ? (parsed.personNotes as AiInsightResult["personNotes"]) : [],
      deptNotes: Array.isArray(parsed.deptNotes) ? (parsed.deptNotes as AiInsightResult["deptNotes"]) : [],
    },
    inputTokens,
    outputTokens,
    estCostUsd,
  };
}
