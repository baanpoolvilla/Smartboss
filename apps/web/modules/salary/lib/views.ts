import "server-only";
import { prisma } from "@smartboss/database";

import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import { fillSubjectsByEmail } from "./people";
import { isNewHire, loadProbationFrom } from "./probation";
import type { Adjustment, PayLine } from "./compute";
import { num, readRates, ymd, withSalaryTenant, type Tx } from "./db";
import { previousPaid, type ExcludedEntry, type LineInfo, type RunTotals } from "./run";
import { DEFAULT_SSO, bangkokToday, rateOn, type AllowanceEntry, type PayChannel, type RunStatus, type SsoParams, type TaxMode } from "./types";

/** ข้อมูลสำหรับหน้าจอ — อ่านอย่างเดียว ผ่าน RLS ของบริษัทเสมอ */

export interface RunRow {
  id: string;
  period: string;
  startsOn: string;
  endsOn: string;
  payDate: string;
  status: RunStatus;
  totals: RunTotals;
  paidOn: string | null;
}

export async function listRuns(orgId: string): Promise<RunRow[]> {
  return withSalaryTenant(orgId, async (tx) => {
    const runs = await tx.salaryRun.findMany({ where: { orgId }, orderBy: { period: "desc" }, take: 60 });
    return runs.map((r) => ({
      id: r.id,
      period: r.period,
      startsOn: ymd(r.startsOn),
      endsOn: ymd(r.endsOn),
      payDate: ymd(r.payDate),
      status: r.status as RunStatus,
      totals: r.totals as unknown as RunTotals,
      paidOn: r.paidOn ? ymd(r.paidOn) : null,
    }));
  });
}

export interface LineView {
  id: string;
  employmentId: string;
  userId: string | null;
  name: string;
  department: string;
  employeeCode: string;
  lines: PayLine[];
  gross: number;
  deductions: number;
  net: number;
  ssoEmployee: number;
  ssoEmployer: number;
  tax: number;
  taxable: number;
  warnings: string[];
  adjustments: Adjustment[];
  info: LineInfo;
  bankName: string;
  bankAccount: string;
  accountName: string;
  payChannel: PayChannel;
  updatedAt: string;
}

export function toLineView(l: Awaited<ReturnType<Tx["salaryRunLine"]["findFirstOrThrow"]>>): LineView {
  return {
    id: l.id,
    employmentId: l.employmentId,
    userId: l.userId,
    name: l.name,
    department: l.department,
    employeeCode: l.employeeCode,
    lines: (l.lines as unknown as PayLine[]) ?? [],
    gross: num(l.gross),
    deductions: num(l.deductions),
    net: num(l.net),
    ssoEmployee: num(l.ssoEmployee),
    ssoEmployer: num(l.ssoEmployer),
    tax: num(l.tax),
    taxable: num(l.taxable),
    warnings: (l.warnings as unknown as string[]) ?? [],
    adjustments: (l.adjustments as unknown as Adjustment[]) ?? [],
    info: l.info as unknown as LineInfo,
    bankName: l.bankName,
    bankAccount: l.bankAccount,
    accountName: l.accountName,
    payChannel: l.payChannel === "cash" ? "cash" : "transfer",
    updatedAt: l.updatedAt.toISOString(),
  };
}

export interface RunDetail extends RunRow {
  note: string;
  bankFee: number;
  excluded: ExcludedEntry[];
  computedAt: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  returnedReason: string | null;
  paidByName: string | null;
  createdByName: string;
  lines: LineView[];
  events: { id: string; at: string; byName: string; action: string; summary: string }[];
}

export async function loadRun(orgId: string, runId: string): Promise<RunDetail | null> {
  return withSalaryTenant(orgId, async (tx) => {
    const r = await tx.salaryRun.findFirst({ where: { orgId, id: runId } });
    if (!r) return null;
    const [lines, events] = await Promise.all([
      tx.salaryRunLine.findMany({ where: { orgId, runId } }),
      tx.salaryEvent.findMany({ where: { orgId, runId }, orderBy: { at: "desc" }, take: 100 }),
    ]);
    return {
      id: r.id,
      period: r.period,
      startsOn: ymd(r.startsOn),
      endsOn: ymd(r.endsOn),
      payDate: ymd(r.payDate),
      status: r.status as RunStatus,
      totals: r.totals as unknown as RunTotals,
      paidOn: r.paidOn ? ymd(r.paidOn) : null,
      note: r.note,
      bankFee: num(r.bankFee),
      excluded: (r.excluded as unknown as ExcludedEntry[]) ?? [],
      computedAt: r.computedAt?.toISOString() ?? null,
      submittedByName: r.submittedByName,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      approvedByName: r.approvedByName,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      approvalNote: r.approvalNote,
      returnedReason: r.returnedReason,
      paidByName: r.paidByName,
      createdByName: r.createdByName,
      lines: lines.map(toLineView).sort((a, b) => a.name.localeCompare(b.name, "th")),
      events: events.map((e) => ({ id: e.id, at: e.at.toISOString(), byName: e.byName, action: e.action, summary: e.summary })),
    };
  });
}

export interface ChangeItem {
  tag: "manual" | "recurring" | "override" | "salary" | "ot" | "new" | "left" | "skipped" | "exempt" | "deferred" | "warning";
  who: string;
  detail: string;
  amount: number | null;
}

/** "สิ่งที่เปลี่ยนจากเดือนก่อน" สำหรับหน้า CEO อนุมัติ — ดูแค่นี้ก็รู้ว่าต้องถามอะไร */
export async function approvalSummary(orgId: string, run: RunDetail): Promise<{ prevPeriod: string | null; prevNet: number | null; changes: ChangeItem[] }> {
  // รายการประจำ/ผ่อนที่เริ่มงวดนี้ — ตั้งจากหน้าพนักงานหรือจาก drawer ก็ต้องให้ CEO เห็น (ไม่ใช่แค่รายการเพิ่มเองงวดเดียว)
  const recRefs = run.lines.flatMap((l) => l.lines.filter((x) => x.source === "recurring" && x.refId).map((x) => x.refId!));
  const [prev, startedHere] = await withSalaryTenant(orgId, async (tx) => [
    await previousPaid(tx, orgId, run.period),
    recRefs.length ? await tx.salaryEmployeeItem.findMany({ where: { orgId, id: { in: recRefs }, fromPeriod: run.period }, select: { id: true, note: true, createdByName: true } }) : [],
  ] as const);
  const startedBy = new Map(startedHere.map((r) => [r.id, r]));
  const changes: ChangeItem[] = [];
  for (const l of run.lines) {
    for (const x of l.lines) {
      const r = x.refId ? startedBy.get(x.refId) : undefined;
      if (x.source !== "recurring" || !r) continue;
      changes.push({ tag: "recurring", who: l.name, detail: `เริ่ม "${x.label}" ${x.how} · โดย ${r.createdByName}`, amount: x.kind === "earning" ? x.amount : -x.amount });
    }
    const sal = l.lines.find((x) => x.source === "salary");
    if (sal?.how.startsWith("ปรับเงินเดือนกลางงวด")) changes.push({ tag: "salary", who: l.name, detail: sal.how, amount: null });
    for (const a of l.adjustments) changes.push({ tag: "manual", who: l.name, detail: `${a.kind === "earning" ? "เพิ่ม" : "หัก"} "${a.label}" · ${a.reason} · โดย ${a.byName}`, amount: a.kind === "earning" ? a.amount : -a.amount });
    const ov = l.info?.overrides ?? {};
    if (ov.sso) changes.push({ tag: "override", who: l.name, detail: `ปรับประกันสังคมเอง (ระบบคิดได้ ${l.info.ssoComputed}) · ${ov.sso.reason}`, amount: -ov.sso.amount });
    if (ov.tax) changes.push({ tag: "override", who: l.name, detail: `ปรับภาษีเอง (ระบบคิดได้ ${l.info.taxComputed}) · ${ov.tax.reason}`, amount: -ov.tax.amount });
    if (ov.commission) changes.push({ tag: "override", who: l.name, detail: `ปรับค่าคอมเอง (ระบบคิดได้ ${l.info.commissionComputed ?? 0}) · ${ov.commission.reason}`, amount: ov.commission.amount });
    if (ov.diligence) changes.push({ tag: "override", who: l.name, detail: `ปรับเบี้ยขยันเอง (ระบบคิดได้ ${l.info.diligence?.computed ?? 0}) · ${ov.diligence.reason}`, amount: ov.diligence.amount });
    for (const d of l.info?.deferredAdvances ?? []) changes.push({ tag: "deferred", who: l.name, detail: `เลื่อนหักเบิกล่วงหน้า ${d.code} ไปงวดหน้า`, amount: d.amount });
    const p = prev.byEmployment.get(l.employmentId);
    const ot = l.lines.filter((x) => x.source === "ot").reduce((s, x) => s + x.amount, 0);
    if (!p && prev.period) changes.push({ tag: "new", who: l.name, detail: "ไม่มีในงวดก่อน (เข้าใหม่/เพิ่งมีเงินเดือน)", amount: l.net });
    if (p && Math.abs(p.monthlySalary - (l.info?.monthlySalary ?? 0)) > 0.004 && p.monthlySalary > 0 && !sal?.how.startsWith("ปรับเงินเดือนกลางงวด")) {
      changes.push({ tag: "salary", who: l.name, detail: `เงินเดือน ${p.monthlySalary.toLocaleString("en-US")} → ${(l.info?.monthlySalary ?? 0).toLocaleString("en-US")}`, amount: (l.info?.monthlySalary ?? 0) - p.monthlySalary });
    }
    if (ot > 0 && (!p || ot > Math.max(p.ot * 1.5, p.ot + 1000))) changes.push({ tag: "ot", who: l.name, detail: `OT ${ot.toLocaleString("en-US")} (งวดก่อน ${(p?.ot ?? 0).toLocaleString("en-US")})`, amount: ot });
    const sso = l.lines.find((x) => x.key === "sso");
    if (sso?.how.startsWith("ไม่หัก")) changes.push({ tag: "exempt", who: l.name, detail: `ไม่หักประกันสังคม — ${sso.how.replace(/^ไม่หัก — /, "")}`, amount: null });
    if (l.info?.terminatedOn && l.info.terminatedOn <= run.endsOn) changes.push({ tag: "left", who: l.name, detail: `งวดสุดท้าย (ทำงานถึง ${l.info.terminatedOn})`, amount: l.net });
  }
  for (const [id, p] of prev.byEmployment) {
    if (!run.lines.some((l) => l.employmentId === id) && !run.excluded.some((x) => x.employmentId === id)) changes.push({ tag: "left", who: p.name, detail: "อยู่ในงวดก่อน แต่ไม่อยู่ในงวดนี้", amount: null });
  }
  for (const s of run.totals?.skipped ?? []) changes.push({ tag: "skipped", who: s.name, detail: s.reason, amount: null });
  return { prevPeriod: prev.period, prevNet: prev.net, changes };
}

/* ───────────── รายชื่อพนักงาน (หน้าตั้งค่ารายคน) ───────────── */

export interface StaffRow {
  employmentId: string;
  userId: string | null;
  name: string;
  department: string;
  employeeCode: string;
  hiredOn: string;
  terminatedOn: string | null;
  salary: number | null;
  salaryFrom: string | null;
  history: { amount: number; from: string; to: string | null; note: string }[];
  profile: {
    payChannel: PayChannel;
    bankName: string;
    bankAccount: string;
    accountName: string;
    ssoExempt: boolean;
    ssoExemptReason: string;
    taxMode: TaxMode;
    taxFixedAmount: number;
    taxNoneReason: string;
    allowances: AllowanceEntry[];
    extraAllowance: number;
    prevIncome: number;
    prevTax: number;
    prevSso: number;
    prevYear: number | null;
    diligenceEligible: boolean;
    /** พนักงานใหม่ที่ยังไม่ได้เลือก — ตั้งต้นไม่ได้เบี้ยขยัน (probation.ts) */
    diligenceProbationDefault: boolean;
    diligenceOpening: number | null;
  };
  recurring: { id: string; itemId: string; name: string; kind: string; amount: number; fromPeriod: string; toPeriod: string | null; note: string }[];
  problems: string[];
}

export async function listStaff(orgId: string, onlyEmploymentId?: string): Promise<StaffRow[]> {
  const today = bangkokToday();
  const wf = await withWorkforceTenant(orgId, async (wtx) => {
    const emps = await wtx.$queryRawUnsafe<{ employment_id: string; employee_code: string; employment_type: string; hired_on: string; terminated_on: string | null; subject: string | null; first_name: string; last_name: string; email: string | null }[]>(
      `SELECT e.id::text AS employment_id, e.employee_code, e.employment_type,
              to_char(e.hired_on, 'YYYY-MM-DD') AS hired_on, to_char(e.terminated_on, 'YYYY-MM-DD') AS terminated_on,
              (SELECT p.subject FROM workforce.principals p WHERE p.person_id = e.person_id ORDER BY p.created_at LIMIT 1) AS subject,
              pe.first_name, pe.last_name, pe.email
         FROM workforce.employments e JOIN workforce.people pe ON pe.id = e.person_id
        WHERE (e.terminated_on IS NULL OR e.terminated_on >= ($1::date - 62)) ${onlyEmploymentId ? "AND e.id = $2::uuid" : ""}`,
      ...(onlyEmploymentId ? [today, onlyEmploymentId] : [today]),
    );
    const ids = emps.map((e) => e.employment_id);
    const comp = ids.length
      ? await wtx.$queryRawUnsafe<{ employment_id: string; amount: string; pay_basis: string; effective_from: string; effective_to: string | null; note: string | null }[]>(
          `SELECT employment_id::text AS employment_id, amount::text AS amount, pay_basis, to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
                  to_char(effective_to, 'YYYY-MM-DD') AS effective_to, note
             FROM workforce.compensation_rates WHERE employment_id = ANY($1::uuid[]) ORDER BY effective_from DESC`,
          ids,
        )
      : [];
    return { emps, comp };
  });
  await fillSubjectsByEmail(orgId, wf.emps);
  const subjects = wf.emps.map((e) => e.subject).filter((s): s is string => !!s);
  const users = subjects.length
    ? await prisma.user.findMany({ where: { orgId, id: { in: subjects } }, select: { id: true, name: true, department: { select: { name: true } }, roles: { select: { role: { select: { code: true } } } } } })
    : [];
  const userBy = new Map(users.map((u) => [u.id, u]));
  const { profiles, items, empItems } = await withSalaryTenant(orgId, async (tx) => ({
    profiles: await tx.salaryProfile.findMany({ where: { orgId } }),
    items: await tx.salaryItem.findMany({ where: { orgId } }),
    empItems: await tx.salaryEmployeeItem.findMany({ where: { orgId, endedAt: null }, orderBy: { createdAt: "asc" } }),
  }));
  const itemBy = new Map(items.map((i) => [i.id, i]));
  const probationFrom = await loadProbationFrom(orgId);
  const rows: StaffRow[] = [];
  for (const e of wf.emps) {
    const u = e.subject ? userBy.get(e.subject) : undefined;
    if (u?.roles.some((r) => r.role.code === "WORKER")) continue;
    const comps = wf.comp.filter((c) => c.employment_id === e.employment_id);
    if (comps.length > 0 && !comps.some((c) => c.pay_basis === "MONTHLY")) continue; // รายวัน/ชั่วโมง
    if (comps.length === 0 && e.employment_type !== "MONTHLY") continue;
    const monthly = comps.filter((c) => c.pay_basis === "MONTHLY");
    const current = monthly.find((c) => c.effective_from <= today && (!c.effective_to || c.effective_to >= today)) ?? monthly[0];
    const p = profiles.find((x) => x.employmentId === e.employment_id);
    const profile: StaffRow["profile"] = {
      payChannel: (p?.payChannel ?? "transfer") as PayChannel,
      bankName: p?.bankName ?? "",
      bankAccount: p?.bankAccount ?? "",
      accountName: p?.accountName ?? "",
      ssoExempt: p?.ssoExempt ?? false,
      ssoExemptReason: p?.ssoExemptReason ?? "",
      taxMode: (p?.taxMode ?? "auto") as TaxMode,
      taxFixedAmount: num(p?.taxFixedAmount),
      taxNoneReason: p?.taxNoneReason ?? "",
      allowances: (p?.allowances as unknown as AllowanceEntry[]) ?? [],
      extraAllowance: num(p?.extraAllowance),
      prevIncome: num(p?.prevIncome),
      prevTax: num(p?.prevTax),
      prevSso: num(p?.prevSso),
      prevYear: p?.prevYear ?? null,
      diligenceEligible: p?.diligenceEligible ?? !isNewHire(e.hired_on, probationFrom),
      diligenceProbationDefault: (p?.diligenceEligible ?? null) === null && isNewHire(e.hired_on, probationFrom),
      diligenceOpening: p?.diligenceOpening !== null && p?.diligenceOpening !== undefined ? num(p.diligenceOpening) : null,
    };
    const problems: string[] = [];
    if (!current) problems.push("ไม่มีเงินเดือน");
    if (profile.payChannel === "transfer" && !profile.bankAccount) problems.push("ขาดเลขบัญชี");
    rows.push({
      employmentId: e.employment_id,
      userId: e.subject,
      name: u?.name ?? `${e.first_name} ${e.last_name}`.trim(),
      department: u?.department?.name ?? "",
      employeeCode: e.employee_code,
      hiredOn: e.hired_on,
      terminatedOn: e.terminated_on,
      salary: current ? Number(current.amount) : null,
      salaryFrom: current?.effective_from ?? null,
      history: monthly.map((c) => ({ amount: Number(c.amount), from: c.effective_from, to: c.effective_to, note: c.note ?? "" })),
      profile,
      recurring: empItems
        .filter((x) => x.employmentId === e.employment_id)
        .map((x) => ({ id: x.id, itemId: x.itemId, name: itemBy.get(x.itemId)?.name ?? "รายการ", kind: itemBy.get(x.itemId)?.kind ?? "earning", amount: num(x.amount), fromPeriod: x.fromPeriod, toPeriod: x.toPeriod, note: x.note })),
      problems,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, "th"));
}

/* ───────────── สลิป ───────────── */

export interface SlipData {
  runId: string;
  period: string;
  startsOn: string;
  endsOn: string;
  payDate: string;
  paidOn: string | null;
  status: RunStatus;
  line: LineView;
  /** net = เงินได้สุทธิสะสม (หลังหักทุกอย่าง — ยอดที่ได้รับจริง) */
  ytd: { gross: number; tax: number; sso: number; net: number };
  /** อัตราประกันสังคม ณ วันจ่าย — ใช้อธิบายบนสลิป */
  sso: SsoParams;
}

/** สลิปของคนหนึ่งในรอบหนึ่ง — พนักงานเห็นของตัวเองเฉพาะรอบที่จ่ายแล้ว (ผู้เรียกตรวจสิทธิ์) */
export async function loadSlip(orgId: string, runId: string, by: { employmentId?: string; userId?: string }): Promise<SlipData | null> {
  return withSalaryTenant(orgId, async (tx) => {
    const run = await tx.salaryRun.findFirst({ where: { orgId, id: runId } });
    if (!run) return null;
    const line = await tx.salaryRunLine.findFirst({ where: { orgId, runId, ...(by.employmentId ? { employmentId: by.employmentId } : { userId: by.userId ?? "__none__" }) } });
    if (!line) return null;
    const year = run.payDate.getUTCFullYear();
    const ytd = await tx.$queryRawUnsafe<{ gross: string | null; tax: string | null; sso: string | null; net: string | null }[]>(
      `SELECT sum(l.gross)::text AS gross, sum(l.tax)::text AS tax, sum(l.sso_employee)::text AS sso, sum(l.net)::text AS net
         FROM salary.run_lines l JOIN salary.runs r ON r.id = l.run_id
        WHERE r.org_id = $1 AND r.status = 'paid' AND l.employment_id = $2 AND date_part('year', r.pay_date) = $3 AND r.pay_date <= $4::date`,
      orgId,
      line.employmentId,
      year,
      ymd(run.payDate),
    );
    return {
      runId: run.id,
      period: run.period,
      startsOn: ymd(run.startsOn),
      endsOn: ymd(run.endsOn),
      payDate: ymd(run.payDate),
      paidOn: run.paidOn ? ymd(run.paidOn) : null,
      status: run.status as RunStatus,
      line: toLineView(line),
      sso: rateOn((await readRates(tx, orgId)).sso, ymd(run.payDate), DEFAULT_SSO),
      // สะสมทั้งปี = รอบที่จ่ายผ่านระบบ + ยอดยกมาที่ใช้ตอนคำนวณงวดนี้
      ytd: (() => {
        const o = (line.info as { opening?: { income: number; tax: number; sso: number } | null } | null)?.opening ?? null;
        // ยอดยกมาไม่มีรายหักอื่นของระบบเดิม — สุทธิยกมาคิดเท่าที่รู้ (เงินได้ − ภาษี − ประกันสังคม)
        const openingNet = o ? o.income - o.tax - o.sso : 0;
        return { gross: num(ytd[0]?.gross) + (o?.income ?? 0), tax: num(ytd[0]?.tax) + (o?.tax ?? 0), sso: num(ytd[0]?.sso) + (o?.sso ?? 0), net: num(ytd[0]?.net) + openingNet };
      })(),
    };
  });
}

export async function mySlips(orgId: string, userId: string) {
  return withSalaryTenant(orgId, async (tx) => {
    const lines = await tx.salaryRunLine.findMany({ where: { orgId, userId }, select: { runId: true, net: true } });
    if (lines.length === 0) return [];
    const runs = await tx.salaryRun.findMany({ where: { orgId, id: { in: lines.map((l) => l.runId) }, status: "paid" }, orderBy: { period: "desc" } });
    return runs.map((r) => ({ runId: r.id, period: r.period, payDate: ymd(r.payDate), paidOn: r.paidOn ? ymd(r.paidOn) : null, net: num(lines.find((l) => l.runId === r.id)?.net) }));
  });
}

/** เบี้ยขยันของรอบล่าสุดที่จ่ายแล้ว (ประวัติขั้น) — หน้าพนักงาน */
export async function lastPaidDiligence(orgId: string, employmentId: string): Promise<{ amount: number; period: string } | null> {
  return withSalaryTenant(orgId, async (tx) => {
    const rows = await tx.$queryRawUnsafe<{ amount: string; period: string }[]>(
      `SELECT (l.info->'diligence'->>'amount') AS amount, r.period
         FROM salary.run_lines l JOIN salary.runs r ON r.id = l.run_id
        WHERE r.org_id = $1 AND r.status = 'paid' AND l.employment_id = $2 AND l.info ? 'diligence'
        ORDER BY r.period DESC LIMIT 1`,
      orgId,
      employmentId,
    );
    return rows[0] ? { amount: Number(rows[0].amount), period: rows[0].period } : null;
  });
}

/** ตำแหน่งปัจจุบันจากระบบบุคคล (employment_assignments → positions) — ไม่มี = null (สลิปใช้แผนกแทน) */
export async function positionOf(orgId: string, employmentId: string, onDate: string): Promise<string | null> {
  const rows = await withWorkforceTenant(orgId, (wtx) =>
    wtx.$queryRawUnsafe<{ title: string }[]>(
      `SELECT p.title FROM workforce.employment_assignments a JOIN workforce.positions p ON p.id = a.position_id
        WHERE a.employment_id = $1::uuid AND a.effective_from <= $2::date AND (a.effective_to IS NULL OR a.effective_to >= $2::date)
        ORDER BY a.effective_from DESC LIMIT 1`,
      employmentId,
      onDate,
    ),
  ).catch(() => []);
  return rows[0]?.title ?? null;
}
