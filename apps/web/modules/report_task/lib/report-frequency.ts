import { effectiveRoundsOf } from "@/modules/report_task/lib/submission-rounds";
import type { ReportTopic } from "@/modules/report_task/store/report-feed-store";

export type ReportFrequency = "daily" | "weekly" | "monthly";

/**
 * "ห้องนี้เป็นห้องรายงานประเภทไหน" — ใช้กับมุมมองรวม "Daily-report /
 * Weekly-report / Monthly-report" (สรุปงาน-รวมห้องรายงาน 2026-09-22) ที่ดึง
 * ทุกห้องของทุกแผนกที่ตรงประเภทมารวมเป็นฟีดเดียว (ดู topic-sidebar.tsx's
 * DAILY_ALL_ID/WEEKLY_ALL_ID/MONTHLY_ALL_ID และ report-feed/page.tsx)
 *
 * ตัดสินจาก "รอบส่งจริง" ของห้อง (effectiveRoundsOf — ครอบคลุมทั้งห้องใหม่ที่มี
 * submissionRounds และห้องเก่าที่ยังมีแค่ cutoffs) ไม่ใช่เดาจากชื่อห้อง
 * (daily-report-hk ฯลฯ) เพราะชื่อห้องแก้ไขได้อิสระ ไม่ผูกกับพฤติกรรมจริง —
 * ห้องที่ถูกเปลี่ยนชื่อ หรือห้องแผนกใหม่ที่ยังไม่รู้จักชื่อ ก็ยังถูกจัดหมวดถูกอยู่ดี
 * ไม่มีทางตกหล่นจาก mucking กับรายชื่อห้องแบบ hardcode
 *
 * กติกา (เรียงตามลำดับ, ข้อแรกที่ตรงชนะ):
 *  1. มีรอบไหนตั้ง dayOfMonth ไว้ (รอบรายเดือน) -> "monthly"
 *  2. มีรอบไหนจำกัดวันในสัปดาห์ (weekdays 1-6 วัน, ไม่ใช่ทุกวัน) -> "weekly"
 *  3. อย่างอื่นทั้งหมด (ทุกวัน หรือไม่ได้ตั้งวันเลย) -> "daily"
 * ห้องที่ไม่มีรอบส่งเลย (ห้องแชททั่วไป ไม่ใช่ห้องรายงาน) -> null
 */
export function topicReportFrequency(topic: ReportTopic): ReportFrequency | null {
  const rounds = effectiveRoundsOf(topic);
  if (rounds.length === 0) return null;
  if (rounds.some((r) => r.dayOfMonth != null)) return "monthly";
  if (rounds.some((r) => (r.weekdays?.length ?? 0) > 0 && (r.weekdays?.length ?? 0) < 7)) return "weekly";
  return "daily";
}

/**
 * ป้ายรอบแบบง่าย "เช้า"/"เย็น" เฉพาะตอนแสดงผลใน "Daily-report รวม" เท่านั้น —
 * เดาจากเวลาปิดรอบ (ก่อนเที่ยง = เช้า, หลังเที่ยง = เย็น) แทนที่จะโชว์ label
 * เดิมที่แต่ละห้องตั้งเอง (เช่น "Daily-report-Morning") ซึ่งยาวและซ้ำซ้อนเมื่อ
 * มาปนกันจากหลายห้อง — ทำสำเนา topic ไว้ใช้เฉพาะตอนส่งเข้า ReportCard ของ
 * มุมมองรวมนี้เท่านั้น ไม่ได้แก้ label จริงที่บันทึกไว้ของห้อง ห้องเดี่ยว ๆ
 * (เปิดจากไซด์บาร์ตามปกติ) ยังเห็น label เดิมที่ตั้งไว้ไม่เปลี่ยนแปลง
 */
export function withSimplifiedDailyRoundLabels(topic: ReportTopic): ReportTopic {
  const rounds = effectiveRoundsOf(topic);
  if (rounds.length === 0) return topic;
  return {
    ...topic,
    submissionRounds: rounds.map((r) => {
      const hour = Number(r.time.split(":")[0] ?? "0");
      return { ...r, label: hour < 12 ? "เช้า" : "เย็น" };
    }),
  };
}
