/**
 * จัดประเภทผลลงเวลารายวันสำหรับรายงานการเข้างาน — ใช้ทั้งหน้ารายงานและ CSV
 *
 * ทุกมุมมอง (รายวัน สรุปรายคน หน้ารายงาน) มาจาก classifyDay ตัวเดียวกัน จึงขัดกัน
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

export type TagTone = "ok" | "warn" | "danger" | "info" | "muted";

export interface StatusTag {
  label: string;
  tone: TagTone;
}

export interface ClassifiedDay {
  result: ExportAttendanceResult;
  kind: DayKind;
  tags: StatusTag[];
  /** tags ต่อกันเป็นข้อความเดียว เช่น "ลืมสแกนออก · มาสาย" */
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

export interface PersonReport {
  employmentId: string;
  person: ExportPerson;
  days: ClassifiedDay[];
  summary: PersonSummary;
}

export const THAI_MONTHS = [
  "", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

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

/** 2026-09-01 → "01/09/2569" — เติมศูนย์ให้เรียงลำดับได้ถูก */
export function formatThaiDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${Number(y) + 543}`;
}

/** 2026-09-01 → "อ" */
export function dayOfWeek(iso: string): string {
  return DOW[new Date(`${iso}T00:00:00Z`).getUTCDay()] ?? "";
}

/** เวลาตอกบัตรตามเขตเวลาของพนักงาน — ISO string เก็บเป็น UTC ช้ากว่าเวลาไทย 7 ชั่วโมง */
export function formatClock(iso: string | null, timeZone: string): string {
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

  const tags: StatusTag[] = [];
  if (kind === "holiday") tags.push({ label: "วันหยุดนักขัตฤกษ์", tone: "muted" });
  if (kind === "rest") tags.push({ label: "วันหยุด", tone: "muted" });
  if (kind === "dayoff" || kind === "leave") tags.push({ label: leave?.name ?? "ลา", tone: "muted" });
  if (offDay && scanned) tags.push({ label: "มาทำงาน", tone: "info" });
  if (noShift) tags.push({ label: "ไม่มีกะ", tone: "muted" });
  if (absent) tags.push({ label: "ขาดงาน", tone: "danger" });
  if (hasIn && !hasOut) tags.push({ label: "ลืมสแกนออก", tone: "warn" });
  if (!hasIn && hasOut) tags.push({ label: "ลืมสแกนเข้า", tone: "warn" });
  if (late > 0) tags.push({ label: "มาสาย", tone: "warn" });
  if (earlyOut > 0) tags.push({ label: "ออกก่อน", tone: "warn" });
  if (otMinutes > 0 || decision !== undefined) {
    tags.push(
      ctx.overtimeOf === null
        ? { label: "OT", tone: "info" }
        : approved
          ? { label: "OT อนุมัติแล้ว", tone: "ok" }
          : rejected
            ? { label: "OT ไม่อนุมัติ", tone: "muted" }
            : { label: "OT รออนุมัติ", tone: "info" },
    );
  }
  if (tags.length === 0) tags.push({ label: "ปกติ", tone: "ok" });

  return {
    result: r,
    kind,
    tags,
    status: tags.map((t) => t.label).join(" · "),
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

/** รายคนเรียงตามรหัสพนักงาน แต่ละคนเรียงตามวัน */
export function buildPersonReports(
  results: readonly ExportAttendanceResult[],
  ctx: ExportContext,
): PersonReport[] {
  const byPerson = new Map<string, ClassifiedDay[]>();
  for (const r of results) {
    const list = byPerson.get(r.employment_id) ?? [];
    list.push(classifyDay(r, ctx));
    byPerson.set(r.employment_id, list);
  }

  return [...byPerson.entries()]
    .map(([employmentId, days]) => ({
      employmentId,
      person: ctx.personOf(employmentId),
      days: days.sort((a, b) => a.result.work_date.localeCompare(b.result.work_date)),
      summary: summarizeDays(days),
    }))
    .sort(
      (a, b) =>
        a.person.code.localeCompare(b.person.code, "th") ||
        a.person.name.localeCompare(b.person.name, "th"),
    );
}

/** หัวตารางอยู่บรรทัดแรกเสมอ — มีชื่อรายงาน/บรรทัดว่างนำหน้าแล้ว Excel กรอง/เรียงไม่ได้ */
export function buildDailyLines(
  results: readonly ExportAttendanceResult[],
  ctx: ExportContext,
): string[] {
  const lines = [DAILY_HEADER.join(",")];
  for (const { person: p, days } of buildPersonReports(results, ctx)) {
    for (const d of days) {
      const r = d.result;
      lines.push(
        [
          csvCell(p.code),
          csvCell(p.name),
          csvCell(formatThaiDate(r.work_date)),
          csvCell(dayOfWeek(r.work_date)),
          csvCell(d.status),
          csvCell(formatClock(r.actual_in_at, p.timeZone)),
          csvCell(formatClock(r.actual_out_at, p.timeZone)),
          csvCell(hhmm(r.worked_minutes)),
          d.late > 0 ? String(d.late) : "",
          d.earlyOut > 0 ? String(d.earlyOut) : "",
          csvCell(hhmm(d.otMinutes)),
          csvCell(d.otApprovedMinutes === null ? "" : hhmm(d.otApprovedMinutes) || "0:00"),
        ].join(","),
      );
    }
  }
  return lines;
}

export function buildSummaryLines(
  results: readonly ExportAttendanceResult[],
  ctx: ExportContext,
): string[] {
  const lines = [SUMMARY_HEADER.join(",")];
  for (const { person: p, summary: s } of buildPersonReports(results, ctx)) {
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
