import "server-only";
import { prisma } from "@smartboss/database";

import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import { WORKER_ROLE_CODE } from "../permissions";
import { daysInMonth, minutesToHm, type DayCell, type MonthData, type OtEntry, type OverrideEntry, type WorkerMonth } from "./types";

/**
 * ข้อมูลของโมดูลคนงานรายวัน — อ่านตรงจากตารางของ workforce ด้วย tenant context ของบริษัท (withWorkforceTenant)
 * เพื่อให้คนที่มีแค่สิทธิ์ "ดูคนงาน" (ไม่มีสิทธิ์ HR) เปิดตารางได้ · หน้าเว็บตรวจสิทธิ์ Smartboss ก่อนเรียกเสมอ
 *
 * กติกาของคนงาน (เฉพาะบทบาท WORKER — พนักงานประจำใช้กติกาเดิม):
 *   - ลงเวลาเข้าก่อน/ตรงเวลาเข้ากะ (ระดับนาที ไม่มีผ่อนผัน) = มา · 08:01 ขึ้นไป = ขาด (ยังเก็บเวลาจริง)
 *   - ลงเวลาออกก่อนเลิกกะ = มา + "กลับก่อน" · วันที่มี OT ที่ผู้ดูแลลงไว้ไม่ดูเวลาออก
 *   - ไม่ลงเวลาและไม่ได้ลงหยุด = ไม่มา · วันหยุดนักขัตฤกษ์ไม่มีสำหรับคนงาน (ถือเป็นวันทำงาน)
 *   - ผู้มีสิทธิ์แก้ "ขาด → มา" ได้พร้อมเหตุผล (store daily-worker-overrides)
 * OT เก็บที่ store daily-worker-ot (ผู้ดูแลใส่เวลาเริ่ม–จบ) — ค่าแรงยังไม่คิด
 */

export const OT_KEY = "daily-worker-ot";
export const OVERRIDE_KEY = "daily-worker-overrides";

export async function readOt(orgId: string) {
  const { data, version } = await readStore<OtEntry[]>(orgId, OT_KEY);
  return { list: data ?? [], version };
}
export async function readOverrides(orgId: string) {
  const { data, version } = await readStore<OverrideEntry[]>(orgId, OVERRIDE_KEY);
  return { list: data ?? [], version };
}

/** เขียน store แบบกันชนกัน — อ่านใหม่แล้วลองซ้ำเมื่อ version ไม่ตรง */
export async function updateStoreList<T>(
  orgId: string,
  key: string,
  userId: string,
  change: (list: T[]) => T[],
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, version } = await readStore<T[]>(orgId, key);
    const result = await writeStore(orgId, key, change(data ?? []), data === null ? null : version, userId);
    if (result.ok) return;
  }
  throw new Error("บันทึกไม่สำเร็จ มีคนแก้พร้อมกัน ลองใหม่อีกครั้ง");
}

export function bangkokToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(now);
}

interface WorkerIdentity {
  userId: string;
  name: string;
  email: string | null;
  departmentId: string | null;
  departmentName: string | null;
}

async function listWorkerUsers(orgId: string): Promise<WorkerIdentity[]> {
  const users = await prisma.user.findMany({
    where: { orgId, isActive: true, roles: { some: { role: { code: WORKER_ROLE_CODE } } } },
    select: { id: true, name: true, email: true, departmentId: true, department: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  return users.map((u) => ({ userId: u.id, name: u.name, email: u.email, departmentId: u.departmentId, departmentName: u.department?.name ?? null }));
}

interface EmploymentRow {
  subject: string;
  employment_id: string;
  employee_code: string;
  shift_id: string | null;
  shift_name: string | null;
  shift_start: number | null;
  shift_end: number | null;
  shift_from: string | null;
  linked: boolean;
}
interface ResultRow {
  employment_id: string;
  day: string;
  in_hm: string | null;
  out_hm: string | null;
  late: boolean;
  early: boolean;
  rest_day: boolean;
  worked_minutes: number;
}
interface LeaveRow {
  id: string;
  employment_id: string;
  starts_on: string;
  ends_on: string;
  type_name: string;
  is_day_off: boolean;
  by_name: string | null;
  created_at: Date;
}

/** ประเภทวันหยุดตามสิทธิ์ (Day-Off) — เกณฑ์เดียวกับหน้าพนักงาน (อนุมัติอัตโนมัติ ไม่ต้องส่งรายงาน ไม่ใช่ Holiday สะสม) */
const DAY_OFF_TYPE_SQL = `lt.auto_approve AND NOT lt.requires_reports AND NOT lt.accrues_from_holidays AND lt.archived_at IS NULL`;

export async function loadMonth(orgId: string, month: string, now: Date = new Date()): Promise<MonthData> {
  const total = daysInMonth(month);
  const from = `${month}-01`;
  const to = `${month}-${String(total).padStart(2, "0")}`;
  const today = bangkokToday(now);
  const workers = await listWorkerUsers(orgId);
  const subjects = workers.map((w) => w.userId);

  const wf =
    subjects.length === 0
      ? { employments: [] as EmploymentRow[], results: [] as ResultRow[], leaves: [] as LeaveRow[], dayOffTypeId: null as string | null, shifts: [] as { id: string; name: string; start_minutes: number; end_minutes: number }[] }
      : await withWorkforceTenant(orgId, async (tx) => {
          // สัญญาจ้างที่ยังทำงานอยู่ของแต่ละคน + กะที่มีผลวันนี้ (ตารางประจำ — ทุกวันกะเดียวกัน ดู setRecurringPatternAction)
          // ผูกคนกับทะเบียนพนักงาน: principal.person_id (ที่ระบบบุคคลใช้ตอนลงเวลา) ก่อน ไม่มีค่อยเทียบอีเมล
          // (ผู้ใช้ที่ยังไม่เคย sync ไประบบบุคคล principal ยังไม่มี/ยังไม่ผูก person — เจอจริง 2026-10-15)
          const employments = await tx.$queryRawUnsafe<EmploymentRow[]>(
            `SELECT DISTINCT ON (u.subject) u.subject, e.id::text AS employment_id, e.employee_code,
                    s.id::text AS shift_id, s.name AS shift_name, s.start_minutes AS shift_start, s.end_minutes AS shift_end, pat.shift_from,
                    COALESCE(pe.id = p.person_id, false) AS linked
               FROM unnest($1::text[], $3::text[]) AS u(subject, email)
               LEFT JOIN workforce.principals p ON p.subject = u.subject
               JOIN workforce.people pe
                 ON pe.id = p.person_id OR (u.email <> '' AND lower(pe.email) = lower(u.email))
               JOIN workforce.employments e ON e.person_id = pe.id AND e.status <> 'TERMINATED'
               LEFT JOIN LATERAL (
                 SELECT COALESCE(r.monday_shift_id, r.tuesday_shift_id, r.wednesday_shift_id, r.thursday_shift_id,
                                 r.friday_shift_id, r.saturday_shift_id, r.sunday_shift_id) AS shift_id,
                        to_char(r.effective_from, 'YYYY-MM-DD') AS shift_from
                   FROM workforce.recurring_work_patterns r
                  WHERE r.employment_id = e.id AND (r.effective_to IS NULL OR r.effective_to >= $2::date)
                  -- ตัวที่มีผลวันนี้ก่อน ไม่มีค่อยเอาตัวที่จะเริ่มเร็วที่สุด (ผูกกะไว้ให้เริ่มพรุ่งนี้ ไม่ใช่ "ยังไม่ผูกกะ")
                  ORDER BY (r.effective_from <= $2::date) DESC,
                           CASE WHEN r.effective_from <= $2::date THEN r.effective_from END DESC NULLS LAST,
                           r.effective_from ASC
                  LIMIT 1
               ) pat ON true
               LEFT JOIN workforce.shift_definitions s ON s.id = pat.shift_id
              ORDER BY u.subject, (pe.id = p.person_id) DESC NULLS LAST, e.hired_on DESC`,
            subjects,
            today,
            workers.map((w) => w.email ?? ""),
          );
          const ids = employments.map((e) => e.employment_id);
          if (ids.length === 0) return { employments, results: [], leaves: [], dayOffTypeId: null, shifts: [] };
          const results = await tx.$queryRawUnsafe<ResultRow[]>(
            `SELECT ar.employment_id::text AS employment_id, to_char(ar.work_date, 'YYYY-MM-DD') AS day,
                    to_char(ar.actual_in_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS in_hm,
                    to_char(ar.actual_out_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS out_hm,
                    (ar.actual_in_at IS NOT NULL AND ar.scheduled_in_at IS NOT NULL
                       AND date_trunc('minute', ar.actual_in_at) > ar.scheduled_in_at) AS late,
                    (ar.actual_out_at IS NOT NULL AND ar.scheduled_out_at IS NOT NULL
                       AND date_trunc('minute', ar.actual_out_at) < ar.scheduled_out_at) AS early,
                    ar.is_rest_day AS rest_day, ar.worked_minutes
               FROM workforce.attendance_results ar
              WHERE ar.is_current AND ar.employment_id = ANY($1::uuid[])
                AND ar.work_date BETWEEN $2::date AND $3::date`,
            ids,
            from,
            to,
          );
          const leaves = await tx.$queryRawUnsafe<LeaveRow[]>(
            `SELECT l.id::text AS id, l.employment_id::text AS employment_id,
                    to_char(l.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(l.ends_on, 'YYYY-MM-DD') AS ends_on,
                    lt.name AS type_name, (${DAY_OFF_TYPE_SQL}) AS is_day_off,
                    pr.display_name AS by_name, l.created_at
               FROM workforce.leave_requests l
               JOIN workforce.leave_types lt ON lt.id = l.leave_type_id
               LEFT JOIN workforce.principals pr ON pr.id = l.created_by
              WHERE l.status = 'APPROVED' AND l.employment_id = ANY($1::uuid[])
                AND l.starts_on <= $3::date AND l.ends_on >= $2::date`,
            ids,
            from,
            to,
          );
          const types = await tx.$queryRawUnsafe<{ id: string }[]>(
            `SELECT lt.id::text AS id FROM workforce.leave_types lt WHERE ${DAY_OFF_TYPE_SQL}
              ORDER BY (lower(lt.name) LIKE '%day%off%') DESC, lt.created_at ASC LIMIT 1`,
          );
          const shifts = await tx.$queryRawUnsafe<{ id: string; name: string; start_minutes: number; end_minutes: number }[]>(
            `SELECT id::text AS id, name, start_minutes, end_minutes FROM workforce.shift_definitions
              WHERE status = 'ACTIVE' AND rest_day = false ORDER BY start_minutes, name`,
          );
          return { employments, results, leaves, dayOffTypeId: types[0]?.id ?? null, shifts };
        });

  const [{ list: ot }, { list: overrides }] = await Promise.all([readOt(orgId), readOverrides(orgId)]);
  const empBySubject = new Map(wf.employments.map((e) => [e.subject, e]));

  const rows: WorkerMonth[] = workers.map((w) => {
    const emp = empBySubject.get(w.userId) ?? null;
    const cells: Record<number, DayCell> = {};
    if (emp) {
      const res = new Map(wf.results.filter((r) => r.employment_id === emp.employment_id).map((r) => [r.day, r]));
      for (let d = 1; d <= total; d++) {
        const date = `${month}-${String(d).padStart(2, "0")}`;
        const cell: DayCell = { s: "" };
        const r = res.get(date);
        const leave = wf.leaves.find((l) => l.employment_id === emp.employment_id && l.starts_on <= date && l.ends_on >= date);
        const otEntry = ot.find((o) => o.employmentId === emp.employment_id && o.date === date);
        const ov = overrides.find((o) => o.employmentId === emp.employment_id && o.date === date);
        if (r?.in_hm) {
          cell.inAt = r.in_hm;
          if (r.out_hm) cell.outAt = r.out_hm;
          cell.s = r.late ? (ov ? "m" : "x") : "m";
          // วันที่มี OT ที่ผู้ดูแลลงไว้ ไม่ดูเวลาออก (ลงออกหลังทำ OT หรือไม่ลงออกเลยก็ได้)
          if (r.early && !otEntry) cell.early = true;
          if (r.late && ov) cell.override = { reason: ov.reason, byName: ov.byName, at: ov.at };
        } else if (leave) {
          cell.s = leave.is_day_off ? "o" : "l";
        } else if (r?.rest_day) {
          cell.s = "r";
        } else if (ov) {
          // ไม่ได้ลงเวลา (ลืมลง/ลงไม่ติด) แต่ผู้ดูแลยืนยันว่ามา พร้อมเหตุผล
          cell.s = "m";
          cell.override = { reason: ov.reason, byName: ov.byName, at: ov.at };
        } else if (date < today) {
          cell.s = emp.shift_id || r ? "n" : "";
        }
        if (leave) {
          cell.leave = { id: leave.id, name: leave.type_name, dayOff: leave.is_day_off, byName: leave.by_name, at: new Date(leave.created_at).toISOString() };
        }
        if (otEntry) cell.ot = { id: otEntry.id, start: otEntry.start, end: otEntry.end, minutes: otEntry.minutes, note: otEntry.note, byName: otEntry.byName };
        if (cell.s || cell.leave || cell.ot) cells[d] = cell;
      }
    }
    return {
      ...w,
      employmentId: emp?.employment_id ?? null,
      employeeCode: emp?.employee_code ?? null,
      shiftId: emp?.shift_id ?? null,
      shiftName: emp?.shift_name ?? null,
      shiftStart: emp?.shift_start ?? null,
      shiftEnd: emp?.shift_end ?? null,
      shiftFrom: emp?.shift_from && emp.shift_from > today ? emp.shift_from : null,
      cells,
    };
  });

  const unlinkedUserIds = wf.employments.filter((e) => !e.linked).map((e) => e.subject);
  return { month, days: total, today, unlinkedUserIds, workers: rows, dayOffTypeId: wf.dayOffTypeId, shifts: wf.shifts.map((s) => ({ id: s.id, name: s.name, start: s.start_minutes, end: s.end_minutes })) };
}

/** สรุปของคนหนึ่งในเดือนนั้น — ใช้ทั้งตารางสรุปและหน้า "เดือนนี้ของฉัน" */
export function summarize(w: WorkerMonth) {
  let present = 0, absent = 0, early = 0, noShow = 0, off = 0, leave = 0, otMinutes = 0;
  for (const c of Object.values(w.cells)) {
    if (c.s === "m") present++;
    if (c.s === "x") absent++;
    if (c.early) early++;
    if (c.s === "n") noShow++;
    if (c.s === "o") off++;
    if (c.s === "l") leave++;
    if (c.ot) otMinutes += c.ot.minutes;
  }
  return { present, absent, early, noShow, off, leave, otMinutes };
}

/** คนงานคนนี้ (ผู้ใช้ที่ล็อกอิน) — null ถ้าไม่ใช่คนงาน */
export async function loadMyMonth(orgId: string, userId: string, month: string) {
  const isWorker = await prisma.userRole.count({ where: { userId, role: { code: WORKER_ROLE_CODE } } });
  if (!isWorker) return null;
  const data = await loadMonth(orgId, month);
  const me = data.workers.find((w) => w.userId === userId);
  if (!me) return null;
  return { month, today: data.today, worker: me, summary: summarize(me) };
}

export interface DayRow {
  userId: string;
  name: string;
  employeeCode: string | null;
  employmentId: string | null;
  shift: string | null;
  inAt: string | null;
  outAt: string | null;
  /** วิธีลงเวลาครั้งแรก — MOBILE / DEVICE (สแกนนิ้ว) / อื่น ๆ */
  source: string | null;
  /** m=มา x=ขาด n=ไม่มา o=หยุด l=ลา r=หยุดกะ w=ยังไม่มา (วันนี้ ยังไม่ถึงเลิกกะ) ns=ยังไม่ผูกกะ */
  status: "m" | "x" | "n" | "o" | "l" | "r" | "w" | "ns";
  early: boolean;
  cell: DayCell | null;
}

/**
 * ลงเวลาของคนงานวันเดียว — เวลาเข้า/ออกอ่านจากการลงเวลาจริง (raw_time_events) ทันที ไม่ต้องรอระบบคำนวณผล
 * สถานะใช้กติกาเดียวกับตาราง (เข้าหลังเวลาเข้ากะระดับนาที = ขาด · ออกก่อนเลิกกะ = กลับก่อน · OT ที่ลงไว้ไม่ดูเวลาออก)
 */
export async function loadDay(orgId: string, date: string, now: Date = new Date()) {
  const month = await loadMonth(orgId, date.slice(0, 7), now);
  const day = Number(date.slice(8, 10));
  const ids = month.workers.map((w) => w.employmentId).filter((x): x is string => !!x);
  const events =
    ids.length === 0
      ? []
      : await withWorkforceTenant(orgId, (tx) =>
          tx.$queryRawUnsafe<{ employment_id: string; hm: string; source_type: string }[]>(
            `SELECT employment_id::text AS employment_id, source_type,
                    to_char(captured_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS hm
               FROM workforce.raw_time_events
              WHERE employment_id = ANY($1::uuid[]) AND status = 'ACCEPTED'
                AND (captured_at AT TIME ZONE 'Asia/Bangkok')::date = $2::date
              ORDER BY captured_at`,
            ids,
            date,
          ),
        ).catch(() => []);
  const nowHm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

  const rows: DayRow[] = month.workers.map((w) => {
    const cell = w.cells[day] ?? null;
    const mine = events.filter((e) => e.employment_id === w.employmentId);
    const inAt = cell?.inAt ?? mine[0]?.hm ?? null;
    const outAt = cell?.outAt ?? (mine.length > 1 ? mine[mine.length - 1]!.hm : null);
    const shift = w.shiftId ? `${minutesToHm(w.shiftStart)}–${minutesToHm(w.shiftEnd)}` : null;
    let status: DayRow["status"];
    if (cell?.s === "o" || cell?.s === "l" || cell?.s === "r") status = cell.s;
    else if (cell?.override) status = "m";
    else if (inAt) {
      if (cell?.s === "m" || cell?.s === "x") status = cell.s;
      else if (w.shiftStart === null) status = "m";
      else status = toMin(inAt) > w.shiftStart % 1440 ? "x" : "m";
    } else if (!w.shiftId) status = "ns";
    else if (date < month.today) status = "n";
    else if (date > month.today) status = "w";
    else status = w.shiftEnd !== null && toMin(nowHm) > w.shiftEnd % 1440 ? "n" : "w";
    const early =
      !!cell?.early ||
      (!cell?.ot && !!outAt && w.shiftEnd !== null && w.shiftEnd < 1440 && toMin(outAt) < w.shiftEnd && (date < month.today || mine.length > 1));
    return {
      userId: w.userId,
      name: w.name,
      employeeCode: w.employeeCode,
      employmentId: w.employmentId,
      shift,
      inAt,
      outAt,
      source: mine[0]?.source_type ?? null,
      status,
      early,
      cell,
    };
  });
  return { date, today: month.today, rows, unlinkedUserIds: month.unlinkedUserIds };
}

/**
 * employment ของคนงานทั้งหมดในบริษัท — ใช้ซ่อนคนงานจากหน้า HR → ภาพรวม (ไปดูที่ "คนงานรายวัน" แทน)
 * ผูกแบบเดียวกับตาราง: principal.person_id ก่อน ไม่มีค่อยเทียบอีเมล · อ่านไม่ได้ = ว่าง (หน้า HR แสดงทุกคนเหมือนเดิม)
 */
export async function workerEmploymentIds(orgId: string): Promise<Set<string>> {
  const workers = await listWorkerUsers(orgId);
  if (workers.length === 0) return new Set();
  const rows = await withWorkforceTenant(orgId, (tx) =>
    tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT DISTINCT e.id::text AS id
         FROM unnest($1::text[], $2::text[]) AS u(subject, email)
         LEFT JOIN workforce.principals p ON p.subject = u.subject
         JOIN workforce.people pe ON pe.id = p.person_id OR (u.email <> '' AND lower(pe.email) = lower(u.email))
         JOIN workforce.employments e ON e.person_id = pe.id`,
      workers.map((w) => w.userId),
      workers.map((w) => w.email ?? ""),
    ),
  ).catch(() => []);
  return new Set(rows.map((r) => r.id));
}
