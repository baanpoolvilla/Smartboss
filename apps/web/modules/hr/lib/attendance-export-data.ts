import "server-only";
import { ABSENCE_THRESHOLD_MINUTES, loadPerformanceSettings } from "@/lib/performance";
import {
  wfTry,
  type Company,
  type Employment,
  type LeaveRequest,
  type LeaveType,
  type Paged,
} from "@/modules/hr/lib/api";
import {
  dayKey,
  type ExportAttendanceResult,
  type ExportContext,
  type ExportOvertimeDecision,
} from "./attendance-export";

import { withSalaryTenant } from "@/modules/salary/lib/db";
import { periodDates, periodOfDate } from "@/modules/salary/lib/types";

const MONTH = /^\d{4}-\d{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface OvertimeRequestRow extends ExportOvertimeDecision {
  employment_id: string;
  work_date: string;
}

export interface AttendanceRange {
  from: string;
  to: string;
  /** YYYY-MM ของวันเริ่ม — ใช้ตั้งชื่อรายงาน */
  month: string;
}

/** เดือนปัจจุบันตามเวลาไทย (ไม่ใช่ของเครื่องเซิร์ฟเวอร์) */
export function currentThaiMonth(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(now).slice(0, 7);
}

/** ?month=YYYY-MM หรือ ?from=&to= · ค่าผิดรูปแบบตกกลับเป็นเดือนนี้ · null = ช่วงกลับหัว */
export function resolveAttendanceRange(params: {
  month?: string | null;
  from?: string | null;
  to?: string | null;
}): AttendanceRange | null {
  const { from, to } = params;
  if (from && to && ISO_DATE.test(from) && ISO_DATE.test(to)) {
    return to < from ? null : { from, to, month: from.slice(0, 7) };
  }
  const month = params.month && MONTH.test(params.month) ? params.month : currentThaiMonth();
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}`, month };
}

/**
 * วันตัดรอบเงินเดือนของบริษัท (เช่น 25 → รอบ 26 – 25) — null = บริษัทนี้ยังไม่ตั้งเงินเดือน
 * หรือตัดสิ้นเดือนอยู่แล้ว (รอบเงินเดือน = ทั้งเดือน ไม่ต้องมีตัวเลือก)
 * ผู้ใช้ 10/11/2569 "เดือนแยกด้วย 25 ก่อนของอีกเดือน 26 ไปของอีกเดือน"
 */
export async function loadPayCutoffDay(orgId: string): Promise<number | null> {
  try {
    const row = await withSalaryTenant(orgId, (tx) =>
      tx.salarySettings.findUnique({ where: { orgId }, select: { cutoffDay: true } }),
    );
    if (!row || row.cutoffDay >= 28) return null;
    return row.cutoffDay;
  } catch {
    return null; // อ่านตั้งค่าเงินเดือนไม่ได้ = ใช้ทั้งเดือนเหมือนเดิม
  }
}

/** รอบเงินเดือน YYYY-MM = วันถัดจากวันตัดของเดือนก่อน ถึงวันตัดของเดือนนั้น (เช่น 2026-11 → 26 ต.ค. – 25 พ.ย.) */
export function payPeriodRange(month: string, cutoffDay: number): AttendanceRange {
  const { startsOn, endsOn } = periodDates(month, cutoffDay, 0);
  return { from: startsOn, to: endsOn, month };
}

/** รอบเงินเดือนที่วันนี้ (เวลาไทย) ตกอยู่ */
export function currentPayPeriod(cutoffDay: number, now = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(now);
  return periodOfDate(today, cutoffDay);
}

export interface AttendanceReportData {
  companyName: string | null;
  results: ExportAttendanceResult[];
  ctx: ExportContext;
}

/**
 * ข้อมูลของรายงานการเข้างาน — หน้ารายงานกับ CSV ใช้ตัวเดียวกัน ตัวเลขจึงตรงกันเสมอ
 *
 * อ่านจาก attendance-results (ผลคำนวณที่เงินเดือนใช้อ้างอิง) ไม่ใช่กระดานสด เพราะกระดาน
 * สดไม่มีแถวของคนที่ไม่มาเลย · null = อ่านผลลงเวลาไม่ได้ (ไม่มีสิทธิ์) ต้องบอกตรง ๆ
 * ไม่ใช่ส่งรายงานเปล่าที่ดูเหมือนไม่มีใครมาทำงาน
 */
export async function loadAttendanceReport(
  orgId: string,
  from: string,
  to: string,
): Promise<AttendanceReportData | null> {
  const [companies, employments, results, leaves, leaveTypes, overtime, settings] = await Promise.all([
    wfTry<Paged<Company>>("/companies"),
    wfTry<Paged<Employment>>("/employments"),
    wfTry<{ items: ExportAttendanceResult[] }>(`/attendance-results?from=${from}&to=${to}`),
    // ผลลงเวลาบอกได้แค่ "ลาหรือไม่" ต้องดึงใบจริงมาถึงจะแยกวันหยุดตามสิทธิ์ออกจากลาป่วยได้
    // ⚠ API คืนสูงสุด 500 ใบ — ใบที่เกินจะตกไปใช้ป้าย "ลา" (หยาบกว่า ไม่ผิด)
    wfTry<Paged<LeaveRequest>>(`/leave-requests?from=${from}&to=${to}&status=APPROVED`),
    wfTry<Paged<LeaveType>>("/leave-types"),
    wfTry<{ items: OvertimeRequestRow[] }>(`/overtime-requests?from=${from}&to=${to}`),
    loadPerformanceSettings(orgId),
  ]);
  if (results === null) return null;

  const leaveTypeById = new Map((leaveTypes?.items ?? []).map((t) => [t.id, t]));
  const leaveByDay = new Map<string, { name: string; dayOff: boolean }>();
  for (const leave of leaves?.items ?? []) {
    const type = leaveTypeById.get(leave.leave_type_id);
    if (type === undefined) continue;
    const end = Date.parse(`${leave.ends_on}T00:00:00Z`);
    for (let t = Date.parse(`${leave.starts_on}T00:00:00Z`); t <= end; t += 86_400_000) {
      leaveByDay.set(dayKey(leave.employment_id, new Date(t).toISOString().slice(0, 10)), {
        name: type.name,
        dayOff: type.auto_approve,
      });
    }
  }

  const decisionByDay = new Map<string, ExportOvertimeDecision>();
  for (const row of overtime?.items ?? []) {
    if (row.status === "FINAL_APPROVED" || row.status === "REJECTED") {
      decisionByDay.set(dayKey(row.employment_id, row.work_date), row);
    }
  }

  const people = new Map(
    (employments?.items ?? []).map((e) => [
      e.id,
      { code: e.employee_code, name: e.full_name || e.display_name, timeZone: e.time_zone || "Asia/Bangkok" },
    ]),
  );

  return {
    companyName: companies?.items[0]?.display_name ?? null,
    results: results.items,
    ctx: {
      rules: {
        absenceThresholdMinutes: ABSENCE_THRESHOLD_MINUTES,
        missingPunchCountsAsAbsent: settings.missingPunchCountsAsAbsent,
      },
      personOf: (id) => people.get(id) ?? { code: "", name: "ไม่ทราบชื่อ", timeZone: "Asia/Bangkok" },
      leaveOf: (key) => leaveByDay.get(key),
      overtimeOf: overtime === null ? null : (key) => decisionByDay.get(key),
    },
  };
}
