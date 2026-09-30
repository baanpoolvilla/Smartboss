/** ต้องตรงกับ Module.code ใน DB — seed ลงทะเบียนไว้แล้ว (isEnabled: false โดย
 * ค่าเริ่มต้น เปิดใช้ทีละบริษัทได้ที่ /admin/modules) */
export const ADS_CODE = "ads";

export const ADS_BASE = "/ads";

/**
 * สีสถานะ (spec §5.3) — ใช้ทั้งระบบ: หน้าเว็บ อีเมล PDF Excel
 * ทุกช่องที่มีสีต้องมีคำกำกับด้วย (label) เพื่อให้อ่านได้แม้แยกสีแดง/เขียวได้ยาก
 */
export const STATUS_STYLE = {
  good: { bg: "#CDEBD5", fg: "#14532D", label: "● ดี" },
  normal: { bg: "#FBE9A6", fg: "#6B4E00", label: "● ปกติ" },
  poor: { bg: "#F8CFCB", fg: "#8F1414", label: "● ต้องแก้" },
  low_data: { bg: "#ECE9E1", fg: "#4F4B44", label: "ข้อมูลน้อย" },
} as const;

/** ป้ายของ enum ที่ AI ตอบกลับ (spec §6.3) และสถานะแผนปฏิบัติการ (spec §4 ads_ai_actions) */
export const IMPACT_LABEL: Record<string, string> = { high: "ผลกระทบสูง", medium: "ผลกระทบกลาง", low: "ผลกระทบต่ำ" };
export const URGENCY_LABEL: Record<string, string> = { now: "ทำทันที", this_week: "สัปดาห์นี้", this_month: "เดือนนี้" };
export const ACTION_STATUS_LABEL: Record<string, string> = {
  pending: "รอดำเนินการ",
  in_progress: "กำลังทำ",
  done: "เสร็จแล้ว",
  skipped: "ข้าม",
};
export const ACTION_STATUSES = ["pending", "in_progress", "done", "skipped"] as const;

export const SYNC_STATUS_LABEL: Record<string, string> = { success: "สำเร็จ", retried: "สำเร็จ (ลองซ้ำ)", failed: "ล้มเหลว" };
export const JOB_TYPE_LABEL: Record<string, string> = { daily: "รายวัน", manual: "ซิงค์ด้วยมือ", backfill: "Backfill" };

/** ชื่อ KPI ที่มีเกณฑ์ (spec §5.2) — ลำดับนี้คือลำดับที่แสดงทุกหน้า */
export const METRIC_LABEL: Record<string, string> = {
  ctr: "CTR",
  cpc: "CPC",
  conv_rate: "Conversion Rate",
  cpa: "CPA",
  top_impr_pct: "Impr. (Top) %",
  abs_top_impr_pct: "Impr. (Abs. Top) %",
};
