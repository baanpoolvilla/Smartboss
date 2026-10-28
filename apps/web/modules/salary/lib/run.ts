import "server-only";

import { insertEvent as insertReqEvent, loadRequests } from "@/modules/requests/lib/db";
import { computePay, type Adjustment, type DiligenceResult, type Override, type PayLine, type TaxBreak } from "./compute";
import type { CommissionParts } from "@/modules/hr/lib/commission";
import { dateOnly, insertEvent, num, readRates, readSettings, withSalaryTenant, ymd, type Tx } from "./db";
import { loadPeriodInputs } from "./inputs";
import {
  DEFAULT_SSO,
  DEFAULT_TAX,
  bangkokToday,
  fmt,
  periodLabel,
  rateOn,
  toSatang,
  type PayChannel,
  type RunStatus,
} from "./types";

/**
 * รอบเงินเดือน — สร้าง · คำนวณ · ส่งอนุมัติ · อนุมัติ/ส่งกลับ · บันทึกจ่าย
 *
 * กติกากันพลาด (ผู้ใช้ 22/10/2569 "ส่วนคิดเงินเดือนถ้าผิดพลาดคือหมดความไว้วางใจ"):
 *   - มีรอบที่ยังไม่จ่ายได้ทีละรอบ — ยอดสะสมทั้งปี (ภาษี) มาจากรอบที่จ่ายแล้วเท่านั้น รอบซ้อนกันจะคิดภาษีผิด
 *   - คำนวณใหม่ได้เฉพาะตอนเป็นร่าง · รายการที่ HR เพิ่มเอง / ปรับภาษี-ประกันสังคม / เลื่อนหักเบิก ไม่หายเมื่อคำนวณใหม่
 *   - ทุกการเปลี่ยนแปลงล็อกแถวรอบไว้ก่อน (SELECT … FOR UPDATE) — สองคนกดพร้อมกันไม่ทับกัน
 *   - ส่งอนุมัติไม่ได้ถ้ามีคนยอดติดลบ · อนุมัติแล้วตัวเลขล็อกที่ฐานข้อมูล (trigger)
 *   - บันทึกจ่าย: ตรวจซ้ำว่าใบ OT/เบิกล่วงหน้าที่อยู่ในรอบยังเหมือนตอนคำนวณ (ไม่ถูกจ่าย/หักที่อื่นไปแล้ว)
 *     แล้วปิดใบเหล่านั้นใน transaction เดียวกัน — สำเร็จทั้งหมดหรือไม่ทำอะไรเลย
 */

export interface Actor {
  userId: string;
  name: string;
}

export interface LineInfo {
  workedDays: number;
  /** รวมวันหยุด (Day-Off) ด้วย — รอบเก่าที่ไม่มี offDays แสดงเป็น "ลา" ทั้งก้อน */
  leaveDays: number;
  lateCount: number;
  /** สรุปวันทำงาน (สลิป/หน้ารอบ) — รอบที่คำนวณก่อน 27/10/2569 ไม่มี */
  offDays?: number;
  absentDays?: number;
  otDays?: number;
  otMinutes?: number;
  overrides: { sso?: Override; tax?: Override; commission?: Override };
  /** ใบเบิกล่วงหน้าที่เลื่อนไปหักงวดหน้า */
  deferAdvances: string[];
  deferredAdvances: { refId: string; code: string; amount: number }[];
  /**
   * ใบ OT/เบิกที่อยู่ในรอบนี้ + ยอด ณ ตอนคำนวณ (ตรวจซ้ำตอนบันทึกจ่าย)
   * ot.pay = ยอดที่จ่ายจริงต่อใบ (OT แบบนับวัน) · ไม่มี = จ่ายเท่ายอดค้าง (OT แบบชั่วโมง เดิม)
   */
  refs: { ot: { id: string; amount: number; pay?: number }[]; advances: { id: string; amount: number }[] };
  /** เบี้ยขยันงวดนี้ — เก็บไว้เป็นประวัติขั้น (รอบถัดไปอ่านจากรอบที่จ่ายแล้ว) */
  diligence?: DiligenceResult;
  /** ที่มาของค่าคอม Grade + Tier (สตางค์ไม่ปัด) */
  commissionParts?: CommissionParts;
  /** OT แบบนับวัน: จำนวนวัน · อัตราต่อวัน */
  otDaysPay?: { days: number; rate: number; dates: string[] };
  /** ต้องแก้ก่อนส่งอนุมัติ */
  blocks?: string[];
  hiredOn: string;
  terminatedOn: string | null;
  ssoComputed: number;
  taxComputed: number;
  /** ค่าคอมที่ระบบคิดได้ (ไม่มี = รอบเก่า/ไม่มีค่าคอม) */
  commissionComputed?: number;
  ssoWage: number;
  monthlySalary: number;
  /** ยอดยกมา ณ ตอนคำนวณ (ไม่มี = ไม่ได้กรอก) */
  opening?: { income: number; tax: number; sso: number } | null;
  /** วิธีคิดภาษีทีละขั้น ณ ตอนคำนวณ (รอบเก่าไม่มี — แสดงแค่คำอธิบายบรรทัด) */
  taxBreak?: TaxBreak;
}

export interface ExcludedEntry {
  employmentId: string;
  name: string;
  reason: string;
  byName: string;
  at: string;
}

export interface RunTotals {
  people: number;
  gross: number;
  deductions: number;
  net: number;
  ssoEmployee: number;
  ssoEmployer: number;
  tax: number;
  transferNet: number;
  cashNet: number;
  skipped: { name: string; reason: string }[];
  warnings: number;
  negatives: number;
  /** จำนวนคนที่มีข้อห้ามส่ง (ข้อมูลค่าคอมไม่ครบ ฯลฯ) — รอบเก่าไม่มี */
  blocked?: number;
}

const EMPTY_TOTALS: RunTotals = { people: 0, gross: 0, deductions: 0, net: 0, ssoEmployee: 0, ssoEmployer: 0, tax: 0, transferNet: 0, cashNet: 0, skipped: [], warnings: 0, negatives: 0, blocked: 0 };

async function lockRun(tx: Tx, orgId: string, runId: string) {
  await tx.$queryRawUnsafe(`SELECT id FROM salary.runs WHERE id = $1 AND org_id = $2 FOR UPDATE`, runId, orgId);
  const run = await tx.salaryRun.findFirst({ where: { orgId, id: runId } });
  if (!run) throw new Error("ไม่พบรอบเงินเดือน");
  return run;
}

/** สร้างรอบใหม่ (ร่าง) แล้วคำนวณทันที */
export async function createRun(orgId: string, actor: Actor, input: { period: string; startsOn: string; endsOn: string; payDate: string }): Promise<string> {
  const runId = await withSalaryTenant(orgId, async (tx) => {
    const open = await tx.salaryRun.findFirst({ where: { orgId, status: { not: "paid" } }, select: { period: true } });
    if (open) throw new Error(`งวด ${periodLabel(open.period)} ยังไม่ได้บันทึกจ่าย — ทำให้เสร็จก่อนเปิดงวดใหม่ (ภาษีสะสมคิดจากงวดที่จ่ายแล้ว)`);
    const dup = await tx.salaryRun.findFirst({ where: { orgId, period: input.period }, select: { id: true } });
    if (dup) throw new Error(`มีงวด ${periodLabel(input.period)} อยู่แล้ว`);
    const later = await tx.salaryRun.findFirst({ where: { orgId, period: { gt: input.period } }, select: { period: true } });
    if (later) throw new Error(`มีงวด ${periodLabel(later.period)} ที่ใหม่กว่าอยู่แล้ว — เปิดงวดย้อนหลังไม่ได้`);
    const overlap = await tx.salaryRun.findFirst({ where: { orgId, endsOn: { gte: dateOnly(input.startsOn) } }, select: { period: true } });
    if (overlap) throw new Error(`ช่วงวันที่ทับกับงวด ${periodLabel(overlap.period)}`);
    const run = await tx.salaryRun.create({
      data: {
        orgId,
        period: input.period,
        startsOn: dateOnly(input.startsOn),
        endsOn: dateOnly(input.endsOn),
        payDate: dateOnly(input.payDate),
        createdBy: actor.userId,
        createdByName: actor.name,
      },
    });
    await insertEvent(tx, orgId, { runId: run.id, byUserId: actor.userId, byName: actor.name, action: "create", summary: `เปิดงวด ${periodLabel(input.period)} (${input.startsOn} – ${input.endsOn} จ่าย ${input.payDate})` });
    return run.id;
  });
  await computeRun(orgId, runId, actor);
  return runId;
}

/** คำนวณทั้งรอบใหม่ (ร่างเท่านั้น) — ดึงข้อมูลล่าสุดจากทุกระบบ เก็บรายการที่ HR ทำเองไว้ */
export async function computeRun(orgId: string, runId: string, actor: Actor): Promise<RunTotals> {
  return withSalaryTenant(orgId, async (tx) => {
    const run = await lockRun(tx, orgId, runId);
    if (run.status !== "draft") throw new Error("รอบนี้ส่งอนุมัติแล้ว — คำนวณใหม่ไม่ได้ (ให้ผู้อนุมัติส่งกลับก่อน)");
    const settings = await readSettings(tx, orgId);
    const rates = await readRates(tx, orgId);
    const period = { startsOn: ymd(run.startsOn), endsOn: ymd(run.endsOn), payDate: ymd(run.payDate) };
    const { staff, skipped } = await loadPeriodInputs(tx, orgId, { id: run.id, period: run.period, ...period }, settings);
    const sso = rateOn(rates.sso, period.payDate, DEFAULT_SSO);
    const tax = rateOn(rates.tax, period.payDate, DEFAULT_TAX);

    const existing = await tx.salaryRunLine.findMany({ where: { orgId, runId } });
    const prevBy = new Map(existing.map((l) => [l.employmentId, l]));
    const keep = new Set<string>();
    // "ไม่จ่ายงวดนี้" (เลือกไว้พร้อมเหตุผล) — ไม่อยู่ในรอบ OT/เบิกของคนนั้นยกไปงวดหน้าเอง
    const excluded = (run.excluded as unknown as ExcludedEntry[]) ?? [];
    const excludedIds = new Set(excluded.map((x) => x.employmentId));
    const totals: RunTotals = { ...EMPTY_TOTALS, skipped: [...skipped, ...excluded.map((x) => ({ name: x.name, reason: `ไม่จ่ายงวดนี้ — ${x.reason}` }))] };
    const add = (k: keyof Pick<RunTotals, "gross" | "deductions" | "net" | "ssoEmployee" | "ssoEmployer" | "tax" | "transferNet" | "cashNet">, v: number) => {
      totals[k] = (toSatang(totals[k]) + toSatang(v)) / 100;
    };

    for (const s of staff) {
      if (excludedIds.has(s.employmentId)) continue;
      const prev = prevBy.get(s.employmentId);
      const prevInfo = (prev?.info ?? {}) as Partial<LineInfo>;
      const adjustments = ((prev?.adjustments ?? []) as unknown as Adjustment[]) ?? [];
      const overrides = prevInfo.overrides ?? {};
      const defer = (prevInfo.deferAdvances ?? []).filter((id) => s.advances.some((a) => a.refId === id));
      const advances = s.advances.filter((a) => !defer.includes(a.refId));
      const r = computePay({
        period,
        salary: s.salary,
        unpaidLeaveDays: s.unpaidLeaveDays,
        late: s.late,
        absentDays: s.absentDays,
        ot: s.ot,
        advances,
        recurring: s.recurring,
        commission: s.commission,
        diligence: s.diligence,
        adjustments,
        overrides,
        profile: s.profile,
        ytd: s.ytd,
        settings,
        sso,
        tax,
      });
      const warnings = [...r.warnings, ...s.extraWarnings];
      if (s.profile.payChannel === "transfer" && !s.profile.bankAccount.trim()) warnings.push("ยังไม่มีเลขบัญชี — จะไม่อยู่ในไฟล์โอน (ใส่บัญชี หรือเปลี่ยนเป็นเงินสด)");
      if (s.terminatedOn && s.terminatedOn <= period.endsOn) warnings.push(`ออกจากงานวันที่ ${s.terminatedOn} — งวดสุดท้าย ตรวจยอดค้าง (เบิกล่วงหน้า/OT) ให้ครบ`);
      const info: LineInfo = {
        ...s.info,
        overrides,
        deferAdvances: defer,
        deferredAdvances: s.advances.filter((a) => defer.includes(a.refId)).map((a) => ({ refId: a.refId, code: a.code, amount: a.amount })),
        refs: { ot: s.otRefs ?? s.ot.map((o) => ({ id: o.refId, amount: o.amount })), advances: advances.map((a) => ({ id: a.refId, amount: a.amount })) },
        ...(s.diligence ? { diligence: s.diligence } : {}),
        ...(s.commissionParts && !overrides.commission ? { commissionParts: s.commissionParts } : {}),
        ...(s.otDaysPay ? { otDaysPay: s.otDaysPay } : {}),
        blocks: r.blocks,
        hiredOn: s.hiredOn,
        terminatedOn: s.terminatedOn,
        opening: s.opening,
        ssoComputed: r.ssoComputed,
        commissionComputed: r.commissionComputed,
        taxBreak: r.taxBreak,
        taxComputed: r.taxComputed,
        ssoWage: r.ssoWage,
        monthlySalary: s.salary.length ? s.salary[s.salary.length - 1]!.monthly : 0,
      };
      const data = {
        userId: s.userId,
        name: s.name,
        department: s.department,
        employeeCode: s.employeeCode,
        lines: r.lines as unknown as object,
        gross: r.gross,
        deductions: r.deductions,
        net: r.net,
        ssoEmployee: r.ssoEmployee,
        ssoEmployer: r.ssoEmployer,
        tax: r.tax,
        taxable: r.taxable,
        warnings: warnings as unknown as object,
        info: info as unknown as object,
        bankName: s.profile.bankName,
        bankAccount: s.profile.bankAccount,
        accountName: s.profile.accountName,
        payChannel: s.profile.payChannel,
      };
      if (prev) await tx.salaryRunLine.update({ where: { id: prev.id }, data });
      else await tx.salaryRunLine.create({ data: { orgId, runId, employmentId: s.employmentId, adjustments: [], ...data } });
      keep.add(s.employmentId);
      totals.people += 1;
      add("gross", r.gross);
      add("deductions", r.deductions);
      add("net", r.net);
      add("ssoEmployee", r.ssoEmployee);
      add("ssoEmployer", r.ssoEmployer);
      add("tax", r.tax);
      add(s.profile.payChannel === "cash" ? "cashNet" : "transferNet", r.net);
      if (warnings.length) totals.warnings += 1;
      if (r.net < 0) totals.negatives += 1;
      if (r.blocks.length) totals.blocked = (totals.blocked ?? 0) + 1;
    }
    const gone = existing.filter((l) => !keep.has(l.employmentId));
    if (gone.length) {
      await tx.salaryRunLine.deleteMany({ where: { orgId, runId, id: { in: gone.map((l) => l.id) } } });
    }
    await tx.salaryRun.update({ where: { id: runId }, data: { totals: totals as unknown as object, computedAt: new Date() } });
    await insertEvent(tx, orgId, {
      runId,
      byUserId: actor.userId,
      byName: actor.name,
      action: "compute",
      summary: `คำนวณ ${totals.people} คน · สุทธิ ${fmt(toSatang(totals.net))}${gone.length ? ` · เอาออก ${gone.map((l) => l.name).join(", ")} (ไม่อยู่ในงวดแล้ว)` : ""}`,
    });
    return totals;
  });
}

/** แก้รายคน (ร่างเท่านั้น) แล้วคำนวณทั้งรอบใหม่ — `expectUpdatedAt` กันสองคนแก้คนเดียวกันพร้อมกัน */
export async function editLine(
  orgId: string,
  actor: Actor,
  input: { runId: string; employmentId: string; expectUpdatedAt: string | null },
  change: (line: { adjustments: Adjustment[]; info: LineInfo }) => { adjustments: Adjustment[]; info: LineInfo; summary: string },
): Promise<void> {
  await withSalaryTenant(orgId, async (tx) => {
    const run = await lockRun(tx, orgId, input.runId);
    if (run.status !== "draft") throw new Error("รอบนี้ส่งอนุมัติแล้ว — แก้ไม่ได้ (ให้ผู้อนุมัติส่งกลับก่อน)");
    const line = await tx.salaryRunLine.findFirst({ where: { orgId, runId: input.runId, employmentId: input.employmentId } });
    if (!line) throw new Error("ไม่พบพนักงานคนนี้ในรอบ");
    if (input.expectUpdatedAt && line.updatedAt.toISOString() !== input.expectUpdatedAt) {
      throw new Error("มีคนแก้คนนี้ไปก่อนหน้านี้ — โหลดหน้าใหม่แล้วลองอีกครั้ง");
    }
    const next = change({ adjustments: (line.adjustments as unknown as Adjustment[]) ?? [], info: line.info as unknown as LineInfo });
    await tx.salaryRunLine.update({ where: { id: line.id }, data: { adjustments: next.adjustments as unknown as object, info: next.info as unknown as object } });
    await insertEvent(tx, orgId, { runId: input.runId, byUserId: actor.userId, byName: actor.name, action: "adjust", summary: `${line.name}: ${next.summary}` });
  });
  await computeRun(orgId, input.runId, actor);
}

export interface PrevCompare {
  period: string | null;
  net: number | null;
  people: number | null;
  byEmployment: Map<string, { name: string; monthlySalary: number; ot: number; net: number }>;
}

/** งวดก่อน (จ่ายแล้ว) ไว้เทียบในหน้าอนุมัติ */
export async function previousPaid(tx: Tx, orgId: string, beforePeriod: string): Promise<PrevCompare> {
  const prev = await tx.salaryRun.findFirst({ where: { orgId, status: "paid", period: { lt: beforePeriod } }, orderBy: { period: "desc" } });
  if (!prev) return { period: null, net: null, people: null, byEmployment: new Map() };
  const lines = await tx.salaryRunLine.findMany({ where: { orgId, runId: prev.id } });
  const totals = prev.totals as unknown as RunTotals;
  return {
    period: prev.period,
    net: totals.net ?? null,
    people: totals.people ?? lines.length,
    byEmployment: new Map(
      lines.map((l) => {
        const ls = (l.lines as unknown as PayLine[]) ?? [];
        const info = l.info as unknown as LineInfo;
        return [l.employmentId, { name: l.name, monthlySalary: info?.monthlySalary ?? 0, ot: ls.filter((x) => x.source === "ot").reduce((s, x) => s + x.amount, 0), net: num(l.net) }];
      }),
    ),
  };
}

/** ส่งอนุมัติ — ตามโหมดที่บริษัทตั้ง (CEO ทุกงวด / CEO เมื่อเปลี่ยนมาก / HR อนุมัติเอง) */
export async function submitRun(orgId: string, actor: Actor, runId: string): Promise<{ status: RunStatus; auto: boolean }> {
  return withSalaryTenant(orgId, async (tx) => {
    const run = await lockRun(tx, orgId, runId);
    if (run.status !== "draft") throw new Error("รอบนี้ส่งไปแล้ว");
    const lines = await tx.salaryRunLine.findMany({ where: { orgId, runId } });
    if (lines.length === 0) throw new Error("ยังไม่มีพนักงานในรอบ");
    const neg = lines.filter((l) => num(l.net) < 0);
    if (neg.length) throw new Error(`ยอดสุทธิติดลบ: ${neg.map((l) => l.name).join(", ")} — แก้ก่อนส่ง (เช่น เลื่อนหักเบิกล่วงหน้าไปงวดหน้า)`);
    // ข้อมูลไม่ครบ (เช่น คะแนน Tier ไม่ครบ / คะแนนรวม 0 / เกรดยังไม่ปิด) — ห้ามสรุปรอบ
    const blocked = [...new Set(lines.flatMap((l) => (l.info as unknown as LineInfo)?.blocks ?? []))];
    if (blocked.length) throw new Error(`ยังส่งไม่ได้ — ${blocked.slice(0, 3).join(" · ")} (แก้แล้วกด "ดึงข้อมูลใหม่")`);
    const settings = await readSettings(tx, orgId);
    const totals = run.totals as unknown as RunTotals;
    let auto = false;
    if (settings.approvalMode === "hr") auto = true;
    else if (settings.approvalMode === "ceo_on_change") {
      const prev = await previousPaid(tx, orgId, run.period);
      const manual = lines.some((l) => ((l.adjustments as unknown as Adjustment[]) ?? []).length > 0 || Object.keys(((l.info as unknown as LineInfo)?.overrides ?? {})).length > 0);
      const changePct = prev.net ? (Math.abs(totals.net - prev.net) / prev.net) * 100 : 100;
      auto = !manual && prev.net !== null && changePct <= settings.changeThreshold;
    }
    const now = new Date();
    await tx.salaryRun.update({
      where: { id: runId },
      data: {
        status: auto ? "approved" : "submitted",
        submittedBy: actor.userId,
        submittedByName: actor.name,
        submittedAt: now,
        returnedReason: null,
        ...(auto
          ? { approvedBy: actor.userId, approvedByName: actor.name, approvedAt: now, approvalNote: settings.approvalMode === "hr" ? "HR อนุมัติเอง (ตามตั้งค่าบริษัท)" : `อนุมัติอัตโนมัติ: ยอดต่างจากงวดก่อนไม่เกิน ${settings.changeThreshold}% และไม่มีรายการที่ HR เพิ่มเอง` }
          : {}),
      },
    });
    await insertEvent(tx, orgId, { runId, byUserId: actor.userId, byName: actor.name, action: "submit", summary: auto ? "ส่งแล้ว · อนุมัติตามตั้งค่าบริษัท" : "ส่งให้ CEO อนุมัติ" });
    return { status: auto ? "approved" : "submitted", auto };
  });
}

export async function decideRun(orgId: string, actor: Actor, runId: string, outcome: "approve" | "return", note: string): Promise<void> {
  await withSalaryTenant(orgId, async (tx) => {
    const run = await lockRun(tx, orgId, runId);
    if (outcome === "approve") {
      if (run.status !== "submitted") throw new Error("รอบนี้ไม่ได้รออนุมัติ");
      await tx.salaryRun.update({ where: { id: runId }, data: { status: "approved", approvedBy: actor.userId, approvedByName: actor.name, approvedAt: new Date(), approvalNote: note || null } });
      await insertEvent(tx, orgId, { runId, byUserId: actor.userId, byName: actor.name, action: "approve", summary: `อนุมัติ${note ? ` · ${note}` : ""}` });
    } else {
      if (run.status !== "submitted" && run.status !== "approved") throw new Error("ส่งกลับได้เฉพาะรอบที่รออนุมัติหรืออนุมัติแล้ว (ยังไม่จ่าย)");
      if (!note.trim()) throw new Error("ใส่เหตุผลที่ส่งกลับ");
      await tx.salaryRun.update({ where: { id: runId }, data: { status: "draft", returnedReason: note, approvedBy: null, approvedByName: null, approvedAt: null, approvalNote: null } });
      await insertEvent(tx, orgId, { runId, byUserId: actor.userId, byName: actor.name, action: "return", summary: `ส่งกลับให้แก้ · ${note}` });
    }
  });
}

/**
 * บันทึกจ่ายแล้ว — ล็อกรอบถาวร + ปิดใบ OT (จ่ายผ่านเงินเดือน) และเบิกล่วงหน้า (หักแล้ว) ของรอบนี้
 * ตรวจซ้ำก่อนว่าใบยังเหมือนตอนคำนวณ — ไม่ตรง = ไม่ทำอะไรเลย บอกว่าใบไหน
 */
export async function markPaid(orgId: string, actor: Actor, runId: string, paidOn: string, bankFee = 0): Promise<{ notify: { userId: string; name: string }[] }> {
  return withSalaryTenant(orgId, async (tx) => {
    const run = await lockRun(tx, orgId, runId);
    if (run.status !== "approved") throw new Error("บันทึกจ่ายได้เฉพาะรอบที่อนุมัติแล้ว");
    const lines = await tx.salaryRunLine.findMany({ where: { orgId, runId } });
    const otIds = lines.flatMap((l) => (l.info as unknown as LineInfo).refs?.ot ?? []);
    const advIds = lines.flatMap((l) => (l.info as unknown as LineInfo).refs?.advances ?? []);
    const ots = await loadRequests(tx, orgId, { id: { in: otIds.map((x) => x.id) } }, 5000);
    const advs = await tx.moneyRequest.findMany({ where: { orgId, id: { in: advIds.map((x) => x.id) } } });
    const problems: string[] = [];
    for (const ref of otIds) {
      const r = ots.find((x) => x.id === ref.id);
      const remaining = r ? Math.round((r.netAmount - r.paidTotal) * 100) / 100 : -1;
      if (!r || r.status !== "approved" || Math.abs(remaining - ref.amount) > 0.004) problems.push(`${r?.code ?? ref.id} (OT) ถูกจ่าย/ยกเลิก/แก้ไปหลังคำนวณ`);
    }
    for (const ref of advIds) {
      const r = advs.find((x) => x.id === ref.id);
      if (!r || r.deductedAt || Math.abs(num(r.deductAmount) - ref.amount) > 0.004) problems.push(`${r?.code ?? ref.id} (เบิก) ถูกหัก/แก้ไปหลังคำนวณ`);
    }
    if (problems.length) throw new Error(`ข้อมูลเปลี่ยนหลังอนุมัติ — ให้ CEO ส่งกลับแล้วคำนวณใหม่: ${problems.slice(0, 5).join(" · ")}`);

    const label = `รวมเงินเดือนงวด ${periodLabel(run.period)}`;
    for (const ref of otIds) {
      // OT แบบนับวัน: จ่ายตามค่าวัน (ไม่ใช่ยอดรายชั่วโมงในใบ) — ปรับยอดใบเป็นยอดที่จ่ายจริง แบบ "จ่ายน้อยกว่ายอดแล้วปิดใบ" ของเบิกจ่าย
      const pay = ref.pay ?? ref.amount;
      const r = ots.find((x) => x.id === ref.id)!;
      if (pay > 0) {
        await tx.moneyRequestPayment.create({ data: { orgId, requestId: ref.id, amount: pay, method: "payroll", paidOn: dateOnly(paidOn), payrollPeriod: run.period, note: label, byUserId: actor.userId, byName: actor.name } });
      }
      const byDays = ref.pay !== undefined && Math.abs(ref.pay - ref.amount) > 0.004;
      await tx.moneyRequest.update({ where: { id: ref.id }, data: { status: "paid", ...(byDays ? { netAmount: Math.round((r.paidTotal + pay) * 100) / 100 } : {}) } });
      await insertReqEvent(tx, orgId, {
        requestId: ref.id,
        byUserId: actor.userId,
        byName: actor.name,
        action: "pay",
        summary: byDays
          ? pay > 0
            ? `${label} (โมดูลเงินเดือน) · OT คิดเป็นวัน ${fmt(toSatang(pay))} แทนยอดรายชั่วโมง ${fmt(toSatang(ref.amount))}`
            : `${label} (โมดูลเงินเดือน) · OT วันเดียวกับใบอื่นที่จ่ายค่าวันแล้ว — ไม่จ่ายซ้ำ`
          : `${label} (โมดูลเงินเดือน)`,
      });
    }
    for (const ref of advIds) {
      await tx.moneyRequest.update({ where: { id: ref.id }, data: { deductedAt: new Date(), deductedByName: actor.name, deductedPeriod: run.period } });
      await insertReqEvent(tx, orgId, { requestId: ref.id, byUserId: actor.userId, byName: actor.name, action: "deduct", summary: `หักจาก${label}` });
    }
    await tx.salaryRun.update({ where: { id: runId }, data: { status: "paid", paidAt: new Date(), paidOn: dateOnly(paidOn), paidByName: actor.name, bankFee } });
    await insertEvent(tx, orgId, { runId, byUserId: actor.userId, byName: actor.name, action: "paid", summary: `บันทึกจ่ายแล้ว (โอนวันที่ ${paidOn}) · ปิดใบ OT ${otIds.length} · หักเบิก ${advIds.length}` });
    return { notify: lines.filter((l) => l.userId).map((l) => ({ userId: l.userId!, name: l.name })) };
  });
}

export function lineChannel(c: string): PayChannel {
  return c === "cash" ? "cash" : "transfer";
}

export { bangkokToday };

/** ไม่จ่ายงวดนี้ / กลับมาจ่าย (ร่างเท่านั้น) */
export async function setExcluded(orgId: string, actor: Actor, runId: string, employmentId: string, exclude: boolean, reason: string): Promise<void> {
  await withSalaryTenant(orgId, async (tx) => {
    const run = await lockRun(tx, orgId, runId);
    if (run.status !== "draft") throw new Error("รอบนี้ส่งอนุมัติแล้ว — แก้ไม่ได้");
    const before = (run.excluded as unknown as ExcludedEntry[]) ?? [];
    const list = before.filter((x) => x.employmentId !== employmentId);
    const line = await tx.salaryRunLine.findFirst({ where: { orgId, runId, employmentId }, select: { name: true } });
    const name = line?.name ?? before.find((x) => x.employmentId === employmentId)?.name ?? "พนักงาน";
    if (exclude) list.push({ employmentId, name, reason, byName: actor.name, at: new Date().toISOString() });
    await tx.salaryRun.update({ where: { id: runId }, data: { excluded: list as unknown as object } });
    await insertEvent(tx, orgId, { runId, byUserId: actor.userId, byName: actor.name, action: "adjust", summary: exclude ? `${name}: ไม่จ่ายงวดนี้ · ${reason}` : `${name}: กลับมาจ่ายงวดนี้` });
  });
  await computeRun(orgId, runId, actor);
}

/**
 * ลบรอบที่ยังเป็นร่าง (สร้างผิด/เปิดงวดผิด) — ส่งอนุมัติแล้วต้องให้ CEO ส่งกลับเป็นร่างก่อน · อนุมัติ/จ่ายแล้วลบไม่ได้
 * ปลอดภัย: OT/เบิกล่วงหน้าจะถูกตัดยอดตอนบันทึกจ่ายเท่านั้น ร่างยังไม่ได้แตะอะไรในระบบอื่น · ประวัติ (events) เก็บไว้
 */
export async function deleteRun(orgId: string, actor: Actor, runId: string): Promise<void> {
  await withSalaryTenant(orgId, async (tx) => {
    const run = await lockRun(tx, orgId, runId);
    if (run.status !== "draft") throw new Error(run.status === "submitted" ? "รอบนี้ส่งให้ CEO แล้ว — ให้ CEO ส่งกลับก่อนจึงลบได้" : "รอบที่อนุมัติ/จ่ายแล้วลบไม่ได้");
    await tx.salaryRunLine.deleteMany({ where: { orgId, runId } });
    await tx.salaryRun.delete({ where: { id: runId } });
    await insertEvent(tx, orgId, { runId, byUserId: actor.userId, byName: actor.name, action: "delete", summary: `ลบร่างงวด ${periodLabel(run.period)}` });
  });
}

export async function setRunNote(orgId: string, actor: Actor, runId: string, note: string): Promise<void> {
  await withSalaryTenant(orgId, async (tx) => {
    const run = await lockRun(tx, orgId, runId);
    if (run.status === "paid") throw new Error("รอบที่จ่ายแล้วแก้ไม่ได้");
    await tx.salaryRun.update({ where: { id: runId }, data: { note } });
    await insertEvent(tx, orgId, { runId, byUserId: actor.userId, byName: actor.name, action: "note", summary: "แก้โน้ตของรอบ" });
  });
}
