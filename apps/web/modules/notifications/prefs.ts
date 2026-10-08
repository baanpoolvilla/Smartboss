/**
 * ตั้งค่าแจ้งเตือนรายคน — รายการหัวข้อ + ระดับ + ตัวจัดหมวด ใช้ร่วมกันทั้งเซิร์ฟเวอร์ (ตัดสินว่าจะเด้ง/ส่ง
 * Web Push/LINE ไหม) และหน้าจอ (กระดิ่ง + หน้าตั้งค่า) ไม่มี import ฝั่งใดฝั่งหนึ่ง
 *
 * ทำไมมี: เจ้าของบริษัท (CEO) ได้แจ้งเตือนแทบทุกเรื่องในบริษัท เด้งไม่หยุด ("ceo จะเห็นแจ้งเตือนหมดเลย
 * อยากให้เลือกได้ว่าอยากดูโมดูลไหน ยกเว้นแชทบังคับให้แจ้งเตือน") — เลือกระดับครั้งเดียว หรือเปิด/ปิด
 * ทีละโมดูล/หัวข้อเองได้
 *
 * ปิดหัวข้อไหน = ไม่เด้ง ไม่มีเสียง ไม่ส่งมือถือ/LINE และไม่ขึ้นในกระดิ่ง (แถวยังถูกเก็บตามปกติ
 * ตัวเลขแดงบนไอคอนโมดูลที่นับงานค้างก็ยังนับ — งานรออนุมัติต้องไม่เงียบหายเพราะปิดแจ้งเตือน)
 *
 * ความปลอดภัยของการตั้งค่า: อะไรที่จัดหมวดไม่ได้ (แจ้งเตือนชนิดใหม่ในอนาคต) = "other" แสดงเสมอ
 * และถ้าโหลดค่าตั้งไม่ได้ก็ถือว่า "เห็นทั้งหมด" — แจ้งเตือนต้องไม่หายเงียบ ๆ
 */

export type NotifLevel = "important" | "normal" | "all";

/** 1 = 🎯 เฉพาะที่สำคัญ · 2 = ⚖️ ปกติ · 3 = 👀 เห็นทั้งหมด — หัวข้อเปิดในระดับที่ ≥ ค่านี้ */
type Rank = 1 | 2 | 3;
const LEVEL_RANK: Record<NotifLevel, Rank> = { important: 1, normal: 2, all: 3 };

export const LEVELS: { id: NotifLevel; emoji: string; label: string; hint: string }[] = [
  { id: "important", emoji: "🎯", label: "เฉพาะที่สำคัญ", hint: "เรื่องที่ส่งถึงฉันตรง ๆ หรือรอฉันทำ" },
  { id: "normal", emoji: "⚖️", label: "ปกติ", hint: "เพิ่มความเคลื่อนไหวในงานของฉัน เตือนส่งรีพอต ลงเวลา ใบงานซ่อม" },
  { id: "all", emoji: "👀", label: "เห็นทั้งหมด", hint: "ทุกเรื่อง รวมโพสต์ใหม่ทุกห้องและรีแอ็กชัน" },
];

export interface NotifTopic {
  id: string;
  label: string;
  /** ใครได้ / เตือนเรื่องอะไร — บรรทัดเล็กใต้ชื่อ */
  hint: string;
  rank: Rank;
  /** เรื่องรออนุมัติ — ปิดแล้วขึ้นคำเตือนว่ายังเห็นงานค้างที่ไหน */
  approval?: string;
}

export interface NotifModuleDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  bg: string;
  /** บังคับเปิดเสมอ ปิดไม่ได้ */
  locked?: boolean;
  topics: NotifTopic[];
}

export const NOTIF_MODULES: NotifModuleDef[] = [
  {
    id: "pm", name: "Project Management", icon: "ClipboardList", color: "#64748b", bg: "#eef1f5",
    topics: [
      { id: "pm.assigned", label: "มอบหมายงานให้ฉัน", hint: "มีคนสั่งงานใหม่ หรือเพิ่มฉันเป็นผู้รับผิดชอบ", rank: 1 },
      { id: "pm.due_soon", label: "งานใกล้ถึงกำหนดส่ง", hint: "เตือนก่อนถึงกำหนด", rank: 1 },
      { id: "pm.review_request", label: "มีคนส่งงานรอฉันตรวจ", hint: "งานที่ฉันต้องตรวจ", rank: 1, approval: "ยังเห็นงานรอตรวจได้ในบอร์ดงาน คอลัมน์ “รอตรวจสอบ”" },
      { id: "pm.review_result", label: "ผลตรวจและคะแนนงานของฉัน", hint: "ผ่าน / ไม่ผ่าน / ส่งกลับให้แก้ / หักคะแนน", rank: 1 },
      { id: "pm.due_request", label: "ขอเลื่อน / เปลี่ยนกำหนดส่ง", hint: "คำขอเลื่อน ผลอนุมัติ และกำหนดส่งที่ถูกปรับ", rank: 1 },
      { id: "pm.mention", label: "แท็กฉันในงาน", hint: "มีคน @ ฉันในความคิดเห็นของงาน", rank: 1 },
      { id: "pm.meeting", label: "ประชุม", hint: "เชิญ แก้ เลื่อน ยกเลิก และเตือนก่อนเริ่ม", rank: 1 },
      { id: "pm.comment", label: "ความคิดเห็น / ไฟล์แนบในงานของฉัน", hint: "มีคนคอมเมนต์หรือแนบไฟล์ในงานที่ฉันอยู่", rank: 2 },
      { id: "pm.todo", label: "สิ่งที่ต้องทำใกล้ถึงเวลา", hint: "รายการสิ่งที่ต้องทำของฉัน", rank: 2 },
      { id: "pm.activity", label: "ความเคลื่อนไหวอื่นในงาน", hint: "เช็กลิสต์ สติกเกอร์ รีแอ็กชันในงาน", rank: 3 },
    ],
  },
  {
    id: "rp", name: "รีพอต", icon: "ScrollText", color: "#7c3aed", bg: "#f1ecfe",
    topics: [
      { id: "rp.mention", label: "แท็กฉัน / @ทุกคน", hint: "ในโพสต์หรือความคิดเห็น", rank: 1 },
      { id: "rp.reply", label: "ตอบกลับโพสต์ / ความคิดเห็นของฉัน", hint: "มีคนตอบในโพสต์ที่ฉันเขียนหรือคอมเมนต์ไว้", rank: 2 },
      { id: "rp.membership", label: "ห้องและรอบส่งของฉัน", hint: "เพิ่มฉันเข้าห้อง เพิ่ม/ถอดจากผู้ต้องส่ง รอบส่งเปลี่ยน", rank: 2 },
      { id: "rp.remind_me", label: "เตือนฉันส่งรีพอต", hint: "ยังไม่ได้ส่ง / ใกล้ถึงกำหนดส่ง", rank: 2 },
      { id: "rp.summary", label: "สรุปห้องที่ยังมีคนไม่ส่ง", hint: "สำหรับหัวหน้าและเจ้าของ", rank: 3 },
      { id: "rp.room_post", label: "โพสต์ใหม่ในห้อง", hint: "ทุกโพสต์ในห้องที่ฉันดูแล (เจ้าของบริษัทได้ทุกห้อง)", rank: 3 },
      { id: "rp.reaction", label: "รีแอ็กชัน (ถูกใจ)", hint: "มีคนกดอีโมจิให้โพสต์หรือความคิดเห็นของฉัน", rank: 3 },
    ],
  },
  {
    id: "hr", name: "ระบบบุคคล", icon: "Users", color: "#2563eb", bg: "#e8f0fe",
    topics: [
      { id: "hr.leave_pending", label: "คำขอลารอฉันอนุมัติ", hint: "สำหรับผู้อนุมัติ", rank: 1, approval: "ยังเห็นคำขอค้างในหน้าระบบบุคคล และตัวเลขแดงบนเมนู" },
      { id: "hr.correction_pending", label: "คำขอแก้เวลารอฉันอนุมัติ", hint: "สำหรับผู้อนุมัติ", rank: 1, approval: "ยังเห็นคำขอค้างในหน้าระบบบุคคล และตัวเลขแดงบนเมนู" },
      { id: "hr.ot_pending", label: "OT รอฉันอนุมัติ", hint: "สรุปวันละครั้ง", rank: 1, approval: "ยังเห็นคำขอค้างในหน้าระบบบุคคล และตัวเลขแดงบนเมนู" },
      { id: "hr.my_results", label: "ผลคำขอของฉัน", hint: "ลา / แก้เวลา / OT และลงเวลาที่ไม่ผ่านการตรวจ", rank: 1 },
      { id: "hr.late", label: "ฉันมาสาย", hint: "แจ้งทันทีที่ระบบนับว่าสาย", rank: 2 },
      { id: "hr.clock", label: "ลงเวลาเข้า-ออกของฉัน", hint: "ยืนยันทุกครั้งที่สแกนหรือกดลงเวลา", rank: 2 },
    ],
  },
  {
    id: "mt", name: "แจ้งซ่อมบำรุง", icon: "Wrench", color: "#0f766e", bg: "#e6f6f3",
    topics: [
      { id: "mt.po", label: "ใบสั่งซื้อ (PO)", hint: "รอฉันอนุมัติ / ได้รับมอบ / สถานะเปลี่ยน", rank: 1, approval: "ยังเห็น PO ค้างในหน้าใบสั่งซื้อ และตัวเลขแดงบนเมนู" },
      { id: "mt.work_order", label: "ใบงานซ่อม", hint: "มอบหมาย สถานะ ความคิดเห็น", rank: 2 },
      { id: "mt.pm", label: "แผนบำรุงรักษา (PM)", hint: "ใกล้ครบกำหนด / เลยกำหนด", rank: 2 },
      { id: "mt.expense", label: "ใบงานยังไม่บันทึกค่าใช้จ่าย", hint: "เตือนผู้ดูแล", rank: 3 },
    ],
  },
  {
    id: "bug", name: "แจ้งบัค", icon: "Bug", color: "#dc2626", bg: "#fdecec",
    topics: [{ id: "bug.all", label: "ตั๋วแจ้งบัค", hint: "ตั๋วใหม่ คำตอบ และสถานะของตั๋ว", rank: 2 }],
  },
  {
    id: "mk", name: "การตลาด", icon: "Megaphone", color: "#ea580c", bg: "#fff1e6",
    topics: [{ id: "mk.multipost", label: "ผลโพสต์ Multi Post", hint: "โพสต์ของฉันสำเร็จ / ไม่สำเร็จ", rank: 2 }],
  },
  {
    id: "chat", name: "แชท", icon: "MessageCircle", color: "#16a34a", bg: "#e9f8ee", locked: true,
    topics: [{ id: "chat.all", label: "ข้อความ แท็ก และตอบกลับ", hint: "ปิดเสียงทีละห้องได้ในแชท", rank: 1 }],
  },
  {
    id: "acc", name: "บัญชี", icon: "ShieldCheck", color: "#475569", bg: "#f1f3f6", locked: true,
    topics: [{ id: "acc.security", label: "ความปลอดภัยบัญชี", hint: "เช่น รหัสผ่านถูกเปลี่ยน", rank: 1 }],
  },
];

/** จัดหมวดไม่ได้ — แสดงเสมอ */
export const OTHER_TOPIC = "other";

const TOPIC_BY_ID = new Map<string, { topic: NotifTopic; module: NotifModuleDef }>(
  NOTIF_MODULES.flatMap((m) => m.topics.map((t) => [t.id, { topic: t, module: m }] as const))
);

export function topicInfo(topicId: string) {
  return TOPIC_BY_ID.get(topicId);
}

/* ─────────────────────────── ค่าตั้งของแต่ละคน ─────────────────────────── */

export interface NotifPrefs {
  level: NotifLevel;
  /** หัวข้อที่ผู้ใช้เปิด/ปิดเองต่างจากระดับ — มีอย่างน้อยหนึ่งอัน = "กำหนดเอง" */
  overrides: Record<string, boolean>;
  /** เวลาที่หัวข้อถูกเปิดกลับล่าสุด — แจ้งเตือนเก่ากว่านี้ไม่ขึ้นมาท่วมกระดิ่ง */
  since: Record<string, string>;
  /** ปิดแถบ "แจ้งเตือนเยอะไปไหม?" ไว้เมื่อไร */
  bannerDismissedAt: string | null;
}

/** ค่าเริ่มต้น = เหมือนก่อนมีหน้านี้ทุกอย่าง (ไม่มีอะไรเงียบลงเองหลัง deploy) */
export const DEFAULT_PREFS: NotifPrefs = { level: "all", overrides: {}, since: {}, bannerDismissedAt: null };

export function isTopicOn(prefs: NotifPrefs, topicId: string): boolean {
  const info = TOPIC_BY_ID.get(topicId);
  if (!info || info.module.locked) return true;
  const o = prefs.overrides[topicId];
  if (typeof o === "boolean") return o;
  return info.topic.rank <= LEVEL_RANK[prefs.level];
}

/** แจ้งเตือนอันนี้ควรขึ้นในกระดิ่งไหม (createdAt = ISO) */
export function isNotificationVisible(prefs: NotifPrefs, topicId: string, createdAt: string): boolean {
  if (!isTopicOn(prefs, topicId)) return false;
  const since = prefs.since[topicId];
  return !since || createdAt >= since;
}

export function isCustom(prefs: NotifPrefs): boolean {
  return Object.keys(prefs.overrides).length > 0;
}

/** เปลี่ยนค่าตั้ง แล้วจำเวลาที่หัวข้อไหน "ปิด → เปิด" (ของเก่าช่วงที่ปิดไว้ไม่ทะลักกลับมา) */
function withSince(before: NotifPrefs, after: NotifPrefs, now: string): NotifPrefs {
  const since = { ...after.since };
  for (const id of TOPIC_BY_ID.keys()) {
    if (!isTopicOn(before, id) && isTopicOn(after, id)) since[id] = now;
  }
  return { ...after, since };
}

export function applyLevel(prefs: NotifPrefs, level: NotifLevel, now = new Date().toISOString()): NotifPrefs {
  return withSince(prefs, { ...prefs, level, overrides: {} }, now);
}

/** เปิด/ปิดหลายหัวข้อพร้อมกัน (ทั้งโมดูล = ส่งทุกหัวข้อของโมดูล) — ค่าที่ตรงกับระดับอยู่แล้วไม่เก็บเป็น override */
export function setTopics(prefs: NotifPrefs, topicIds: string[], on: boolean, now = new Date().toISOString()): NotifPrefs {
  const overrides = { ...prefs.overrides };
  for (const id of topicIds) {
    const info = TOPIC_BY_ID.get(id);
    if (!info || info.module.locked) continue;
    const byLevel = info.topic.rank <= LEVEL_RANK[prefs.level];
    if (on === byLevel) delete overrides[id];
    else overrides[id] = on;
  }
  return withSince(prefs, { ...prefs, overrides }, now);
}

/** ตรวจ/ทำความสะอาดค่าที่มาจาก client หรือฐานข้อมูล — อะไรผิดรูปถือเป็นค่าเริ่มต้น */
export function normalizePrefs(raw: unknown): NotifPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFS };
  const r = raw as Record<string, unknown>;
  const level: NotifLevel = r.level === "important" || r.level === "normal" || r.level === "all" ? r.level : "all";
  const overrides: Record<string, boolean> = {};
  if (r.overrides && typeof r.overrides === "object") {
    for (const [k, v] of Object.entries(r.overrides as Record<string, unknown>)) {
      if (typeof v === "boolean" && TOPIC_BY_ID.has(k) && !TOPIC_BY_ID.get(k)!.module.locked) overrides[k] = v;
    }
  }
  const since: Record<string, string> = {};
  if (r.since && typeof r.since === "object") {
    for (const [k, v] of Object.entries(r.since as Record<string, unknown>)) {
      if (typeof v === "string" && TOPIC_BY_ID.has(k) && !Number.isNaN(Date.parse(v))) since[k] = v;
    }
  }
  const b = r.bannerDismissedAt;
  return { level, overrides, since, bannerDismissedAt: typeof b === "string" && !Number.isNaN(Date.parse(b)) ? b : null };
}

/* ─────────────────────────── จัดหมวด ─────────────────────────── */

/** แจ้งเตือนใน core.notifications (ระบบบุคคล / ซ่อมบำรุง / แจ้งบัค / แชท / บัญชี …) — จัดจาก `type` */
export function topicForCoreType(type: string): string {
  switch (type) {
    case "work_order": return "mt.work_order";
    case "purchase_order": return "mt.po";
    case "pm": return "mt.pm";
    case "expense": return "mt.expense";
    case "hr_leave_submitted": return "hr.leave_pending";
    case "hr_attendance_correction_submitted": return "hr.correction_pending";
    case "hr_overtime_pending": return "hr.ot_pending";
    case "hr_leave_decided":
    case "hr_attendance_correction_decided":
    case "hr_overtime_decided": return "hr.my_results";
    case "hr_late_self":
    case "hr_late_team": return "hr.late";
    case "hr_clock_event": return "hr.clock";
    case "multipost": return "mk.multipost";
    case "account_security": return "acc.security";
  }
  if (type.startsWith("issue_ticket")) return "bug.all";
  if (type.startsWith("chat_")) return "chat.all";
  return OTHER_TOPIC;
}

/**
 * แจ้งเตือนของ Project Management / รีพอต / แจ้งปัญหา (เก็บใน store ของ report_task) — ส่วนใหญ่ไม่มี
 * ชนิดติดมา ต้องจัดจากข้อความ ข้อความมาจากแม่แบบตายตัวในโค้ด (ดู __tests__/prefs.test.ts ที่ไล่ครบทุกแบบ)
 * ลำดับสำคัญ: กฎที่เจาะจงกว่าต้องมาก่อน (เช่น "รีพอต…ใกล้ถึงกำหนดส่ง" ก่อน "งาน…ใกล้ถึงกำหนดส่ง")
 */
export function topicForReportNotification(n: { message: string; kind?: string | null }): string {
  const m = n.message ?? "";
  if (n.kind === "room_post" || /โพสต์ใหม่ใน\s*"/.test(m)) return "rp.room_post";
  if (n.kind === "task_assigned") return "pm.assigned";
  if (n.kind === "task_due_request") return "pm.due_request";
  if (n.kind === "task_comment" || n.kind === "task_attachment") return "pm.comment";
  if (n.kind === "sticker_settings") return "pm.activity";

  if (m.includes("ตั๋ว") || m.includes("แจ้งปัญหา")) return "bug.all";
  if (m.includes("ประชุม")) return "pm.meeting";
  if (m.startsWith("สิ่งที่ต้องทำ")) return "pm.todo";

  // รีพอต: สรุปของหัวหน้า (ขึ้นต้น ห้อง "…" แล้วบอกจำนวนคน) ก่อนเตือนรายคน
  if (/^ห้อง\s*"/.test(m) && (m.includes("ไม่ได้ส่งรีพอต") || m.includes("คนต้องส่ง"))) return "rp.summary";
  if (m.includes("ยังไม่ได้ส่งรีพอต") || m.includes("ยังไม่ส่งรายงาน") || /^รีพอต.*ใกล้ถึงกำหนดส่ง/.test(m)) return "rp.remind_me";
  if (m.includes("รอบส่ง") || m.includes("ผู้ต้องส่งรอบ") || m.includes("เพิ่มคุณเข้าห้อง")) return "rp.membership";

  if (m.includes("แท็กคุณในงาน")) return "pm.mention";
  if (m.includes("แท็ก")) return "rp.mention";
  if (m.includes("ทำเครื่องหมาย") && (m.includes("ให้โพสต์") || m.includes("ให้ความคิดเห็น"))) return "rp.reaction";
  if (m.includes("ตอบกลับ")) return "rp.reply";

  if (m.includes("ตรวจงาน") || m.includes("กลับให้แก้ไข") || m.includes("หักคะแนน")) return "pm.review_result";
  if (m.includes("รอคุณตรวจ")) return "pm.review_request";
  if (m.includes("เลื่อนกำหนดส่ง") || m.includes("ปรับกำหนดส่ง")) return "pm.due_request";
  if (m.includes("ใกล้ถึงกำหนดส่ง")) return "pm.due_soon";
  if (m.includes("มอบหมายงาน")) return "pm.assigned";
  if (m.includes("แสดงความคิดเห็นในงาน") || m.includes("แนบไฟล์")) return "pm.comment";
  if (m.includes("งาน") || m.includes("เช็คลิสต์") || m.includes("คะแนน")) return "pm.activity";
  return OTHER_TOPIC;
}
