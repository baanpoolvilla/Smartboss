import "server-only";
import { prisma } from "@smartboss/database";

import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import { WORKER_ROLE_CODE } from "../permissions";
import {
  DEFAULT_OT_PERCENT,
  dayPay,
  daysInMonth,
  hmToMin,
  judgeDay,
  judgeTimes,
  minutesToHm,
  type DayCell,
  type DwSettings,
  type MonthData,
  type OtEntry,
  type OverrideEntry,
  type PayRateEntry,
  type TimeEditEntry,
  type WorkerMonth,
} from "./types";

/**
 * ข้อมูลของโมดูลคนงานรายวัน — อ่านตรงจากตารางของ workforce ด้วย tenant context ของบริษัท (withWorkforceTenant)
 * เพื่อให้คนที่มีแค่สิทธิ์ "ดูคนงาน" (ไม่มีสิทธิ์ HR) เปิดตารางได้ · หน้าเว็บตรวจสิทธิ์ Smartboss ก่อนเรียกเสมอ
 *
 * กติกาของคนงาน (เฉพาะบทบาท WORKER — พนักงานประจำใช้กติกาเดิม) — ผู้ใช้กำหนดใหม่ 19/10/2569:
 *   - ลงเข้าหลังเวลาเข้ากะ (ระดับนาที ไม่มีผ่อนผัน) = สาย หักเงินตามนาที
 *   - ลงเข้าแต่ไม่ลงออกในวันนั้น = ขาด (ไม่ได้ค่าแรง) · ออกก่อนเลิกกะ = กลับก่อน หักตามนาทีเหมือนสาย
 *   - วันละ 8 ชม. (พักเที่ยง 12–13 ไม่นับ) · หักนาทีละ ค่าแรงวัน÷480 · OT = ชม. × ค่าแรง÷8 × % (ตั้งค่าได้)
 *   - ค่าแรงรายวันมาจากระบบบุคคล (เงินเดือนแบบรายวัน compensation_rates DAILY) ตามวันที่มีผล
 *   - ผู้ดูแลแก้เวลาเข้า/ออกได้พร้อมเหตุผล (ไปหน้างานมา สแกนไม่ทัน) — store daily-worker-time-edits
 *   - วันที่มี OT ที่ผู้ดูแลลงไว้ไม่ดูเวลาออก (ไม่ลงออก/ออกก่อนก็ไม่ขาด ไม่หัก)
 *   - ไม่ลงเวลาและไม่ได้ลงหยุด = ไม่มา · วันหยุดนักขัตฤกษ์ไม่มีสำหรับคนงาน (ถือเป็นวันทำงาน)
 *   - "แก้เป็นมา" แบบเดิม (store daily-worker-overrides) ยังมีผล = ไม่หักสาย / มาเต็มวัน
 */

export const OT_KEY = "daily-worker-ot";
export const OVERRIDE_KEY = "daily-worker-overrides";
export const TIME_EDIT_KEY = "daily-worker-time-edits";
export const SETTINGS_KEY = "daily-worker-settings";
export const PAY_KEY = "daily-worker-pay";

export async function readPayRates(orgId: string) {
  const { data } = await readStore<PayRateEntry[]>(orgId, PAY_KEY);
  return data ?? [];
}

export async function readTimeEdits(orgId: string) {
  const { data } = await readStore<TimeEditEntry[]>(orgId, TIME_EDIT_KEY);
  return data ?? [];
}
export async function readDwSettings(orgId: string): Promise<DwSettings> {
  const { data } = await readStore<Partial<DwSettings>>(orgId, SETTINGS_KEY);
  const p = Number(data?.otPercent);
  return { otPercent: Number.isFinite(p) && p > 0 ? p : DEFAULT_OT_PERCENT };
}

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
  has_shift: boolean;
  /** กะของวันนั้นจริง (นาทีจากเที่ยงคืน เวลาไทย) — เปลี่ยนกะกลางเดือนแล้ววันก่อนหน้ายังใช้กะเดิม */
  sched_in: number | null;
  /** ความยาวกะ (นาที) — ข้ามคืนได้ */
  sched_len: number | null;
}
interface WageRow {
  employment_id: string;
  amount: string;
  effective_from: string;
  effective_to: string | null;
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
      ? { employments: [] as EmploymentRow[], results: [] as ResultRow[], leaves: [] as LeaveRow[], dayOffTypeId: null as string | null, shifts: [] as { id: string; name: string; start_minutes: number; end_minutes: number }[], firstIn: [] as { employment_id: string; day: string }[], wages: [] as WageRow[] }
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
          if (ids.length === 0) return { employments, results: [], leaves: [], dayOffTypeId: null, shifts: [], firstIn: [], wages: [] as WageRow[] };
          // วันแรกที่ลงเวลาจริงของแต่ละคน (ทั้งประวัติ) — ก่อนวันนั้นไม่นับ "ไม่มา" (ยังไม่เริ่มใช้ระบบ/ยังไม่เริ่มงาน)
          const firstIn = await tx.$queryRawUnsafe<{ employment_id: string; day: string }[]>(
            `SELECT employment_id::text AS employment_id, to_char(min(work_date), 'YYYY-MM-DD') AS day
               FROM workforce.attendance_results
              WHERE is_current AND actual_in_at IS NOT NULL AND employment_id = ANY($1::uuid[])
              GROUP BY employment_id`,
            ids,
          );
          const results = await tx.$queryRawUnsafe<ResultRow[]>(
            `SELECT ar.employment_id::text AS employment_id, to_char(ar.work_date, 'YYYY-MM-DD') AS day,
                    to_char(ar.actual_in_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS in_hm,
                    to_char(ar.actual_out_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS out_hm,
                    (ar.actual_in_at IS NOT NULL AND ar.scheduled_in_at IS NOT NULL
                       AND date_trunc('minute', ar.actual_in_at) > ar.scheduled_in_at) AS late,
                    (ar.actual_out_at IS NOT NULL AND ar.scheduled_out_at IS NOT NULL
                       AND date_trunc('minute', ar.actual_out_at) < ar.scheduled_out_at) AS early,
                    ar.is_rest_day AS rest_day, ar.worked_minutes, (ar.shift_id IS NOT NULL) AS has_shift,
                    (EXTRACT(HOUR FROM ar.scheduled_in_at AT TIME ZONE 'Asia/Bangkok') * 60
                       + EXTRACT(MINUTE FROM ar.scheduled_in_at AT TIME ZONE 'Asia/Bangkok'))::int AS sched_in,
                    (EXTRACT(EPOCH FROM (ar.scheduled_out_at - ar.scheduled_in_at)) / 60)::int AS sched_len
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
          // ค่าแรงรายวันที่มีผลในเดือนนี้ (HR → พนักงาน → เงินเดือน แบบรายวัน) — ปรับกลางเดือนได้หลายช่วง
          const wages = await tx
            .$queryRawUnsafe<WageRow[]>(
              `SELECT employment_id::text AS employment_id, amount::text AS amount,
                      to_char(effective_from, 'YYYY-MM-DD') AS effective_from, to_char(effective_to, 'YYYY-MM-DD') AS effective_to
                 FROM workforce.compensation_rates
                WHERE pay_basis = 'DAILY' AND employment_id = ANY($1::uuid[])
                  AND effective_from <= $3::date AND (effective_to IS NULL OR effective_to >= $2::date)
                ORDER BY effective_from DESC`,
              ids,
              from,
              to,
            );
          return { employments, results, leaves, dayOffTypeId: types[0]?.id ?? null, shifts, firstIn, wages };
        });

  const [{ list: ot }, { list: overrides }, edits, settings, rates] = await Promise.all([
    readOt(orgId),
    readOverrides(orgId),
    readTimeEdits(orgId),
    readDwSettings(orgId),
    readPayRates(orgId),
  ]);
  // เรทที่ตั้งในโมดูลนี้ (ล่าสุดที่เริ่มก่อน/ตรงวันนั้น) — ไม่มีค่อยใช้เงินเดือนแบบรายวันในระบบบุคคล
  const rateOn = (employmentId: string, date: string): PayRateEntry | null =>
    rates
      .filter((r) => r.employmentId === employmentId && r.from <= date)
      .sort((a, b) => (a.from === b.from ? b.at.localeCompare(a.at) : b.from.localeCompare(a.from)))[0] ?? null;
  const wageOn = (employmentId: string, date: string): number | null => {
    const own = rateOn(employmentId, date);
    if (own) return own.dailyWage;
    const w = wf.wages.find((r) => r.employment_id === employmentId && r.effective_from <= date && (!r.effective_to || r.effective_to >= date));
    return w ? Number(w.amount) : null;
  };
  const otPercentOn = (employmentId: string, date: string): number => rateOn(employmentId, date)?.otPercent ?? settings.otPercent;
  const empBySubject = new Map(wf.employments.map((e) => [e.subject, e]));
  const firstInByEmp = new Map(wf.firstIn.map((f) => [f.employment_id, f.day]));

  // วันอ้างอิงของ "ค่าแรงตอนนี้" — เดือนนี้ = วันนี้ · เดือนก่อน = สิ้นเดือนนั้น · เดือนหน้า = วันที่ 1
  const refDay = today < from ? from : today > to ? to : today;
  const rows: WorkerMonth[] = workers.map((w) => {
    const emp = empBySubject.get(w.userId) ?? null;
    const cells: Record<number, DayCell> = {};
    if (emp) {
      const res = new Map(wf.results.filter((r) => r.employment_id === emp.employment_id).map((r) => [r.day, r]));
      // ยังไม่เคยลงเวลาเลย = ยังไม่เริ่ม ไม่นับไม่มาสักวัน · เริ่มแล้ว = นับตั้งแต่วันแรกที่ลงเวลา
      const started = firstInByEmp.get(emp.employment_id) ?? null;
      for (let d = 1; d <= total; d++) {
        const date = `${month}-${String(d).padStart(2, "0")}`;
        const cell: DayCell = { s: "" };
        const r = res.get(date);
        const leave = wf.leaves.find((l) => l.employment_id === emp.employment_id && l.starts_on <= date && l.ends_on >= date);
        const otEntry = ot.find((o) => o.employmentId === emp.employment_id && o.date === date);
        const ov = overrides.find((o) => o.employmentId === emp.employment_id && o.date === date);
        const ed = edits.find((e) => e.employmentId === emp.employment_id && e.date === date);
        // เวลาที่ใช้คิด = ที่ผู้ดูแลแก้ (ถ้ามี) ไม่งั้นเวลาที่สแกนจริง
        const inAt = ed?.inAt ?? r?.in_hm ?? null;
        const outAt = ed?.outAt ?? r?.out_hm ?? null;
        if (ed) {
          cell.edit = { inAt: ed.inAt, outAt: ed.outAt, scannedIn: r?.in_hm ?? null, scannedOut: r?.out_hm ?? null, reason: ed.reason, byName: ed.byName, at: ed.at };
        }
        // กะของวันนั้น (จากผลลงเวลาของวันนั้น) ก่อน ไม่มีค่อยใช้กะปัจจุบัน — เปลี่ยนกะกลางเดือนแล้ววันเก่าไม่ถูกตัดสินด้วยกะใหม่
        const dayStart = r?.sched_in ?? emp.shift_start;
        const dayEnd = r?.sched_in != null && r.sched_len != null ? r.sched_in + r.sched_len : emp.shift_end;
        if (inAt) {
          cell.inAt = inAt;
          if (outAt) cell.outAt = outAt;
          const j = judgeDay({
            date,
            today,
            inAt,
            outAt,
            shiftStart: dayStart,
            shiftEnd: dayEnd,
            otMinutes: otEntry?.minutes ?? null,
            legacyOverride: !!ov,
            wage: wageOn(emp.employment_id, date),
            otPercent: otPercentOn(emp.employment_id, date),
          });
          cell.s = j.s;
          if (j.lateMin > 0) cell.lateMin = j.lateMin;
          if (j.earlyMin > 0) {
            cell.early = true;
            cell.earlyMin = j.earlyMin;
          }
          if (j.s !== "x") cell.workedMin = j.workedMin;
          if (j.pay) cell.pay = j.pay;
          if (ov && r?.late) cell.override = { reason: ov.reason, byName: ov.byName, at: ov.at };
        } else if (leave) {
          cell.s = leave.is_day_off ? "o" : "l";
        } else if (r?.rest_day) {
          cell.s = "r";
        } else if (ov) {
          // ไม่ได้ลงเวลา (ลืมลง/ลงไม่ติด) แต่ผู้ดูแลยืนยันว่ามา (แบบเดิม) = มาเต็มวัน
          cell.s = "m";
          cell.override = { reason: ov.reason, byName: ov.byName, at: ov.at };
          const wage = wageOn(emp.employment_id, date);
          if (wage !== null) cell.pay = dayPay(wage, 0, otEntry?.minutes ?? 0, otPercentOn(emp.employment_id, date));
        } else if (date < today) {
          // "ไม่มา" เฉพาะวันที่มีกะจริงในวันนั้น — ก่อนเริ่มกะ/ก่อนเริ่มงานไม่นับ (เจอจริง: 9–14 ต.ค. ขึ้นไม่มา ทั้งที่กะเริ่ม 15)
          cell.s = r?.has_shift && started !== null && date >= started ? "n" : "";
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
      startedOn: emp ? (firstInByEmp.get(emp.employment_id) ?? null) : null,
      employmentId: emp?.employment_id ?? null,
      employeeCode: emp?.employee_code ?? null,
      shiftId: emp?.shift_id ?? null,
      shiftName: emp?.shift_name ?? null,
      shiftStart: emp?.shift_start ?? null,
      shiftEnd: emp?.shift_end ?? null,
      shiftFrom: emp?.shift_from && emp.shift_from > today ? emp.shift_from : null,
      // ค่าแรงที่มีผลวันนี้ (ดูเดือนก่อน = ณ สิ้นเดือนนั้น)
      dailyWage: emp ? wageOn(emp.employment_id, refDay) : null,
      otPercent: emp ? (rateOn(emp.employment_id, refDay)?.otPercent ?? null) : null,
      cells,
    };
  });

  const unlinkedUserIds = wf.employments.filter((e) => !e.linked).map((e) => e.subject);
  return { month, days: total, today, unlinkedUserIds, workers: rows, otPercent: settings.otPercent, dayOffTypeId: wf.dayOffTypeId, shifts: wf.shifts.map((s) => ({ id: s.id, name: s.name, start: s.start_minutes, end: s.end_minutes })) };
}

/** สรุปของคนหนึ่งในเดือนนั้น — ใช้ทั้งตารางสรุป, Excel และหน้า "เดือนนี้ของฉัน" */
export function summarize(w: WorkerMonth) {
  let present = 0, late = 0, lateMin = 0, absent = 0, early = 0, earlyMin = 0, noShow = 0, off = 0, leave = 0, otMinutes = 0;
  let wage = 0, deduct = 0, otPay = 0, total = 0, paidDays = 0, unpaidDays = 0;
  for (const c of Object.values(w.cells)) {
    if (c.s === "m" || c.s === "s") present++;
    if (c.s === "s") late++;
    lateMin += c.lateMin ?? 0;
    if (c.s === "x") absent++;
    if (c.early) early++;
    earlyMin += c.earlyMin ?? 0;
    if (c.s === "n") noShow++;
    if (c.s === "o") off++;
    if (c.s === "l") leave++;
    if (c.ot) otMinutes += c.ot.minutes;
    if (c.pay) {
      paidDays++;
      wage += c.pay.wage;
      deduct += c.pay.deduct;
      otPay += c.pay.ot;
      total += c.pay.total;
    } else if (c.s === "m" || c.s === "s") {
      // มาแต่คิดเงินไม่ได้ (ยังไม่ตั้งค่าแรง / วันนี้ยังไม่ลงออก)
      unpaidDays++;
    }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    present, late, lateMin, absent, early, earlyMin, noShow, off, leave, otMinutes,
    pay: { wage: r2(wage), deduct: r2(deduct), ot: r2(otPay), total: r2(total), paidDays, unpaidDays },
  };
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
  /** m=มาตรงเวลา s=สาย x=ขาด (ไม่ลงออก) n=ไม่มา o=หยุด l=ลา r=หยุดกะ w=ยังไม่มา (วันนี้ ยังไม่ถึงเลิกกะ) ns=ยังไม่ผูกกะ */
  status: "m" | "s" | "x" | "n" | "o" | "l" | "r" | "w" | "ns" | "none";
  early: boolean;
  lateMin: number;
  cell: DayCell | null;
}

/**
 * ลงเวลาของคนงานวันเดียว — เวลาเข้า/ออกอ่านจากการลงเวลาจริง (raw_time_events) ทันที ไม่ต้องรอระบบคำนวณผล
 * สถานะใช้กติกาเดียวกับตาราง (เข้าหลังเวลาเข้ากะ = สาย · ไม่ลงออก = ขาด · ออกก่อนเลิกกะ = กลับก่อน · OT ที่ลงไว้ไม่ดูเวลาออก)
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
      if (cell?.s === "m" || cell?.s === "s" || cell?.s === "x") status = cell.s;
      else if (w.shiftStart === null) status = "m";
      else status = toMin(inAt) > w.shiftStart % 1440 ? "s" : "m";
    } else if (!w.shiftId) status = "ns";
    // วันก่อนหน้า: ไม่มา เฉพาะวันที่มีกะจริง (ก่อนเริ่มกะ = ไม่มีกะวันนั้น)
    else if (date < month.today) status = cell?.s === "n" ? "n" : "none";
    else if (date > month.today) status = "w";
    // ยังไม่เคยลงเวลาเลย = ยังไม่เริ่ม — เลิกกะแล้วก็ยังไม่นับไม่มา
    else status = w.startedOn !== null && w.shiftEnd !== null && toMin(nowHm) > w.shiftEnd % 1440 ? "n" : "w";
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
      lateMin: cell?.lateMin ?? (status === "s" && inAt && w.shiftStart !== null ? judgeTimes(w.shiftStart, w.shiftEnd ?? w.shiftStart, toMin(inAt), null).lateMin : 0),
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
