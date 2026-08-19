import { pickDaily } from "@/modules/report_task/lib/utils";

/**
 * The Dashboard's "คำแนะนำ" copy — one shared source for the KPI card and
 * both Overview donuts, so all three read the exact same advice for the
 * same bucket instead of drifting (the donuts used to carry their own
 * generic overdue/pending pair, worded around reassigning *work*, which
 * doesn't fit when it's actually showing under the Report donut). Grounded
 * in actual workload-management/deadline-compliance practice (capacity-aware
 * reassignment, weekly backlog reviews, visible/shared tracking, reminders
 * that state *why* the deadline matters, asking what's actually blocking
 * someone instead of just re-nagging), plain rule-based copy — not
 * AI-generated. Rotated daily via `pickDaily` so it doesn't read as the
 * exact same static sentence on every single visit.
 */
const ISSUE_TIPS = {
  taskOverdue: [
    "มอบหมายต่อให้คนที่มีคิวว่างและทักษะตรงกับงานนั้นจริงๆ ไม่ใช่ใครก็ได้ที่ว่าง",
    "ทบทวนงานค้างเป็นประจำทุกสัปดาห์ ดูว่าอะไรติดขัดก่อนจะกองสะสมนานขึ้น",
    "จัดลำดับความสำคัญใหม่ตามผลกระทบจริง ไม่ใช่เรียงตามที่ค้างนานสุดเสมอไป",
  ],
  reportOverdue: [
    "ส่งเตือนพร้อมลิงก์ส่งตรงและเหตุผลว่าทำไมรายงานนี้สำคัญ ไม่ใช่แค่เตือนเฉยๆ",
    "เปลี่ยนจากเตือนแบบส่วนตัวเป็นให้ทั้งทีมเห็น จะได้ช่วยกันดันแทนที่จะรอคนเดียว",
    "ถามตรงๆ ว่าติดขัดตรงไหน บางทีปัญหาจริงไม่ใช่แค่ลืมส่ง",
  ],
  taskPending: [
    "ให้เพื่อนร่วมทีมช่วยเช็คความคืบหน้ากันเอง ไม่ต้องรอหัวหน้าถามอย่างเดียว",
    "ใช้บอร์ดที่ทุกคนเห็นร่วมกัน งานที่มองเห็นได้ทั่วถึงมักไม่ถูกลืม",
    "เตือนก่อนถึงกำหนดพร้อมบอกว่าทำไมงานนี้สำคัญ ไม่ใช่แค่แจ้งวันที่เฉยๆ",
  ],
  reportPending: [
    "เตือนใกล้เวลาปิดรอบพร้อมลิงก์ส่งตรง ลดขั้นตอนที่ทำให้ลืม",
    "บอกผลที่ตามมาให้ชัดตั้งแต่ต้น จะได้ไม่ต้องเดาว่าสำคัญแค่ไหน",
    "แชร์ตัวอย่างรายงานที่เคยส่งผ่าน ให้มีต้นแบบเริ่มต้นได้เร็วขึ้น",
  ],
} as const;

export type IssueTipKey = keyof typeof ISSUE_TIPS;

export function issueSuggestion(key: IssueTipKey): string {
  return pickDaily(ISSUE_TIPS[key]);
}
