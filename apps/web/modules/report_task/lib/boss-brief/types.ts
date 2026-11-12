/**
 * สรุปรายงานให้ Boss (12/11/2569) — การ์ด "รอบนี้มีอะไร" บนสุดของห้องรายงาน
 *
 * - เห็นเฉพาะ CEO (Boss) · แจ้งเตือนในแอปอย่างเดียว ไม่ส่ง LINE
 * - ประเภท (ปัญหา/ล่าช้า/รอตัดสินใจ/เสร็จ) และสี = ระบบอ่านจากหัวข้อและสีที่คนเขียนใส่เอง
 *   AI แค่ย่อใจความเหลือบรรทัดเดียว + เขียนภาพรวม 1 ประโยค + ตอบคำถามที่ Boss พิมพ์ถาม
 * - ปิดอยู่เป็นค่าเริ่มต้น (ใช้หลายบริษัท) · Boss เปิดเองทีละห้อง · มีเพดานเงินต่อเดือน
 */

export type BriefKind = "stuck" | "late" | "ask" | "done";
export type BriefColor = "red" | "yellow" | "green" | "none";

export const BRIEF_KINDS: { id: BriefKind; icon: string; label: string; empty: string }[] = [
  { id: "stuck", icon: "⚠️", label: "ปัญหา / ความเสี่ยง", empty: "ไม่มีใครแจ้งปัญหา" },
  { id: "late", icon: "⏰", label: "ล่าช้า / ค้าง", empty: "ไม่มีงานล่าช้า" },
  { id: "ask", icon: "🙋", label: "รอคุณตัดสินใจ", empty: "ไม่มีเรื่องรอคุณ" },
  { id: "done", icon: "✅", label: "เสร็จแล้ว", empty: "ยังไม่มีงานที่แจ้งว่าเสร็จ" },
];

/** หัวข้อของฟอร์ม → ประเภท (ดูจากคำในชื่อหัวข้อ) · null = ไม่นำมานับ (เช่น หัวส่วน 🏁, แผนงาน) */
export function briefKindOfTopic(topic: string): BriefKind | null {
  if (topic.includes("🏁")) return null;
  const t = topic.replace(/\s/g, "");
  if (/ตัดสินใจ|เสนอ|พิจารณา|อนุมัติ/.test(t)) return "ask";
  if (/ปัญหา|อุปสรรค|เสี่ยง/.test(t)) return "stuck";
  if (/ล่าช้า|ค้าง|ผิดแผน|ผิดพลาด|ไม่เป็นไปตามแผน/.test(t)) return "late";
  if (/ส่งงาน|ดำเนินการ|ทำงานอะไร|เสร็จ|ผลงาน/.test(t)) return "done";
  return null;
}

/** เนื้อหาที่แปลว่า "ไม่มีอะไร" — ไม่นำมาแสดง */
export function isNothing(text: string): boolean {
  const t = text.replace(/[\s\-–—•*.:]+/g, "");
  if (t === "" || /^(none|n\/a)$/i.test(t)) return true;
  // "ไม่มี", "ไม่มีครับ", "ไม่มีปัญหาเร่งด่วนที่กระทบต่อการทำงาน", "ยังไม่มีเรื่องเสนอ" … = ไม่มีอะไร
  // (ข้อความยาวที่ขึ้นต้นว่าไม่มีแต่เล่าเรื่องต่อ เช่น "ไม่มีช่างว่าง ต้องเลื่อนงาน…" ยาวเกิน 60 ตัว ยังนับ)
  return /^(ยัง)?ไม่มี/.test(t) && t.length <= 60;
}

export interface BriefItem {
  postId: string;
  userId: string;
  name: string;
  text: string;
  color: BriefColor;
}

export interface BriefPerson {
  postId: string;
  userId: string;
  name: string;
  oneLine: string;
  worst: BriefColor;
}

export interface BriefQa {
  at: string;
  q: string;
  a: string;
  costThb: number;
}

export interface BossBrief {
  /** `${day}|${topicId}|${roundId}` */
  id: string;
  topicId: string;
  topicName: string;
  roundId: string;
  roundLabel: string;
  roundTime: string;
  day: string;
  generatedAt: string;
  /** ลายเซ็นโพสต์ที่ใช้สรุป (id+เวลาแก้ไข) — เปลี่ยน = มีคนส่งช้า/แก้ไข ต้องสรุปใหม่ */
  signature: string;
  postCount: number;
  headline: string;
  people: BriefPerson[];
  items: Record<BriefKind, BriefItem[]>;
  qa: BriefQa[];
  model: string;
  costThb: number;
  /** AI ล้ม/เกินเพดาน — แสดงแบบไม่มีใจความย่อ (ใช้ข้อความจริงตัดสั้นแทน) */
  aiSkipped?: "cap" | "error";
}

export interface BossBriefSettings {
  enabled: boolean;
  topicIds: string[];
  /** เพดานค่าใช้จ่ายต่อเดือน (บาท) — ถึงแล้วหยุดเรียก AI แต่การ์ดยังนับประเภท/สีให้ */
  monthlyCapThb: number;
  summaryModel: string;
  askModel: string;
}

export const DEFAULT_BRIEF_SETTINGS: BossBriefSettings = {
  enabled: false,
  topicIds: [],
  monthlyCapThb: 300,
  summaryModel: "gpt-6-luna",
  askModel: "gpt-6-sol",
};

/** ราคาต่อ 1 ล้าน token (ดอลลาร์) จากหน้าราคา OpenAI 12/11/2569 — ใช้แสดง/คุมเพดานเท่านั้น บิลจริงดูที่ OpenAI */
export const MODEL_PRICES_USD: Record<string, { input: number; output: number; label: string }> = {
  "gpt-6-luna": { input: 0.1, output: 0.5, label: "gpt-6-luna (ประหยัด)" },
  "gpt-6.1-terra": { input: 1, output: 5, label: "gpt-6.1-terra (กลาง)" },
  "gpt-6-sol": { input: 2, output: 10, label: "gpt-6-sol (แม่นที่สุด)" },
};
export const THB_PER_USD = 36;

export interface BriefUsageMonth {
  thb: number;
  calls: number;
}

/** สิ่งที่ API ส่งให้การ์ด */
export interface BossBriefView {
  allowed: boolean;
  reason?: "not-boss" | "plan";
  settings: BossBriefSettings;
  /** ห้องนี้ตั้งหัวข้อบังคับไว้ในรอบไหนบ้าง — ไม่มี = เปิดสรุปไม่ได้ (ไม่รู้ว่าหัวข้อไหนคืออะไร) */
  roundsWithTopics: { id: string; label: string; time: string }[];
  briefs: BossBrief[];
  /** capThb = เพดานที่ใช้จริง (ที่ตั้ง ไม่เกินเพดานของแพ็กเกจ) · planMaxThb = สูงสุดที่แพ็กเกจให้ตั้งได้ */
  usage: { month: string; thb: number; calls: number; capThb: number; planMaxThb?: number };
  generating: boolean;
}
