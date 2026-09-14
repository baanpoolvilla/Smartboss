/**
 * แปลงผลลงเวลารายวันเป็น CSV รายงานการเข้างาน — แยกจาก route เพื่อทดสอบได้
 *
 * รายวันและสรุปรายคนมาจากการจัดประเภทวันตัวเดียวกัน (classifyDay) สองไฟล์จึงขัดกัน
 * ไม่ได้ — เดิมสรุปนับ "ขาดงาน" จากทุกวันที่ absence_minutes > 0 รวมวันที่เข้างาน
 * ในช่วงผ่อนผันไม่กี่นาที คนที่มาทำงานครบทุกวันจึงขึ้นว่าขาด 9 วัน
 */

export interface ExportAttendanceResult {
  employment_id: string;
  work_date: string;
  actual_in_at: string | null;
  actual_out_at: string | null;
  late_minutes: number;
  absence_minutes: number;
  early_out_minutes: number;
  worked_minutes: number;
  ot_candidate_minutes: number;
  is_rest_day: boolean;
  is_holiday: boolean;
  is_on_leave: boolean;
}

export interface ExportOvertimeDecision {
  status: string;
  approved_minutes: number;
}

export interface ExportPerson {
  code: string;
  name: string;
  timeZone: string;
}

export interface ExportContext {
  rules: {
    /** ขาดเกินกี่นาทีถึงเป็นขาดงาน — ค่าเดียวกับที่ใช้หักคะแนน */
    absenceThresholdMinutes: number;
    missingPunchCountsAsAbsent: boolean;
  };
  personOf: (employmentId: string) => ExportPerson;
  /** key จาก dayKey → ประเภทลาของวันนั้น (dayOff = วันหยุดตามสิทธิ์) */
  leaveOf: (key: string) => { name: string; dayOff: boolean } | undefined;
  /** null = อ่านการตัดสิน OT ไม่ได้ (ไม่มีสิทธิ์) — ไม่บอกสถานะแทนที่จะบอกผิด */
  overtimeOf: ((key: string) => ExportOvertimeDecision | undefined) | null;
}

type DayKind = "work" | "leave" | "dayoff" | "rest" | "holiday";

export interface ClassifiedDay {
  result: ExportAttendanceResult;
  kind: DayKind;
  status: string;
  scanned: boolean;
  missingPunch: boolean;
  late: number;
  earlyOut: number;
  absent: boolean;
  otMinutes: number;
  otApprovedMinutes: number | null;
  otPending: boolean;
}

export interface PersonSummary {
  workedDays: number;
  lateCount: number;
  lateMinutes: number;
  earlyOutCount: number;
  absentDays: number;
  missingPunchCount: number;
  leaveDays: number;
  dayOffDays: number;
  offDays: number;
  workedMinutes: number;
  otPendingMinutes: number;
  otApprovedMinutes: number;
}

const DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

const DAILY_HEADER = [
  "รหัสพนักงาน", "ชื่อ", "วันที่", "วัน", "สถานะ", "เข้างาน", "ออกงาน",
  "ชั่วโมงทำงาน", "สาย (นาที)", "ออกก่อน (นาที)", "OT (ชม.)", "OT อนุมัติ (ชม.)",
];

const SUMMARY_HEADER = [
  "รหัสพนักงาน", "ชื่อ", "มาทำงาน (วัน)", "มาสาย (ครั้ง)", "สายรวม (นาที)",
  "ออกก่อน (ครั้ง)", "ขาดงาน (วัน)", "ลืมสแกน (ครั้ง)", "ลา (วัน)",
  "วันหยุดตามสิทธิ์ (วัน)", "วันหยุด/นักขัตฤกษ์ (วัน)", "ชั่วโมงทำงานรวม",
  "OT รออนุมัติ (ชม.)", "OT อนุมัติแล้ว (ชม.)",
];

export function csvCell(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

export function dayKey(employmentId: string, workDate: string): string {
  return `${employmentId}|${workDate}`;
}

/** 495 → "8:15" · 0 → "" */
export function hhmm(minutes: number): string {
  if (minutes <= 0) return "";
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** 2026-09-01 → "01/09/2569" — เติมศูนย์ให้เรียงใน Excel ได้ถูกลำดับ */
function thaiDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${Number(y) + 543}`;
}

/** เวลาตอกบัตรตามเขตเวลาของพนักงาน — ISO string เก็บเป็น UTC ช้ากว่าเวลาไทย 7 ชั่วโมง */
function clock(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

export function classifyDay(r: ExportAttendanceResult, ctx: ExportContext): ClassifiedDay {
  const key = dayKey(r.employment_id, r.work_date);
  const leave = ctx.leaveOf(key);
  const kind: DayKind = r.is_holiday
    ? "holiday"
    : r.is_on_leave
      ? leave?.dayOff
        ? "dayoff"
        : "leave"
      : r.is_rest_day
        ? "rest"
        : "work";
  const offDay = kind === "holiday" || kind === "dayoff" || kind === "rest";

  const hasIn = r.actual_in_at !== null;
  const hasOut = r.actual_out_at !== null;
  const scanned = hasIn || hasOut;
  const missingPunch = hasIn !== hasOut;

  // วันหยุดไม่มีเวลาเข้า-ออกที่ต้องตรง สาย/ออกก่อนจึงไม่มีความหมาย
  const late = offDay ? 0 : r.late_minutes;
  const earlyOut = offDay ? 0 : r.early_out_minutes;
  // นิยามเดียวกับการหักคะแนน (lib/attendance-performance.ts) — นาทีที่ขาดไม่กี่นาที
  // จากการเข้างานในช่วงผ่อนผันไม่ใช่ขาดงาน และลืมสแกนไม่นับเว้นแต่บริษัทตั้งไว้
  const absent =
    !offDay &&
    r.absence_minutes > ctx.rules.absenceThresholdMinutes &&
    (!missingPunch || ctx.rules.missingPunchCountsAsAbsent);
  const noShift = kind === "work" && !scanned && r.absence_minutes === 0;

  const decision = ctx.overtimeOf?.(key);
  const approved = decision?.status === "FINAL_APPROVED";
  const rejected = decision?.status === "REJECTED";
  const otMinutes = r.ot_candidate_minutes;

  const tags: string[] = [];
  if (kind === "holiday") tags.push("วันหยุดนักขัตฤกษ์");
  if (kind === "rest") tags.push("วันหยุด");
  if (kind === "dayoff" || kind === "leave") tags.push(leave?.name ?? "ลา");
  if (offDay && scanned) tags.push("มาทำงาน");
  if (noShift) tags.push("ไม่มีกะ");
  if (absent) tags.push("ขาดงาน");
  if (hasIn && !hasOut) tags.push("ลืมสแกนออก");
  if (!hasIn && hasOut) tags.push("ลืมสแกนเข้า");
  if (late > 0) tags.push("มาสาย");
  if (earlyOut > 0) tags.push("ออกก่อน");
  if (otMinutes > 0 || decision !== undefined) {
    tags.push(
      ctx.overtimeOf === null
        ? "OT"
        : approved
          ? "OT อนุมัติแล้ว"
          : rejected
            ? "OT ไม่อนุมัติ"
            : "OT รออนุมัติ",
    );
  }
  if (tags.length === 0) tags.push("ปกติ");

  return {
    result: r,
    kind,
    status: tags.join(" · "),
    scanned,
    missingPunch,
    late,
    earlyOut,
    absent,
    otMinutes,
    otApprovedMinutes: approved ? decision!.approved_minutes : null,
    otPending: otMinutes > 0 && ctx.overtimeOf !== null && !approved && !rejected,
  };
}

export function summarizeDays(days: readonly ClassifiedDay[]): PersonSummary {
  const s: PersonSummary = {
    workedDays: 0,
    lateCount: 0,
    lateMinutes: 0,
    earlyOutCount: 0,
    absentDays: 0,
    missingPunchCount: 0,
    leaveDays: 0,
    dayOffDays: 0,
    offDays: 0,
    workedMinutes: 0,
    otPendingMinutes: 0,
    otApprovedMinutes: 0,
  };
  for (const d of days) {
    if (d.scanned) s.workedDays += 1;
    if (d.late > 0) {
      s.lateCount += 1;
      s.lateMinutes += d.late;
    }
    if (d.earlyOut > 0) s.earlyOutCount += 1;
    if (d.absent) s.absentDays += 1;
    if (d.missingPunch) s.missingPunchCount += 1;
    if (d.kind === "leave") s.leaveDays += 1;
    if (d.kind === "dayoff") s.dayOffDays += 1;
    if (d.kind === "rest" || d.kind === "holiday") s.offDays += 1;
    s.workedMinutes += d.result.worked_minutes;
    if (d.otPending) s.otPendingMinutes += d.otMinutes;
    if (d.otApprovedMinutes !== null) s.otApprovedMinutes += d.otApprovedMinutes;
  }
  return s;
}

/** เรียงตามรหัสพนักงาน แล้วตามวัน — อ่านทีละคนต่อเนื่อง */
function classifyAll(results: readonly ExportAttendanceResult[], ctx: ExportContext): ClassifiedDay[] {
  return results
    .map((r) => classifyDay(r, ctx))
    .sort((a, b) => {
      const pa = ctx.personOf(a.result.employment_id);
      const pb = ctx.personOf(b.result.employment_id);
      return (
        pa.code.localeCompare(pb.code, "th") ||
        pa.name.localeCompare(pb.name, "th") ||
        a.result.work_date.localeCompare(b.result.work_date)
      );
    });
}

/** หัวตารางอยู่บรรทัดแรกเสมอ — มีชื่อรายงาน/บรรทัดว่างนำหน้าแล้ว Excel กรอง/เรียงไม่ได้ */
export function buildDailyLines(
  results: readonly ExportAttendanceResult[],
  ctx: ExportContext,
): string[] {
  const lines = [DAILY_HEADER.join(",")];
  for (const d of classifyAll(results, ctx)) {
    const r = d.result;
    const p = ctx.personOf(r.employment_id);
    lines.push(
      [
        csvCell(p.code),
        csvCell(p.name),
        csvCell(thaiDate(r.work_date)),
        csvCell(DOW[new Date(`${r.work_date}T00:00:00Z`).getUTCDay()] ?? ""),
        csvCell(d.status),
        csvCell(clock(r.actual_in_at, p.timeZone)),
        csvCell(clock(r.actual_out_at, p.timeZone)),
        csvCell(hhmm(r.worked_minutes)),
        d.late > 0 ? String(d.late) : "",
        d.earlyOut > 0 ? String(d.earlyOut) : "",
        csvCell(hhmm(d.otMinutes)),
        csvCell(d.otApprovedMinutes === null ? "" : hhmm(d.otApprovedMinutes) || "0:00"),
      ].join(","),
    );
  }
  return lines;
}

export function buildSummaryLines(
  results: readonly ExportAttendanceResult[],
  ctx: ExportContext,
): string[] {
  const byPerson = new Map<string, ClassifiedDay[]>();
  for (const d of classifyAll(results, ctx)) {
    const list = byPerson.get(d.result.employment_id) ?? [];
    list.push(d);
    byPerson.set(d.result.employment_id, list);
  }

  const lines = [SUMMARY_HEADER.join(",")];
  for (const [employmentId, days] of byPerson) {
    const p = ctx.personOf(employmentId);
    const s = summarizeDays(days);
    lines.push(
      [
        csvCell(p.code),
        csvCell(p.name),
        String(s.workedDays),
        String(s.lateCount),
        String(s.lateMinutes),
        String(s.earlyOutCount),
        String(s.absentDays),
        String(s.missingPunchCount),
        String(s.leaveDays),
        String(s.dayOffDays),
        String(s.offDays),
        csvCell(hhmm(s.workedMinutes)),
        csvCell(hhmm(s.otPendingMinutes)),
        csvCell(hhmm(s.otApprovedMinutes)),
      ].join(","),
    );
  }
  return lines;
}

/** BOM ให้ Excel อ่านภาษาไทยถูก · CRLF ตามมาตรฐาน CSV */
export function toCsvFile(lines: readonly string[]): string {
  return "﻿" + lines.join("\r\n");
}
