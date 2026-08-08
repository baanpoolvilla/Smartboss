/**
 * แปลงค่า enum ของ workforce API เป็นภาษาที่ผู้ใช้อ่านออก
 * (ยกมาจาก apps/web/src/lib/labels.ts ของ workforce)
 *
 * ค่าที่ยังไม่มีคำแปลจะคืนค่าเดิม — ดีกว่าแสดงช่องว่างเมื่อ API เพิ่มสถานะใหม่
 */

const STATUS: Record<string, string> = {
  ACTIVE: "ใช้งาน",
  INACTIVE: "ไม่ใช้งาน",
  PENDING: "รอดำเนินการ",
  DRAFT: "ฉบับร่าง",
  PUBLISHED: "เผยแพร่แล้ว",
  ARCHIVED: "เก็บถาวร",
  REVOKED: "เพิกถอนแล้ว",
  TERMINATED: "พ้นสภาพ",
  SUCCESS: "สำเร็จ",
  FAILED: "ล้มเหลว",
  OK: "ปกติ",

  OPEN: "เปิดอยู่",
  CLOSED: "ปิดแล้ว",
  REOPENED: "เปิดใหม่",

  CALCULATING: "กำลังคำนวณ",
  CALCULATED: "คำนวณแล้ว",
  REVIEW: "รอตรวจสอบ",
  APPROVED: "อนุมัติแล้ว",
  REJECTED: "ตีกลับ",
  LOCKED: "ล็อกแล้ว",
  PAYMENT_PENDING: "รอจ่าย",
  PAID: "จ่ายแล้ว",
  FILED: "ยื่นแล้ว",

  COMPLETE: "ครบถ้วน",
  INCOMPLETE: "ไม่ครบ",
  ABSENT: "ขาดงาน",
  ON_LEAVE: "ลา",
  REST_DAY: "วันหยุดประจำ",
  HOLIDAY: "วันหยุดนักขัตฤกษ์",
  QUARANTINED: "กักไว้ตรวจสอบ",
};

const EMPLOYMENT_TYPE: Record<string, string> = {
  MONTHLY: "รายเดือน",
  DAILY: "รายวัน",
  HOURLY: "รายชั่วโมง",
};

const DEVICE_TYPE: Record<string, string> = {
  FINGERPRINT_TERMINAL: "เครื่องสแกนลายนิ้วมือ",
  KIOSK: "Kiosk",
  GATEWAY: "Gateway",
};

const RUN_TYPE: Record<string, string> = {
  REGULAR: "งวดปกติ",
  OFF_CYCLE: "นอกงวด",
  ADJUSTMENT: "ปรับปรุง",
  CORRECTION: "แก้ไข",
};

const CATEGORY: Record<string, string> = {
  EARNING: "รายได้",
  DEDUCTION: "รายการหัก",
  BENEFIT: "สวัสดิการ",
  EMPLOYER_CONTRIBUTION: "นายจ้างสมทบ",
  INFORMATION: "ข้อมูลประกอบ",
};

const RULE_TYPE: Record<string, string> = {
  TH_SOCIAL_SECURITY: "ประกันสังคม",
  TH_PIT_WITHHOLDING: "ภาษีหัก ณ ที่จ่าย",
  OT_MULTIPLIER: "ตัวคูณล่วงเวลา",
  MINIMUM_WAGE: "ค่าแรงขั้นต่ำ",
  SEVERANCE: "ค่าชดเชย",
  PROVIDENT_FUND: "กองทุนสำรองเลี้ยงชีพ",
};

function lookup(table: Record<string, string>, value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return table[value] ?? value;
}

export const statusLabel = (v: string | null | undefined) => lookup(STATUS, v);
export const employmentTypeLabel = (v: string | null | undefined) => lookup(EMPLOYMENT_TYPE, v);
export const deviceTypeLabel = (v: string | null | undefined) => lookup(DEVICE_TYPE, v);
export const runTypeLabel = (v: string | null | undefined) => lookup(RUN_TYPE, v);
export const categoryLabel = (v: string | null | undefined) => lookup(CATEGORY, v);
export const ruleTypeLabel = (v: string | null | undefined) => lookup(RULE_TYPE, v);

/**
 * สีของสถานะ — คืนเป็นชื่อ CSS variable ไม่ใช่ hex
 * (spec ข้อ 11: ห้าม hardcode hex ใน component)
 */
export function statusTone(value: string | null | undefined): string {
  switch (value) {
    case "ACTIVE":
    case "PUBLISHED":
    case "APPROVED":
    case "PAID":
    case "COMPLETE":
    case "SUCCESS":
    case "OK":
      return "var(--tone-ok)";
    case "LOCKED":
    case "CLOSED":
    case "FILED":
      return "var(--tone-info)";
    case "DRAFT":
    case "PENDING":
    case "CALCULATING":
    case "REVIEW":
    case "PAYMENT_PENDING":
    case "OPEN":
    case "REOPENED":
      return "var(--tone-warn)";
    case "REJECTED":
    case "FAILED":
    case "REVOKED":
    case "TERMINATED":
    case "ABSENT":
    case "QUARANTINED":
      return "var(--tone-danger)";
    default:
      return "var(--tone-muted)";
  }
}

/** นาที → "8 ชม. 30 น." อ่านง่ายกว่าเลขนาทีดิบ */
export function formatMinutes(total: number | null | undefined): string {
  if (total === null || total === undefined) return "—";
  if (total === 0) return "0";
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(total);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  if (hours === 0) return `${sign}${minutes} น.`;
  if (minutes === 0) return `${sign}${hours} ชม.`;
  return `${sign}${hours} ชม. ${minutes} น.`;
}

/** จำนวนเงินจาก API เป็น "สตริง scale 4" — ห้ามแปลงเป็น number ไปบวกกัน */
export function formatMoney(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return value;
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    calendar: "buddhist",
  }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    calendar: "buddhist",
  }).format(date);
}
