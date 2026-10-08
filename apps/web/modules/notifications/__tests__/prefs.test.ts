import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PREFS,
  NOTIF_MODULES,
  OTHER_TOPIC,
  applyLevel,
  isCustom,
  isNotificationVisible,
  isTopicOn,
  normalizePrefs,
  setTopics,
  topicForCoreType,
  topicForReportNotification,
  topicInfo,
} from "../prefs";

// ข้อความจริงจากแม่แบบในโค้ด (task-store, report-feed-store, calendar, issue-report-store,
// reminder-sweep, submission-round-notify, report-feed-pending-today-card) — เพิ่มแม่แบบใหม่ต้องเพิ่มที่นี่ด้วย
const REPORT_CASES: [string, string, string?][] = [
  // Project Management
  ['กาย มอบหมายงาน "ติดตั้งแอร์" ให้คุณ', "pm.assigned"],
  ['กาย มอบหมายงาน "ติดตั้งแอร์" ให้คุณ', "pm.assigned", "task_assigned"],
  ['งาน "ติดตั้งแอร์" ใกล้ถึงกำหนดส่งใน 3 ชม.', "pm.due_soon"],
  ['งาน "ติดตั้งแอร์" ใกล้ถึงกำหนดส่ง', "pm.due_soon"],
  ['กาย ส่งงาน "ติดตั้งแอร์" แล้ว รอคุณตรวจ', "pm.review_request"],
  ['กาย ส่งงาน "ติดตั้งแอร์" แล้ว รอคุณตรวจ (ส่งช้า 2 วัน)', "pm.review_request"],
  ['หัวหน้า ตรวจงาน "ติดตั้งแอร์" แล้วผ่าน', "pm.review_result"],
  ['หัวหน้า ตรวจงาน "ติดตั้งแอร์" แล้วไม่ผ่าน — รูปไม่ชัด (เลื่อนกำหนดส่ง)', "pm.review_result"],
  ['กาย ส่งงาน "ติดตั้งแอร์" (ส่วนของคุณ) กลับให้แก้ไข — กำหนดส่งใหม่ 10 ต.ค.', "pm.review_result"],
  ['กาย ส่งงาน "ติดตั้งแอร์" กลับให้แก้ไข — กำหนดส่งใหม่ 10 ต.ค.', "pm.review_result"],
  ['กาย ขอเลื่อนกำหนดส่งงาน "ติดตั้งแอร์" จาก 8 ต.ค. เป็น 10 ต.ค.', "pm.due_request", "task_due_request"],
  ['กาย ขอเลื่อนกำหนดส่งงาน "ติดตั้งแอร์" จาก 8 ต.ค. เป็น 10 ต.ค.', "pm.due_request"],
  ['หัวหน้า อนุมัติให้เลื่อนกำหนดส่งงาน "ติดตั้งแอร์" เป็น 10 ต.ค.', "pm.due_request"],
  ['หัวหน้า ไม่อนุมัติการเลื่อนกำหนดส่งงาน "ติดตั้งแอร์"', "pm.due_request"],
  ['กาย ปรับกำหนดส่งงาน "ติดตั้งแอร์" เป็น 10 ต.ค.', "pm.due_request"],
  ['กาย ปรับกำหนดส่งของคุณในงาน "ติดตั้งแอร์" เป็น 10 ต.ค.', "pm.due_request"],
  ['กาย แท็กคุณในงาน "ติดตั้งแอร์": ดูรูปนี้หน่อย', "pm.mention"],
  ['กาย แสดงความคิดเห็นในงาน "ติดตั้งแอร์": โอเค', "pm.comment", "task_comment"],
  ['กาย แสดงความคิดเห็นในงาน "ติดตั้งแอร์": โอเค', "pm.comment"],
  ['กาย แนบไฟล์ "a.pdf" ในงาน "ติดตั้งแอร์"', "pm.comment", "task_attachment"],
  ['กาย ทำ "ถ่ายรูป" ในเช็คลิสต์ของ "ติดตั้งแอร์" เสร็จแล้ว', "pm.activity"],
  ['กาย ติดสติกเกอร์ "🔥 ด่วน" ให้งาน "ติดตั้งแอร์"', "pm.activity"],
  ['กาย ส่ง 👍 ให้งาน "ติดตั้งแอร์"', "pm.activity"],
  ['กาย หักคะแนน "ติดตั้งแอร์" −5 คะแนน (ส่งช้า)', "pm.review_result"],
  ['กาย ยกเลิกการหักคะแนน "ติดตั้งแอร์"', "pm.review_result"],
  ['กาย ยกเลิกการหักคะแนนอัตโนมัติของ "ติดตั้งแอร์" — เหตุผล: ลูกค้าเลื่อน', "pm.review_result"],
  ['สิ่งที่ต้องทำ "โทรหาลูกค้า" ใกล้ถึงเวลาแล้ว', "pm.todo"],
  ['ประชุม "ประชุมเช้า" เริ่มในอีก 15 นาที', "pm.meeting"],
  ['กาย แท็กคุณในประชุม "ประชุมเช้า"', "pm.meeting"],
  ['แท็กคุณในประชุม "ประชุมเช้า"', "pm.meeting"],
  ['กาย นำคุณออกจากประชุม "ประชุมเช้า"', "pm.meeting"],
  ['กาย แก้ไขประชุม "ประชุมเช้า" — 9 ต.ค. 09:00', "pm.meeting"],
  ['ผู้จัด เลื่อนประชุม "ประชุมเช้า" เป็น 9 ต.ค. 10:00', "pm.meeting"],
  ['ผู้จัด ยกเลิกประชุม "ประชุมเช้า" (9 ต.ค. 09:00)', "pm.meeting"],
  // รีพอต
  ['กาย โพสต์ใหม่ใน "ฝ่ายขาย": ยอดวันนี้', "rp.room_post", "room_post"],
  ['กาย โพสต์ใหม่ใน "ฝ่ายขาย": ยอดวันนี้', "rp.room_post"],
  ['กาย แท็กคุณในโพสต์ "ยอดวันนี้"', "rp.mention"],
  ['กาย แท็ก @ทุกคน ในโพสต์ "ยอดวันนี้"', "rp.mention"],
  ['กาย แท็กคุณในความคิดเห็นของโพสต์ "ยอดวันนี้"', "rp.mention"],
  ['กาย แท็ก @ทุกคน ในความคิดเห็นของโพสต์ "ยอดวันนี้"', "rp.mention"],
  ['กาย ตอบกลับโพสต์ของคุณ "ยอดวันนี้": ดีมาก', "rp.reply"],
  ['กาย ตอบกลับความคิดเห็นของคุณใน "ยอดวันนี้"', "rp.reply"],
  ['กาย ตอบกลับในโพสต์ที่คุณแสดงความคิดเห็น "ยอดวันนี้"', "rp.reply"],
  ['กาย ทำเครื่องหมาย ❤️ ให้โพสต์ของคุณ "ยอดวันนี้"', "rp.reaction"],
  ['กาย ทำเครื่องหมาย ❤️ ให้ความคิดเห็นของคุณใน "ยอดวันนี้"', "rp.reaction"],
  ['กาย เพิ่มคุณเข้าห้อง Report "ฝ่ายขาย"', "rp.membership"],
  ['มีรอบส่งใหม่ "รอบเช้า" ในห้อง "ฝ่ายขาย" — ต้องส่งก่อน 10:00', "rp.membership"],
  ['คุณถูกเพิ่มเป็นผู้ต้องส่งรอบ "รอบเช้า" ในห้อง "ฝ่ายขาย"', "rp.membership"],
  ['คุณถูกถอดออกจากผู้ต้องส่งรอบ "รอบเช้า" ในห้อง "ฝ่ายขาย"', "rp.membership"],
  ['รอบส่ง "รอบเช้า" ในห้อง "ฝ่ายขาย" ถูกยกเลิกแล้ว — ไม่ต้องส่ง', "rp.membership"],
  ['รอบส่ง "รอบเช้า" ในห้อง "ฝ่ายขาย" เปลี่ยนกำหนดใหม่ เป็น 11:00', "rp.membership"],
  ['ยังไม่ได้ส่งรีพอตรอบเช้า ห้อง "ฝ่ายขาย" วันนี้ ใกล้ถึงรอบตัดยอดแล้ว', "rp.remind_me"],
  ['รีพอตรายสัปดาห์ ห้อง "ฝ่ายขาย" ใกล้ถึงกำหนดส่งในอีก 2 วัน (2026-10-10)', "rp.remind_me"],
  ['คุณยังไม่ส่งรายงาน "ฝ่ายขาย" วันนี้', "rp.remind_me"],
  ['ห้อง "ฝ่ายขาย" ยังมี 3 คนไม่ได้ส่งรีพอตรอบเช้าวันนี้ ใกล้ถึงรอบตัดยอดแล้ว', "rp.summary"],
  ['ห้อง "ฝ่ายขาย" มีรีพอตรายสัปดาห์ถึงกำหนดส่งในอีก 2 วัน (2026-10-10) — 5 คนต้องส่ง', "rp.summary"],
  // แจ้งปัญหา (store ของ report_task)
  ["กาย แจ้งปัญหาใหม่ (T-12): หน้าจอค้าง", "bug.all"],
  ["ผู้แจ้งตอบกลับตั๋ว T-12: หน้าจอค้าง", "bug.all"],
  ["มีการตอบกลับใหม่ในตั๋ว T-12: หน้าจอค้าง", "bug.all"],
  ['ตั๋ว T-12 "หน้าจอค้าง" เปลี่ยนเป็น "กำลังแก้"', "bug.all"],
  ["คุณถูกมอบหมายตั๋ว T-12: หน้าจอค้าง", "bug.all"],
  ["ตั๋ว T-12 ถูกปิดแทนคุณ — ยืนยันว่าใช้ได้แล้ว", "bug.all"],
];

test("จัดหมวดแจ้งเตือนของ Project Management / รีพอต ครบทุกแม่แบบ", () => {
  for (const [message, expected, kind] of REPORT_CASES) {
    assert.equal(topicForReportNotification({ message, kind }), expected, `${message} (kind=${kind ?? "-"})`);
  }
});

test("ข้อความที่ไม่รู้จัก = other (แสดงเสมอ)", () => {
  assert.equal(topicForReportNotification({ message: "อะไรสักอย่างที่ไม่เคยมี" }), OTHER_TOPIC);
  assert.equal(topicForCoreType("brand_new_type"), OTHER_TOPIC);
});

test("จัดหมวดแจ้งเตือนฝั่ง core ตาม type", () => {
  const cases: [string, string][] = [
    ["work_order", "mt.work_order"], ["purchase_order", "mt.po"], ["pm", "mt.pm"], ["expense", "mt.expense"],
    ["hr_leave_submitted", "hr.leave_pending"], ["hr_attendance_correction_submitted", "hr.correction_pending"],
    ["hr_overtime_pending", "hr.ot_pending"], ["hr_leave_decided", "hr.my_results"],
    ["hr_attendance_correction_decided", "hr.my_results"], ["hr_overtime_decided", "hr.my_results"],
    ["hr_late_self", "hr.late"], ["hr_clock_event", "hr.clock"],
    ["issue_ticket_new", "bug.all"], ["issue_ticket_reply_reporter", "bug.all"], ["issue_ticket_status_reporter", "bug.all"],
    ["multipost", "mk.multipost"], ["chat_mention", "chat.all"], ["chat_message", "chat.all"], ["chat_note_comment", "chat.all"],
    ["account_security", "acc.security"],
  ];
  for (const [type, expected] of cases) assert.equal(topicForCoreType(type), expected, type);
});

test("ทุกหัวข้อที่ตัวจัดหมวดคืนมีอยู่ในรายการจริง", () => {
  for (const [message, , kind] of REPORT_CASES) assert.ok(topicInfo(topicForReportNotification({ message, kind })), message);
});

test("ค่าเริ่มต้น = เห็นทุกอย่าง (หลัง deploy ไม่มีอะไรเงียบลงเอง)", () => {
  for (const m of NOTIF_MODULES) for (const t of m.topics) assert.equal(isTopicOn(DEFAULT_PREFS, t.id), true, t.id);
});

test("ระดับ: สำคัญ ⊂ ปกติ ⊂ ทั้งหมด", () => {
  const important = applyLevel(DEFAULT_PREFS, "important");
  const normal = applyLevel(DEFAULT_PREFS, "normal");
  assert.equal(isTopicOn(important, "pm.assigned"), true);
  assert.equal(isTopicOn(important, "pm.comment"), false);
  assert.equal(isTopicOn(normal, "pm.comment"), true);
  assert.equal(isTopicOn(normal, "rp.room_post"), false);
  for (const m of NOTIF_MODULES) for (const t of m.topics) {
    if (isTopicOn(important, t.id)) assert.equal(isTopicOn(normal, t.id), true, t.id);
  }
});

test("แชทกับความปลอดภัยบัญชีปิดไม่ได้", () => {
  const off = setTopics(applyLevel(DEFAULT_PREFS, "important"), ["chat.all", "acc.security"], false);
  assert.equal(isTopicOn(off, "chat.all"), true);
  assert.equal(isTopicOn(off, "acc.security"), true);
  assert.deepEqual(normalizePrefs({ overrides: { "chat.all": false } }).overrides, {});
});

test("ปิดเอง = กำหนดเอง · ค่าที่ตรงกับระดับไม่ถูกเก็บเป็น override", () => {
  const p = setTopics(DEFAULT_PREFS, ["rp.room_post"], false);
  assert.equal(isCustom(p), true);
  const back = setTopics(p, ["rp.room_post"], true);
  assert.equal(isCustom(back), false);
});

test("เปิดกลับแล้วของเก่าช่วงที่ปิดไม่ทะลักกลับมา", () => {
  const off = applyLevel(DEFAULT_PREFS, "important", "2026-10-01T00:00:00.000Z");
  assert.equal(isNotificationVisible(off, "rp.room_post", "2026-10-02T00:00:00.000Z"), false);
  const on = applyLevel(off, "all", "2026-10-05T00:00:00.000Z");
  assert.equal(isNotificationVisible(on, "rp.room_post", "2026-10-02T00:00:00.000Z"), false);
  assert.equal(isNotificationVisible(on, "rp.room_post", "2026-10-06T00:00:00.000Z"), true);
  // หัวข้อที่ไม่เคยปิด ของเก่ายังเห็นตามเดิม
  assert.equal(isNotificationVisible(on, "pm.assigned", "2026-09-01T00:00:00.000Z"), true);
});

test("ค่าผิดรูปจาก client/ฐานข้อมูล = ค่าเริ่มต้น", () => {
  assert.deepEqual(normalizePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(normalizePrefs({ level: "loud", overrides: { "pm.x": true, "pm.assigned": "yes" } }), DEFAULT_PREFS);
});
