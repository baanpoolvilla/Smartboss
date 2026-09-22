import { effectiveRoundsOf } from "@/modules/report_task/lib/submission-rounds";
import type { ReportTopic } from "@/modules/report_task/store/report-feed-store";

export type ReportFrequency = "daily" | "weekly" | "monthly";

/**
 * "ห้องนี้เป็นห้องรายงานประเภทไหน" — ตัดสินจาก "รอบส่งจริง" ของห้อง
 * (effectiveRoundsOf ครอบคลุมทั้งห้องใหม่ที่มี submissionRounds และห้องเก่าที่
 * ยังมีแค่ cutoffs) ไม่ใช่เดาจากชื่อห้อง เพราะชื่อห้องแก้ได้อิสระ ไม่ผูกกับ
 * พฤติกรรมจริง — ห้องแผนกที่ถูกเปลี่ยนชื่อ หรือห้องแผนกใหม่ที่เพิ่งสร้าง ก็ยัง
 * ถูกจัดหมวดถูกเองโดยไม่ต้องมาไล่แก้รายชื่อห้องแบบ hardcode (ข้อมูลไม่ตกหล่น)
 *
 * กติกา (ข้อแรกที่ตรงชนะ):
 *  1. มีรอบไหนตั้ง dayOfMonth (รอบรายเดือน) -> "monthly"
 *  2. มีรอบไหนจำกัดวันในสัปดาห์ (weekdays 1-6 วัน ไม่ใช่ทุกวัน) -> "weekly"
 *  3. อย่างอื่น (ทุกวัน/ไม่ได้ตั้งวันเลย) -> "daily"
 * ห้องที่ไม่มีรอบส่งเลย (ห้องแชททั่วไป หรือห้องรวมที่ยังไม่ได้ตั้งรอบ) -> null
 */
export function topicReportFrequency(topic: ReportTopic): ReportFrequency | null {
  const rounds = effectiveRoundsOf(topic);
  if (rounds.length === 0) return null;
  if (rounds.some((r) => r.dayOfMonth != null)) return "monthly";
  if (rounds.some((r) => (r.weekdays?.length ?? 0) > 0 && (r.weekdays?.length ?? 0) < 7)) return "weekly";
  return "daily";
}

/**
 * ห้อง "รวม" ที่ผู้ใช้สร้างไว้เองใต้หมวด Report — ชื่อห้องตรง ๆ ว่า
 * "Daily-report" / "Weekly-report" / "Monthly-report" (ไม่มีท้ายชื่อเป็นแผนก
 * แบบ daily-report-hk) เปิดห้องพวกนี้แล้วจะเห็นโพสต์ของห้องแผนกทุกห้องที่เป็น
 * ประเภทเดียวกัน ไหลมารวมเรียงตามเวลาโพสต์ (สรุปงาน-รวมห้องรายงาน 2026-09-22)
 *
 * จงใจตัดสินจาก "ชื่อห้อง" ที่ผู้ใช้ตั้งเอง ไม่ใช่ id/ฟิลด์พิเศษ เพราะห้องพวกนี้
 * ถูกสร้างผ่านปุ่ม "+ หัวข้อใหม่" ตามปกติ ไม่ได้มีอะไรพิเศษในข้อมูลให้จับ —
 * เปลี่ยนชื่อห้องเมื่อไหร่ก็เลิกรวมเมื่อนั้น ซึ่งเป็นพฤติกรรมที่เดาได้ตรงไปตรงมา
 */
export function mergedReportRoomFrequency(topic: Pick<ReportTopic, "name">): ReportFrequency | null {
  const name = topic.name.trim().toLowerCase();
  if (name === "daily-report") return "daily";
  if (name === "weekly-report") return "weekly";
  if (name === "monthly-report") return "monthly";
  return null;
}
