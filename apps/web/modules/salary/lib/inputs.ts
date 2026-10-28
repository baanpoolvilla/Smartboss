import "server-only";
import { prisma } from "@smartboss/database";

import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import { applyDiligencePartial, diligenceStep, periodsEmployedBefore, type DiligenceResult } from "./compute";
import { fillSubjectsByEmail } from "./people";
import { loadRequests } from "@/modules/requests/lib/db";
import { hoursText, otCalc } from "@/modules/requests/lib/types";
import { commissionForUser, loadCommissionMonth } from "@/modules/hr/lib/commission-data";
import { loadScorePeriodConfig, loadScorePeriodReadyAt } from "@/lib/score-period-config";
import type { AutoItem, CommissionInput, RecurringItem, SalarySegment } from "./compute";
import { num, ymd, type Tx } from "./db";
import { daysBetweenInclusive, fmtBaht, periodLabel, thaiDate, type AllowanceEntry, type ItemKind, type PayChannel, type SettingsView, type TaxMode } from "./types";

/**
 * ข้อมูลที่ใช้คิดเงินเดือนของหนึ่งงวด — ดึงจากระบบอื่นทั้งหมด ไม่มีใครต้องพิมพ์ซ้ำ:
 *   ระบบบุคคล (workforce): พนักงาน วันเริ่ม/ออก เงินเดือนแบบมีวันมีผล ลาไม่รับค่าจ้าง สาย/ขาด
 *   เบิกจ่าย & OT (requests): OT ที่อนุมัติแล้วยังไม่จ่าย · เบิกล่วงหน้าที่ยังไม่หักคืน
 *   โมดูลนี้ (salary): ข้อมูลรายคน รายการประจำ ยอดสะสมทั้งปีจากรอบที่จ่ายแล้ว
 *
 * คนงานรายวัน (บทบาท WORKER) ไม่อยู่ในเงินเดือน — จ่ายรายวันที่โมดูลคนงาน
 */

export interface StaffInput {
  employmentId: string;
  userId: string | null;
  name: string;
  department: string;
  employeeCode: string;
  hiredOn: string;
  terminatedOn: string | null;
  salary: SalarySegment[];
  unpaidLeaveDays: number;
  late: { minutes: number; count: number };
  absentDays: number;
  ot: (AutoItem & { minutes: number })[];
  /**
   * OT แบบนับวัน: ใบ OT ที่อยู่ในรอบ + ยอดค้าง ณ ตอนคำนวณ (amount — ตรวจซ้ำตอนบันทึกจ่าย) + ยอดที่จ่ายจริงต่อใบ (pay)
   * ไม่มี = OT แบบชั่วโมง (refs มาจาก ot เหมือนเดิม)
   */
  otRefs?: { id: string; amount: number; pay: number }[];
  /** OT แบบนับวัน: จำนวนวัน อัตราต่อวัน (ใช้ในรายงาน) */
  otDaysPay?: { days: number; rate: number; dates: string[] };
  advances: AutoItem[];
  recurring: RecurringItem[];
  commission?: CommissionInput;
  /** ที่มาของค่าคอม Grade + Tier (สตางค์ไม่ปัด) — รายงาน */
  commissionParts?: import("@/modules/hr/lib/commission").CommissionParts;
  diligence?: DiligenceResult;
  profile: {
    ssoExempt: boolean;
    ssoExemptReason: string;
    taxMode: TaxMode;
    taxFixedAmount: number;
    taxNoneReason: string;
    extraAllowance: number;
    allowances: AllowanceEntry[];
    payChannel: PayChannel;
    bankName: string;
    bankAccount: string;
    accountName: string;
    prevIncome: number;
    prevTax: number;
    prevSso: number;
    prevYear: number | null;
  };
  ytd: { taxable: number; tax: number; sso: number; periods: number; gapPeriods: number };
  /** ยอดยกมาที่กรอกไว้ (ใช้ตอนคำนวณงวดนี้) — เก็บลงบรรทัดไว้ให้สลิปแสดงยอดสะสมทั้งปีได้ถูก */
  opening: { income: number; tax: number; sso: number } | null;
  info: { workedDays: number; leaveDays: number; lateCount: number; offDays: number; absentDays: number; otDays: number; otMinutes: number };
  /** มีข้อมูลลงเวลาในงวดไหม (0 = ไม่มีเลย — เบี้ยขยันเช็กสายไม่ได้) */
  attendanceRows: number;
  /** ข้อเตือนจากการดึงข้อมูล (ไม่ใช่จากการคำนวณ) */
  extraWarnings: string[];
}

interface EmpRow {
  employment_id: string;
  employee_code: string;
  employment_type: string;
  hired_on: string;
  terminated_on: string | null;
  subject: string | null;
  email: string | null;
  first_name: string;
  last_name: string;
}

/** ที่มาของรายการประจำบนสลิป: ผ่อนมีกำหนด = "ผ่อนงวดที่ 2/3 (ถึง ธ.ค. 2569)" · ไม่มีกำหนด = "ทุกเดือน ตั้งแต่ ต.ค. 2569" */
function recurringDetail(from: string, to: string | null, period: string, note: string): string {
  const idx = (a: string) => Number(a.slice(0, 4)) * 12 + Number(a.slice(5, 7));
  const base = to
    ? `ผ่อนงวดที่ ${idx(period) - idx(from) + 1}/${idx(to) - idx(from) + 1} (ถึง ${periodLabel(to)})`
    : `ทุกเดือน ตั้งแต่ ${periodLabel(from)}`;
  return note ? `${base} · ${note}` : base;
}

const clampDate = (d: string, lo: string, hi: string) => (d < lo ? lo : d > hi ? hi : d);

export async function loadPeriodInputs(
  tx: Tx,
  orgId: string,
  run: { id: string | null; period: string; startsOn: string; endsOn: string; payDate: string },
  settings?: Pick<SettingsView, "otMode" | "diligenceEnabled" | "diligenceSteps" | "diligencePartial">,
): Promise<{ staff: StaffInput[]; skipped: { name: string; reason: string }[] }> {
  const { startsOn, endsOn, payDate } = run;

  /* ── ระบบบุคคล ── */
  const wf = await withWorkforceTenant(orgId, async (wtx) => {
    const emps = await wtx.$queryRawUnsafe<EmpRow[]>(
      `SELECT e.id::text AS employment_id, e.employee_code, e.employment_type,
              to_char(e.hired_on, 'YYYY-MM-DD') AS hired_on, to_char(e.terminated_on, 'YYYY-MM-DD') AS terminated_on,
              (SELECT p.subject FROM workforce.principals p WHERE p.person_id = e.person_id ORDER BY p.created_at LIMIT 1) AS subject,
              pe.first_name, pe.last_name, pe.email
         FROM workforce.employments e
         JOIN workforce.people pe ON pe.id = e.person_id
        WHERE e.hired_on <= $2::date AND (e.terminated_on IS NULL OR e.terminated_on >= $1::date)`,
      startsOn,
      endsOn,
    );
    const ids = emps.map((e) => e.employment_id);
    if (ids.length === 0) return { emps, comp: [], leaves: [], att: [] };
    const comp = await wtx.$queryRawUnsafe<{ employment_id: string; amount: string; pay_basis: string; effective_from: string; effective_to: string | null }[]>(
      `SELECT employment_id::text AS employment_id, amount::text AS amount, pay_basis,
              to_char(effective_from, 'YYYY-MM-DD') AS effective_from, to_char(effective_to, 'YYYY-MM-DD') AS effective_to
         FROM workforce.compensation_rates
        WHERE employment_id = ANY($1::uuid[]) AND effective_from <= $3::date AND (effective_to IS NULL OR effective_to >= $2::date)
        ORDER BY effective_from`,
      ids,
      startsOn,
      endsOn,
    );
    const leaves = await wtx.$queryRawUnsafe<{ employment_id: string; starts_on: string; ends_on: string; half_day_start: boolean; half_day_end: boolean; paid: boolean; day_off: boolean }[]>(
      `SELECT l.employment_id::text AS employment_id, to_char(l.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(l.ends_on, 'YYYY-MM-DD') AS ends_on,
              l.half_day_start, l.half_day_end, lt.paid,
              -- วันหยุด (Day-Off/Holiday อนุมัติอัตโนมัติ) แยกจากการลา — เกณฑ์เดียวกับปฏิทินทีม (workforce-calendar.ts)
              (lt.auto_approve AND NOT lt.requires_reports) AS day_off
         FROM workforce.leave_requests l
         JOIN workforce.leave_types lt ON lt.id = l.leave_type_id
        WHERE l.status = 'APPROVED' AND l.employment_id = ANY($1::uuid[]) AND l.starts_on <= $3::date AND l.ends_on >= $2::date`,
      ids,
      startsOn,
      endsOn,
    );
    const att = await wtx.$queryRawUnsafe<{ employment_id: string; late: number; early: number; late_days: number; absent_days: number; worked_days: number }[]>(
      `SELECT employment_id::text AS employment_id,
              COALESCE(sum(late_minutes), 0)::int AS late, COALESCE(sum(early_out_minutes), 0)::int AS early,
              count(*) FILTER (WHERE late_minutes > 0)::int AS late_days,
              count(*) FILTER (WHERE absence_minutes > 0 AND actual_in_at IS NULL AND NOT is_on_leave AND NOT is_rest_day AND NOT is_holiday)::int AS absent_days,
              count(*) FILTER (WHERE actual_in_at IS NOT NULL)::int AS worked_days
         FROM workforce.attendance_results
        WHERE is_current AND employment_id = ANY($1::uuid[]) AND work_date BETWEEN $2::date AND $3::date
        GROUP BY employment_id`,
      ids,
      startsOn,
      endsOn,
    );
    return { emps, comp, leaves, att };
  });

  /* ── ผู้ใช้ Smartboss (ชื่อ แผนก คนงาน) ── */
  await fillSubjectsByEmail(orgId, wf.emps);
  const subjects = wf.emps.map((e) => e.subject).filter((s): s is string => !!s);
  const users = subjects.length
    ? await prisma.user.findMany({
        where: { orgId, id: { in: subjects } },
        select: { id: true, name: true, department: { select: { name: true } }, roles: { select: { role: { select: { code: true } } } } },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  /* ── โมดูลนี้ + เบิกจ่าย & OT (transaction ของ salary ตั้ง requests.org_id ให้แล้ว) ── */
  const [profiles, items, empItems, ytdRows] = await Promise.all([
    tx.salaryProfile.findMany({ where: { orgId } }),
    tx.salaryItem.findMany({ where: { orgId } }),
    tx.salaryEmployeeItem.findMany({
      where: { orgId, endedAt: null, fromPeriod: { lte: run.period }, OR: [{ toPeriod: null }, { toPeriod: { gte: run.period } }] },
      orderBy: { createdAt: "asc" },
    }),
    // ยอดสะสมทั้งปีภาษี (ปีของวันจ่าย) จากรอบที่จ่ายแล้วก่อนหน้า — ภาษีคิดตามเงินที่จ่ายจริง
    tx.$queryRawUnsafe<{ employment_id: string; taxable: string; tax: string; sso: string; periods: number }[]>(
      `SELECT l.employment_id, sum(l.taxable)::text AS taxable, sum(l.tax)::text AS tax, sum(l.sso_employee)::text AS sso,
              count(*)::int AS periods
         FROM salary.run_lines l JOIN salary.runs r ON r.id = l.run_id
        WHERE r.org_id = $1 AND r.status = 'paid' AND date_part('year', r.pay_date) = $2 AND r.pay_date < $3::date
          AND ($4::text IS NULL OR r.id <> $4)
        GROUP BY l.employment_id`,
      orgId,
      Number(payDate.slice(0, 4)),
      payDate,
      run.id,
    ),
  ]);
  const profileBy = new Map(profiles.map((p) => [p.employmentId, p]));
  const itemBy = new Map(items.map((i) => [i.id, i]));
  const ytdBy = new Map(ytdRows.map((r) => [r.employment_id, r]));
  const otReqs = await loadRequests(tx, orgId, { kind: "ot", status: "approved", beneficiaryKind: "staff", workDate: { lte: new Date(`${endsOn}T00:00:00Z`) } }, 2000);
  // นับวัน OT ของงวด (สรุปวันทำงานบนสลิป) — รวมใบที่จ่ายไปแล้วทางอื่น ต่างจาก otReqs ที่เอาเฉพาะที่ยังค้างจ่าย
  const otInPeriod = await loadRequests(
    tx,
    orgId,
    { kind: "ot", status: { in: ["approved", "paid"] }, beneficiaryKind: "staff", workDate: { gte: new Date(`${startsOn}T00:00:00Z`), lte: new Date(`${endsOn}T00:00:00Z`) } },
    2000,
  );
  const advReqs = await loadRequests(tx, orgId, { beneficiaryKind: "staff", deductedAt: null, deductAmount: { gt: 0 } }, 2000);
  // เบี้ยขยัน: ขั้นของรอบล่าสุดที่จ่ายแล้ว (ก่อนงวดนี้) ต่อคน — มีรอบที่ยังไม่จ่ายได้ทีละรอบ จึงไม่มีรอบค้างคั่นกลาง
  const prevDiligence = new Map<string, number>();
  if (settings?.diligenceEnabled) {
    const rows = await tx.$queryRawUnsafe<{ employment_id: string; amount: string | null; has: boolean }[]>(
      `SELECT DISTINCT ON (l.employment_id) l.employment_id,
              (l.info->'diligence'->>'amount') AS amount, (l.info ? 'diligence') AS has
         FROM salary.run_lines l JOIN salary.runs r ON r.id = l.run_id
        WHERE r.org_id = $1 AND r.status = 'paid' AND r.period < $2 AND l.info ? 'diligence'
        ORDER BY l.employment_id, r.period DESC`,
      orgId,
      run.period,
    );
    for (const r of rows) if (r.amount !== null && Number.isFinite(Number(r.amount))) prevDiligence.set(r.employment_id, Number(r.amount));
  }

  /* ── ค่าคอม Pool ตามเกรด (ระบบบุคคล › พนักงาน › ค่าคอม) — เดือนเดียวกับงวด ── */
  const commission = await loadCommissionFor(orgId, run.period, items);

  const staff: StaffInput[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const e of wf.emps) {
    const user = e.subject ? userById.get(e.subject) : undefined;
    const name = user?.name ?? `${e.first_name} ${e.last_name}`.trim();
    if (user?.roles.some((r) => r.role.code === "WORKER")) continue; // คนงานรายวัน — โมดูลคนงาน
    const monthly = wf.comp.filter((c) => c.employment_id === e.employment_id && c.pay_basis === "MONTHLY");
    const otherBasis = wf.comp.some((c) => c.employment_id === e.employment_id && c.pay_basis !== "MONTHLY");
    if (monthly.length === 0 && (otherBasis || e.employment_type !== "MONTHLY")) continue; // รายวัน/รายชั่วโมง ไม่ใช่เงินเดือน

    // ช่วงที่ทำงานอยู่ในงวด
    const from = clampDate(e.hired_on, startsOn, endsOn);
    // terminated_on = วันทำงานวันสุดท้าย (รวมวันนั้น)
    const to = e.terminated_on ? clampDate(e.terminated_on, startsOn, endsOn) : endsOn;
    const segments: SalarySegment[] = monthly
      .map((c) => {
        const segFrom = c.effective_from > from ? c.effective_from : from;
        const segTo = c.effective_to && c.effective_to < to ? c.effective_to : to;
        return { monthly: Number(c.amount), from: segFrom, to: segTo };
      })
      .filter((g) => g.from <= g.to);

    // ลาไม่รับค่าจ้าง เฉพาะวันที่ลง (และอยู่ในช่วงที่ทำงาน)
    let unpaid = 0;
    let leaveDays = 0;
    let offDays = 0;
    for (const l of wf.leaves.filter((x) => x.employment_id === e.employment_id)) {
      const a = l.starts_on > from ? l.starts_on : from;
      const b = l.ends_on < to ? l.ends_on : to;
      if (a > b) continue;
      let d = daysBetweenInclusive(a, b);
      if (l.half_day_start && a === l.starts_on) d -= 0.5;
      if (l.half_day_end && b === l.ends_on && !(l.starts_on === l.ends_on && l.half_day_start)) d -= 0.5;
      d = Math.max(0, d);
      leaveDays += d;
      if (l.day_off) offDays += d;
      if (!l.paid) unpaid += d;
    }
    const att = wf.att.find((x) => x.employment_id === e.employment_id);

    const p = profileBy.get(e.employment_id);
    const year = Number(payDate.slice(0, 4));
    // ยอดยกมาใช้เมื่อปีตรงและมีตัวเลขจริง (ล้างเป็น 0 หมด = ไม่ได้กรอก → ระบบประมาณให้ ไม่ใช่ถือว่าไม่มีรายได้)
    const prevApplies = p?.prevYear === year && (num(p?.prevIncome) > 0 || num(p?.prevTax) > 0 || num(p?.prevSso) > 0);
    const y = ytdBy.get(e.employment_id);

    const mine = (r: { employmentId: string | null; beneficiaryUserId: string | null }) =>
      r.employmentId === e.employment_id || (!r.employmentId && !!e.subject && r.beneficiaryUserId === e.subject);
    const ot = otReqs
      .filter(mine)
      .map((r) => {
        const remaining = Math.round((r.netAmount - r.paidTotal) * 100) / 100;
        return {
          refId: r.id,
          code: r.code,
          label: "ค่าล่วงเวลา (OT)",
          amount: remaining,
          minutes: r.otMinutes ?? 0,
          detail: `${r.code} · ${thaiDate(r.workDate, false)} ${r.otStart ?? ""}–${r.otEnd ?? ""} · ${hoursText(r.otMinutes ?? 0)} × ${r.otPercent ?? ""}%`,
          ...(r.otBase && r.otPercent && r.otMinutes
            ? { formula: `${otCalc(r.otBaseKind === "daily" ? "daily" : "monthly", r.otBase, r.otPercent, r.otMinutes).formula}${remaining < r.netAmount ? ` (จ่ายไปแล้ว ${r.paidTotal.toFixed(2)} เหลือ ${remaining.toFixed(2)})` : ""}` }
            : {}),
        };
      })
      .filter((o) => o.amount > 0);
    const advances = advReqs
      .filter(mine)
      .map((r) => ({
        refId: r.id,
        code: r.code,
        label: r.kind === "advance" ? "หักคืนเงินเบิกล่วงหน้า" : "หักเงินเบิกไปก่อนที่ไม่ได้คืน",
        amount: r.deductAmount,
        detail: `${r.code} · ${r.kind === "advance" ? "เบิกล่วงหน้า" : "เบิกเงินไปซื้อของ"} ${thaiDate(r.workDate, false)}`,
      }));
    const recurring: RecurringItem[] = empItems
      .filter((x) => x.employmentId === e.employment_id)
      .map((x) => {
        const it = itemBy.get(x.itemId);
        return {
          refId: x.id,
          name: it?.name ?? "รายการ",
          kind: (it?.kind ?? "earning") as ItemKind,
          amount: num(x.amount),
          taxable: it?.taxable ?? true,
          ssoBase: it?.ssoBase ?? false,
          detail: recurringDetail(x.fromPeriod, x.toPeriod, run.period, x.note),
        };
      });

    // OT แบบนับวัน (ข้อกำหนด HR 28/10/2569): ปัดขึ้น(ฐานเงินเดือน ÷ 30) × จำนวนวันที่มีใบ OT อนุมัติแล้วยังไม่จ่าย
    // หลายใบวันเดียวกัน = 1 วัน · ยอดต่อใบที่ปิดตอนบันทึกจ่าย: ใบแรกของวันได้ค่าวัน (หักที่เคยจ่ายวันนั้นไปแล้ว) ใบอื่นของวันเดียวกัน 0
    let otItems = ot;
    let otRefs: StaffInput["otRefs"];
    let otDaysPay: StaffInput["otDaysPay"];
    if (settings?.otMode === "days" && ot.length > 0 && segments.length > 0) {
      const base = segments[segments.length - 1]!.monthly;
      const rate = Math.ceil(Math.round((base / 30) * 1e6) / 1e6);
      const mineOt = otReqs.filter(mine).filter((r) => Math.round((r.netAmount - r.paidTotal) * 100) / 100 > 0);
      const byDate = new Map<string, typeof mineOt>();
      for (const r of mineOt) byDate.set(r.workDate, [...(byDate.get(r.workDate) ?? []), r]);
      const dates = [...byDate.keys()].sort();
      otRefs = [];
      let total = 0;
      for (const d of dates) {
        const list = byDate.get(d)!.sort((a, b) => a.code.localeCompare(b.code));
        // วันนั้นเคยจ่ายไปแล้วบางส่วน (ใบที่จ่ายบางส่วนนอกเงินเดือน) — จ่ายส่วนที่เหลือของค่าวัน
        const paidBefore = list.reduce((n, r) => n + r.paidTotal, 0);
        const dayPay = Math.max(0, Math.round((rate - paidBefore) * 100) / 100);
        list.forEach((r, i) => otRefs!.push({ id: r.id, amount: Math.round((r.netAmount - r.paidTotal) * 100) / 100, pay: i === 0 ? dayPay : 0 }));
        total += dayPay;
      }
      total = Math.round(total * 100) / 100;
      otDaysPay = { days: dates.length, rate, dates };
      const exact = Math.round((base / 30) * 100) / 100;
      otItems = [
        {
          refId: "ot-days",
          code: mineOt.map((r) => r.code).join(", "),
          label: "ค่าล่วงเวลา (OT)",
          amount: total,
          minutes: mineOt.reduce((n, r) => n + (r.otMinutes ?? 0), 0),
          detail: `${dates.length} วัน × ${fmtBaht(rate)} (ปัดขึ้น เงินเดือน ${fmtBaht(base)} ÷ 30 = ${fmtBaht(exact)}) · ${dates.map((d) => thaiDate(d, false)).join(", ")}`,
          formula: `ปัดขึ้น(${fmtBaht(base)} ÷ 30) = ${fmtBaht(rate)} บาท/วัน × ${dates.length} วัน = ${fmtBaht(total)} · ใบ OT: ${mineOt.map((r) => r.code).join(", ")}`,
        },
      ].filter((o) => o.amount > 0);
    }

    // เบี้ยขยัน: ลาจริง (ไม่นับวันหยุด) · สาย (วันที่มีนาทีสาย) · ขาด จากระบบลงเวลา
    let diligence: DiligenceResult | undefined;
    const p0 = profileBy.get(e.employment_id);
    if (settings?.diligenceEnabled && (p0?.diligenceEligible ?? true) && segments.length > 0) {
      const fromRun = prevDiligence.get(e.employment_id);
      const opening = p0?.diligenceOpening !== null && p0?.diligenceOpening !== undefined ? num(p0.diligenceOpening) : null;
      const prev = fromRun ?? opening;
      diligence = diligenceStep(settings.diligenceSteps, prev, fromRun !== undefined ? "run" : opening !== null ? "opening" : "none", {
        leaveDays: Math.max(0, leaveDays - offDays),
        lateCount: att?.late_days ?? 0,
        absentDays: att?.absent_days ?? 0,
      });
      // เข้างาน/ลาออกกลางรอบ (from/to = ช่วงที่ทำงานอยู่ในงวด)
      diligence = applyDiligencePartial(diligence, settings.diligencePartial ?? "none", daysBetweenInclusive(from, to), daysBetweenInclusive(startsOn, endsOn));
    }

    // ไม่มีเงินเดือนที่มีผลในงวด = ไม่อยู่ในรอบ (ขึ้นเตือนให้ใส่เงินเดือน) — ไม่จ่าย 0 บาทเงียบ ๆ
    if (segments.length === 0) {
      skipped.push({ name, reason: monthly.length === 0 ? "ยังไม่มีเงินเดือนในระบบ" : "เงินเดือนยังไม่มีผลในงวดนี้" });
      continue;
    }

    staff.push({
      employmentId: e.employment_id,
      userId: e.subject,
      name,
      department: user?.department?.name ?? "",
      employeeCode: e.employee_code,
      hiredOn: e.hired_on,
      terminatedOn: e.terminated_on,
      salary: segments,
      unpaidLeaveDays: unpaid,
      late: { minutes: (att?.late ?? 0) + (att?.early ?? 0), count: att?.late_days ?? 0 },
      absentDays: att?.absent_days ?? 0,
      ot: otItems,
      ...(otRefs ? { otRefs, otDaysPay } : {}),
      ...(diligence ? { diligence } : {}),
      advances,
      recurring,
      commission: commission && e.subject ? commission.forUser(e.subject) : undefined,
      commissionParts: commission && e.subject ? commission.partsFor(e.subject) : undefined,
      profile: {
        ssoExempt: p?.ssoExempt ?? false,
        ssoExemptReason: p?.ssoExemptReason ?? "",
        taxMode: (p?.taxMode ?? "auto") as TaxMode,
        taxFixedAmount: num(p?.taxFixedAmount),
        taxNoneReason: p?.taxNoneReason ?? "",
        extraAllowance: num(p?.extraAllowance),
        allowances: ((p?.allowances as unknown as AllowanceEntry[] | undefined) ?? []),
        payChannel: (p?.payChannel ?? "transfer") as PayChannel,
        bankName: p?.bankName ?? "",
        bankAccount: p?.bankAccount ?? "",
        accountName: p?.accountName ?? "",
        prevIncome: num(p?.prevIncome),
        prevTax: num(p?.prevTax),
        prevSso: num(p?.prevSso),
        prevYear: p?.prevYear ?? null,
      },
      ytd: {
        taxable: num(y?.taxable) + (prevApplies ? num(p?.prevIncome) : 0),
        tax: num(y?.tax) + (prevApplies ? num(p?.prevTax) : 0),
        sso: num(y?.sso) + (prevApplies ? num(p?.prevSso) : 0),
        periods: y?.periods ?? 0,
        // กรอกยอดยกมาแล้ว = ถือว่าครบ · ไม่กรอก = นับงวดที่ทำงานอยู่แต่ไม่มีข้อมูล ให้ภาษีประมาณแทน
        gapPeriods: prevApplies ? 0 : Math.max(0, periodsEmployedBefore(e.hired_on, payDate, Number(endsOn.slice(8, 10))) - (y?.periods ?? 0)),
      },
      opening: prevApplies ? { income: num(p?.prevIncome), tax: num(p?.prevTax), sso: num(p?.prevSso) } : null,
      attendanceRows: att ? 1 : 0,
      extraWarnings: [
        ...(commission?.gradeTier && (!e.subject || !commission.anyMember(e.subject)) ? ["ไม่มีผล Grade ในรอบนี้ — ไม่ได้ค่าคอม (ตรวจว่าผูกบัญชีผู้ใช้และอยู่ในคะแนนผลงาน)"] : []),
        ...(diligence && !att ? ["ไม่มีข้อมูลลงเวลาในงวดนี้ — เบี้ยขยันเช็กมาสาย/ขาดไม่ได้ ตรวจก่อนส่ง"] : []),
      ],
      info: {
        workedDays: att?.worked_days ?? 0,
        leaveDays,
        lateCount: att?.late_days ?? 0,
        offDays,
        absentDays: att?.absent_days ?? 0,
        otDays: new Set(otInPeriod.filter(mine).map((r) => r.workDate)).size,
        otMinutes: otInPeriod.filter(mine).reduce((sum, r) => sum + (r.otMinutes ?? 0), 0),
      },
    });
  }
  staff.sort((a, b) => a.name.localeCompare(b.name, "th"));
  return { staff, skipped };
}

export { ymd };

/**
 * ค่าคอมของเดือน (YYYY-MM เดียวกับงวด) ตามวิธีที่บริษัทเลือกในแท็บค่าคอมของระบบบุคคล
 * (Pool ÷ ตัวคูณ · % ของเงินเดือน · บาทต่อเกรด · ไม่คิด) และเฉพาะคนที่ได้ค่าคอม
 * ไม่คิด / Pool ไม่ได้ใส่ = ไม่มีบรรทัด ไม่เตือน
 * เกรดยังไม่ปิด (ก่อนเวลาพร้อมใช้) → ไม่ใส่ยอด แต่เตือนให้กด "ดึงข้อมูลใหม่" หลังเกรดปิด (ตัวเลขยังเปลี่ยนได้)
 * ภาษี/ประกันสังคมตามรายการชื่อ "คอมมิชชั่น" ในตั้งค่า (ไม่มี = คิดทั้งคู่)
 */
async function loadCommissionFor(orgId: string, month: string, items: { name: string; kind: string; taxable: boolean; ssoBase: boolean }[]) {
  const data = await loadCommissionMonth(orgId, month);
  if (data.method === "off" || (data.method === "pool" && (!data.pool || data.pool.satang <= 0))) return null;
  const gradeTier = data.method === "grade_tier";
  const config = await loadScorePeriodConfig(orgId);
  const readyAt = await loadScorePeriodReadyAt(orgId, config, month);
  const label = periodLabel(month);
  const flags = items.find((i) => i.kind === "earning" && i.name.trim() === "คอมมิชชั่น");
  const taxable = flags?.taxable ?? true;
  const ssoBase = flags?.ssoBase ?? true;
  const pending =
    Date.now() < readyAt.getTime()
      ? `ค่าคอม ${label} ยังไม่ใส่ — เกรดยังไม่ปิด (พร้อม ${readyAt.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} น.) · กด "ดึงข้อมูลใหม่" หลังจากนั้น`
      : // อ่านทะเบียนพนักงานไม่ได้ → รายชื่อถอยไปเป็นผู้ใช้ทุกคน (CEO/คนที่ลาออก) แบ่ง Pool ผิดคนเงียบ ๆ — ไม่ใส่ยอดจนอ่านได้
        (data.method === "pool" || data.method === "grade_tier") && data.registry === "all-users"
        ? `ค่าคอม ${label} ยังไม่ใส่ — อ่านทะเบียนพนักงานไม่ได้ (ระบบบุคคลไม่ตอบ) ถ้าแบ่ง Pool ตอนนี้จะหารให้คนที่ไม่ได้อยู่ในทะเบียน · กด "ดึงข้อมูลใหม่" อีกครั้ง`
        : null;
  const lineLabel = gradeTier ? "ค่าคอม (Grade + Tier)" : undefined;
  return {
    forUser: (userId: string): CommissionInput | undefined => {
      const m = data.members.find((x) => x.userId === userId);
      if (!m || !m.eligible) return undefined;
      // Grade + Tier: เกรดยังไม่ปิด = ตัวเลขยังเปลี่ยนได้ → ห้ามสรุปรอบ (ไม่ใช่แค่เตือนแบบวิธีอื่น)
      if (pending) return gradeTier ? { amount: 0, detail: "", taxable, ssoBase, block: pending, label: lineLabel } : { amount: 0, detail: "", taxable, ssoBase, pending };
      const c = commissionForUser(data, userId, label);
      if (!c) return undefined;
      if (c.kind === "blocked") return { amount: 0, detail: "", taxable, ssoBase, block: c.reason, label: lineLabel };
      return c.kind === "percent" ? { amount: 0, percent: c.percent, detail: c.detail, taxable, ssoBase } : { amount: c.satang / 100, detail: c.detail, taxable, ssoBase, label: lineLabel };
    },
    partsFor: (userId: string) => {
      if (!gradeTier || pending) return undefined;
      const c = commissionForUser(data, userId, label);
      return c?.kind === "amount" ? c.parts : undefined;
    },
    gradeTier,
    hasMember: (userId: string) => data.members.some((x) => x.userId === userId && x.eligible),
    anyMember: (userId: string) => data.members.some((x) => x.userId === userId),
  };
}
