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
  /** เครื่องมือค้นข้อมูลที่ AI ใช้ตอบ (ชื่อเครื่องมือใน company-ai.ts) — โชว์ "ค้นจาก: …" ใต้คำตอบ */
  sources?: string[];
}

/** ชื่อเครื่องมือค้นข้อมูล → คำที่ Boss อ่านเข้าใจ */
export const SOURCE_LABEL: Record<string, string> = {
  search_reports: "รายงาน",
  count_mentions: "นับจำนวนครั้ง",
  report_summaries: "สรุปรายรอบ",
  search_group_chat: "แชทกลุ่ม",
  tasks: "งาน",
  work_orders: "ใบแจ้งซ่อม",
  purchases_expenses: "สั่งซื้อ/ค่าใช้จ่าย",
  money_requests: "คำขอเงิน",
  attendance: "ลงเวลา",
  leave: "ใบลา",
  salary: "เงินเดือน",
  scores: "คะแนน",
  people: "รายชื่อพนักงาน",
  app_pages: "หน้าในระบบ",
};

/**
 * สรุปแบบละเอียด (13/11/2569 ผู้ใช้: "boss เข้ามาแล้วรู้ว่าคนนี้ทำอะไร กลุ่มไหนเป็นยังไง ติดอะไร รออะไรจากเรา อะไรด่วน/อันตราย")
 * อ่านตามลำดับ 1 ด่วน/อันตราย → 2 รอคุณตัดสินใจ → 3 ค้าง → 4 ทีม/คน · ทุกข้อชี้กลับโพสต์ต้นทาง
 * ไม่มี = สรุปรุ่นเก่า (ก่อน 13/11) หรือ AI ล้ม → การ์ดแสดงแบบเดิม
 */
export type BriefImpact = "เงิน" | "ลูกค้า" | "ความปลอดภัย" | "กฎหมาย" | "งานเดินไม่ได้";
export interface BriefDetail {
  /** plan = รอบเช้า (แผนงานวันนี้) · result = รอบเย็น (ผลงานวันนี้) · range = สรุปรวมหลายวัน (Boss กดสั่งเอง) */
  roundKind: "plan" | "result" | "range";
  /** รอบรายวัน / รายสัปดาห์ (ส่งวันเดียวในสัปดาห์) / รายเดือน (ตั้งวันที่) — ใช้บอกว่า "ผลงานของวันนี้/สัปดาห์นี้/เดือนนี้" */
  period?: "daily" | "weekly" | "monthly";
  urgent: { title: string; postId: string; name: string; impact: BriefImpact; why: string; level: "ด่วนมาก" | "ด่วน"; writerRed: boolean }[];
  decisions: { what: string; postId: string; name: string; since: string }[];
  /** result: ค้างมาหลายวัน (since = วันแรกที่เจอ) · plan: เมื่อวานยังค้าง แต่แผนเช้านี้ไม่มีใครพูดถึง */
  carry: { what: string; postId: string; name: string; since?: string }[];
  fixed: { what: string; name: string }[];
  teams: { team: string; color: BriefColor; line: string; names: string[] }[];
  /** รายละเอียดรายคน key = postId */
  people: Record<string, { team: string; color: BriefColor; did: string[]; stuck: string[]; waiting: { what: string; from: string }[]; next: string[] }>;
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
  detail?: BriefDetail;
  /** สรุปรวมหลายวัน: วันแรกของช่วง (day = วันสุดท้าย) · ไม่มี = สรุปรอบปกติ */
  rangeFrom?: string;
  /** แบบย่อ (รายการวัน) — ไม่มีรายละเอียด ต้องขอแบบเต็มก่อนแสดง */
  light?: boolean;
  /** เก่ากว่า 12 เดือน ระบบย่อเก็บแล้ว (เหลือภาพรวม/เรื่องที่ต้องรู้/บรรทัดต่อคน ไม่มีรายละเอียดรายคน) */
  compact?: boolean;
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
  /** สรุปละเอียด (ด่วน/รอคุณ/ค้าง/ทีม/รายคน) — ต้องตัดสินว่าอะไรอันตราย ใช้รุ่นแม่น · ค่าเดิมของบริษัทที่ไม่มีช่องนี้ = ค่าเริ่มต้น */
  detailModel: string;
  /** 2 = ตั้งค่าหลัง 13/11/2569 ที่เปลี่ยนรุ่นเริ่มต้นเป็น terra — ไม่มี/น้อยกว่า = ใช้รุ่นเริ่มต้นใหม่แทนค่าเก่าที่บันทึกไว้ */
  modelVersion?: number;
}

export const DEFAULT_BRIEF_SETTINGS: BossBriefSettings = {
  enabled: false,
  topicIds: [],
  monthlyCapThb: 300,
  summaryModel: "gpt-6-luna",
  // 13/11/2569 ผู้ใช้: "ทำไมราคาแพงจัง" — sol ฿1.3–2.4/รอบสรุป ฿0.9–2.1/คำถาม → terra ถูกราวครึ่ง คุณภาพยังดี (วัดจริง ฿0.33–0.45/คำถาม)
  askModel: "gpt-6.1-terra",
  detailModel: "gpt-6.1-terra",
  modelVersion: 2,
};

/** ประมาณการค่าต่อครั้งตามรุ่น (บาท) — ใช้กันไม่ให้เกินเพดาน: เหลือเงินไม่พอครั้งหนึ่ง = ไม่เรียก AI */
export function estimateThb(model: string, kind: "summary" | "ask"): number {
  const inPrice = MODEL_PRICES_USD[model]?.input ?? 2;
  const base = kind === "summary" ? 2.4 : 1.5; // ค่าสูงสุดที่เคยวัดได้ด้วย sol ($2/1M token ขาเข้า)
  return Math.max(0.05, (base * inPrice) / 2);
}

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
  /** รายการสรุปรอบ 60 วันล่าสุดแบบย่อ (light) — ใหม่สุดก่อน */
  briefs: BossBrief[];
  /** สรุปที่กำลังดูแบบเต็ม (ตาม ?briefId= หรืออันล่าสุด) */
  current?: BossBrief | null;
  /** capThb = เพดานที่ใช้จริง (ที่ตั้ง ไม่เกินเพดานของแพ็กเกจ) · planMaxThb = สูงสุดที่แพ็กเกจให้ตั้งได้ */
  usage: { month: string; thb: number; calls: number; capThb: number; planMaxThb?: number };
  generating: boolean;
  /** สรุปรวมหลายวันของห้องนี้ที่เคยสั่งไว้ (ใหม่สุดก่อน) — เปิดดูซ้ำได้ไม่เสียเงิน */
  ranges: BossBrief[];
  /** id ของสรุปรวมที่กำลังทำอยู่ / เพิ่งล้ม (`range|topic|from|to`) */
  rangePending: string[];
  rangeFailed: { id: string; error: string }[];
}
