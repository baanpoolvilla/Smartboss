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
 * Split along two axes so the advice actually fits the situation on screen,
 * not just "sounds reasonable in the abstract"
 * ("อยากได้คำแนะนำที่มีประสิทธิภาพ...ให้เข้าได้กับทุกสถานการณ์"):
 *
 *  - single vs multiple — how many *people* this issue is about. Advice
 *    about spreading visibility to "ทั้งทีม" reads oddly pointed at exactly
 *    one person; advice about a 1:1 conversation doesn't scale to naming a
 *    whole roster.
 *  - first vs repeat — whether the worst-affected person's own count is
 *    still 1 (this is the first time this has come up for anyone shown) or
 *    already 2+ (someone's missed the same thing more than once). A first
 *    miss usually has a one-off, situational cause worth just asking about;
 *    a repeat is a *pattern* — re-sending the same nudge that already
 *    failed once doesn't fix a pattern, so that tier's advice points at
 *    capacity, scheduling, or the deadline/round itself instead.
 */
type TipBucket = { first: readonly string[]; repeat: readonly string[] };
type SizeSplit = { single: TipBucket; multiple: TipBucket };
export type IssueTipKey = "taskOverdue" | "reportOverdue" | "taskPending" | "reportPending";

const ISSUE_TIPS: Record<IssueTipKey, SizeSplit> = {
  taskOverdue: {
    single: {
      first: [
        "คุยตรงๆ ว่าติดอะไรอยู่ ครั้งแรกมักมีเหตุผลเฉพาะหน้าที่แก้ได้เร็ว",
        "เตือนพร้อมเสนอความช่วยเหลือ ไม่ใช่แค่ทวงถาม อาจติดขัดจริงๆ อยู่",
      ],
      repeat: [
        "พลาดซ้ำกับคนเดิม ต้องดูภาระงานรวมของเขาจริงจัง ไม่ใช่แค่เตือนซ้ำไปเรื่อยๆ",
        "คุยตัวต่อตัวว่าเกิดอะไรขึ้นเป็นระบบ อาจต้องปรับวิธีมอบหมายงานให้เขาใหม่",
        "พิจารณาลดจำนวนงานที่มอบให้ ถ้าภาระเกินกำลังจริงๆ",
      ],
    },
    multiple: {
      first: [
        "มอบหมายต่อให้คนที่มีคิวว่างและทักษะตรงกับงานนั้นจริงๆ ไม่ใช่ใครก็ได้ที่ว่าง",
        "ทบทวนงานค้างเป็นประจำทุกสัปดาห์ ดูว่าอะไรติดขัดก่อนจะกองสะสมนานขึ้น",
      ],
      repeat: [
        "หลายคนพลาดซ้ำพร้อมกัน อาจเป็นปัญหาเชิงระบบ เช่น เดดไลน์ไม่สมเหตุสมผลหรือทรัพยากรไม่พอ",
        "จัดลำดับความสำคัญใหม่ทั้งทีมตามผลกระทบจริง ไม่ใช่ปล่อยให้ต่างคนต่างจัดการเอง",
        "ประชุมทบทวนภาระงานรวมของทีม อาจต้องกระจายงานใหม่ทั้งกระดาน",
      ],
    },
  },
  reportOverdue: {
    single: {
      first: [
        "ทักไปถามตรงๆ ว่าติดขัดตรงไหน บางทีปัญหาจริงไม่ใช่แค่ลืมส่ง",
        "ส่งลิงก์ส่งตรงพร้อมเหตุผลว่าทำไมรายงานนี้สำคัญ ให้เขาส่งได้เร็วที่สุด",
      ],
      repeat: [
        "พลาดซ้ำหลายครั้งแล้ว น่าจะคุยเรื่องภาระงานจริงจัง ไม่ใช่แค่เตือนซ้ำอีกรอบ",
        "ลองถามว่ารอบเวลาที่กำหนดเหมาะกับตารางงานเขาจริงไหม อาจต้องปรับให้เขาโดยเฉพาะ",
      ],
    },
    multiple: {
      first: [
        "เปลี่ยนจากเตือนแบบส่วนตัวเป็นให้ทั้งทีมเห็น จะได้ช่วยกันดันแทนที่จะรอคนเดียว",
        "เช็คว่าเป็นรอบเวลาเดียวกันหรือเปล่า ถ้าใช่อาจต้องปรับเวลารอบให้เหมาะขึ้น",
      ],
      repeat: [
        "หลายคนพลาดซ้ำรอบแล้วรอบเล่า น่าจะเป็นปัญหาที่ตัวรอบเอง ไม่ใช่ตัวคน ลองทบทวนเวลา/ความถี่ของรอบใหม่",
        "ประกาศให้เห็นทั้งทีมว่าใครยังไม่ส่งบ้างซ้ำๆ ความโปร่งใสมักกระตุ้นได้ดีกว่าการเตือนแอบๆ",
      ],
    },
  },
  taskPending: {
    single: {
      first: ["เตือนก่อนถึงกำหนดพร้อมบอกว่าทำไมงานนี้สำคัญ ไม่ใช่แค่แจ้งวันที่เฉยๆ"],
      repeat: ["ใกล้กำหนดบ่อยๆ ทุกรอบ อาจต้องเช็คว่าประเมินเวลาทำงานผิดตั้งแต่ต้นหรือเปล่า"],
    },
    multiple: {
      first: ["ให้เพื่อนร่วมทีมช่วยเช็คความคืบหน้ากันเอง ไม่ต้องรอหัวหน้าถามอย่างเดียว", "ใช้บอร์ดที่ทุกคนเห็นร่วมกัน งานที่มองเห็นได้ทั่วถึงมักไม่ถูกลืม"],
      repeat: ["หลายคนใกล้กำหนดพร้อมกันซ้ำๆ ลองดูว่าปริมาณงานที่มอบต่อรอบเหมาะสมไหม"],
    },
  },
  reportPending: {
    single: {
      first: ["เตือนใกล้เวลาปิดรอบพร้อมลิงก์ส่งตรง ลดขั้นตอนที่ทำให้ลืม"],
      repeat: ["ใกล้ปิดรอบทุกครั้ง อาจต้องถามว่าเวลาที่ตั้งไว้เหมาะกับตารางงานเขาจริงไหม"],
    },
    multiple: {
      first: ["บอกผลที่ตามมาให้ชัดตั้งแต่ต้น จะได้ไม่ต้องเดาว่าสำคัญแค่ไหน", "แชร์ตัวอย่างรายงานที่เคยส่งผ่าน ให้มีต้นแบบเริ่มต้นได้เร็วขึ้น"],
      repeat: ["หลายคนใกล้ปิดรอบซ้ำๆ ทุกรอบ ลองทบทวนว่าเวลาปิดรอบเหมาะกับจังหวะงานจริงของทีมไหม"],
    },
  },
};

/**
 * `peopleCount` picks single vs multiple — how many distinct people are
 * behind this issue. `worstCount` picks first vs repeat — the highest
 * per-person incident count among them (1 = nobody shown has hit this twice
 * yet; 2+ = at least one has). Pass the worst offender's own count, not the
 * bucket's grand total (a 5-person bucket where everyone's missed once
 * totals 5, but nobody's actually repeating — that's still "first").
 */
export function issueSuggestion(key: IssueTipKey, peopleCount: number, worstCount: number): string {
  const sizeTier = ISSUE_TIPS[key][peopleCount <= 1 ? "single" : "multiple"];
  return pickDaily(sizeTier[worstCount > 1 ? "repeat" : "first"]);
}
