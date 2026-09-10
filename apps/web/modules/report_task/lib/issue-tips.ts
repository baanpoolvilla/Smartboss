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
 *
 * Split single-person vs multi-person per bucket — advice about making
 * something "ทีมเห็นร่วมกัน"/spreading visibility reads oddly pointed at
 * exactly one repeat offender ("อยากได้คำแนะนำที่มีประสิทธิภาพ" — a tip that
 * doesn't fit the actual headcount isn't useful, no matter how sound the
 * advice is in the abstract). One person gets advice aimed at that one
 * relationship (ask what's actually blocking them, escalate if it's a
 * repeat pattern); more than one gets advice aimed at the group dynamic
 * (shared visibility, a structural fix, reassigning).
 */
const ISSUE_TIPS = {
  taskOverdue: {
    single: [
      "คุยตรงๆ ว่าติดอะไรอยู่ บางทีปัญหาจริงไม่ใช่แค่ผัดวันประกันพรุ่ง",
      "ถ้าเป็นคนเดิมพลาดซ้ำ อาจต้องดูภาระงานรวมของเขาจริงจัง ไม่ใช่แค่เตือนซ้ำไปเรื่อยๆ",
      "ลองมอบต่อให้คนอื่นที่มีคิวว่างกว่า ถ้างานนี้ไม่จำเป็นต้องเป็นคนนี้ทำ",
    ],
    multiple: [
      "มอบหมายต่อให้คนที่มีคิวว่างและทักษะตรงกับงานนั้นจริงๆ ไม่ใช่ใครก็ได้ที่ว่าง",
      "ทบทวนงานค้างเป็นประจำทุกสัปดาห์ ดูว่าอะไรติดขัดก่อนจะกองสะสมนานขึ้น",
      "จัดลำดับความสำคัญใหม่ตามผลกระทบจริง ไม่ใช่เรียงตามที่ค้างนานสุดเสมอไป",
    ],
  },
  reportOverdue: {
    single: [
      "ทักไปถามตรงๆ ว่าติดขัดตรงไหน บางทีปัญหาจริงไม่ใช่แค่ลืมส่ง",
      "ถ้าเป็นคนเดิมพลาดซ้ำหลายครั้ง อาจต้องคุยเรื่องภาระงาน ไม่ใช่แค่เตือนซ้ำอีกรอบ",
      "ส่งลิงก์ส่งตรงพร้อมเหตุผลว่าทำไมรายงานนี้สำคัญ ให้เขาส่งได้เร็วที่สุด",
    ],
    multiple: [
      "เปลี่ยนจากเตือนแบบส่วนตัวเป็นให้ทั้งทีมเห็น จะได้ช่วยกันดันแทนที่จะรอคนเดียว",
      "เช็คว่าเป็นรอบเวลาเดียวกันหรือเปล่า ถ้าใช่อาจต้องปรับเวลารอบให้เหมาะขึ้น",
      "ประกาศให้เห็นทั้งทีมว่าใครยังไม่ส่งบ้าง ความโปร่งใสมักกระตุ้นได้ดีกว่าการเตือนแอบๆ",
    ],
  },
  taskPending: {
    single: [
      "เตือนก่อนถึงกำหนดพร้อมบอกว่าทำไมงานนี้สำคัญ ไม่ใช่แค่แจ้งวันที่เฉยๆ",
      "ถามล่วงหน้าว่าจะทันไหม ให้มีเวลาขอความช่วยเหลือก่อนจะเลยกำหนดจริง",
    ],
    multiple: [
      "ให้เพื่อนร่วมทีมช่วยเช็คความคืบหน้ากันเอง ไม่ต้องรอหัวหน้าถามอย่างเดียว",
      "ใช้บอร์ดที่ทุกคนเห็นร่วมกัน งานที่มองเห็นได้ทั่วถึงมักไม่ถูกลืม",
    ],
  },
  reportPending: {
    single: [
      "เตือนใกล้เวลาปิดรอบพร้อมลิงก์ส่งตรง ลดขั้นตอนที่ทำให้ลืม",
      "ถามล่วงหน้าว่ามีอะไรติดขัดไหม ก่อนจะกลายเป็นพลาดกำหนดจริง",
    ],
    multiple: [
      "บอกผลที่ตามมาให้ชัดตั้งแต่ต้น จะได้ไม่ต้องเดาว่าสำคัญแค่ไหน",
      "แชร์ตัวอย่างรายงานที่เคยส่งผ่าน ให้มีต้นแบบเริ่มต้นได้เร็วขึ้น",
    ],
  },
} as const;

export type IssueTipKey = keyof typeof ISSUE_TIPS;

/** `peopleCount` picks the single-vs-multiple pool — pass how many distinct
 * people are behind this issue, not the raw incident count (one person with
 * 3 late reports is still "single"). */
export function issueSuggestion(key: IssueTipKey, peopleCount: number): string {
  return pickDaily(ISSUE_TIPS[key][peopleCount <= 1 ? "single" : "multiple"]);
}
