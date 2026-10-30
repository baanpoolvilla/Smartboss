"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { syncUserToWorkforce } from "@/modules/admin/data/user-guards";
import { wfFetch, WorkforceError } from "@/modules/hr/lib/api";
import { notifyUsers } from "@/modules/maintenance/data/notify";
import { isOwnEmployment, salaryAccess, type SalaryAccess } from "./lib/access";
import type { Adjustment } from "./lib/compute";
import { insertEvent, readSettings, withSalaryTenant } from "./lib/db";
import { actorOf } from "./lib/page";
import { computeRun, createRun, decideRun, deleteRun, editLine, markPaid, setExcluded, setRunNote, submitRun, type Actor } from "./lib/run";
import {
  ALLOWANCE_FIELDS,
  DATE_RE,
  PERIOD_RE,
  allowanceTotal,
  normalizeAllowances,
  normalizeDiligenceSteps,
  fmtBaht,
  periodLabel,
  validateSso,
  validateTax,
  type AllowanceEntry,
  type ApprovalMode,
  type ItemKind,
  type LateMode,
  type DiligencePartial,
  type OtMode,
  type PayChannel,
  type SsoParams,
  type TaxMode,
  type TaxParams,
} from "./lib/types";

type Result<T = object> = ({ ok: true } & T) | { ok?: false; error: string };

/**
 * action ของโมดูลเงินเดือน — ทุกตัวตรวจสิทธิ์ซ้ำที่เซิร์ฟเวอร์ (ไม่เชื่อหน้าเว็บ) ด้วย lib/access.ts:
 *   canEdit (CEO + คนที่ CEO เลือก + SUPER_ADMIN ช่วงติดตั้ง) = แก้ข้อมูล/เตรียมรอบ/บันทึกจ่าย
 *   canApprove (CEO) = อนุมัติ · canManageAccess (CEO) = เปลี่ยนรายชื่อคนที่เห็นเงินเดือน
 * ตัวเลขที่รับจากฟอร์มตรวจทุกตัว (เป็นตัวเลข ไม่ติดลบ ไม่เกินสมเหตุสมผล) · ทุกการแก้บันทึกประวัติ
 */

async function guard(need: keyof Pick<SalaryAccess, "canEdit" | "canApprove" | "canManageAccess"> = "canEdit") {
  const session = await requireOrg();
  const access = await salaryAccess(session);
  if (!access[need]) {
    throw new Error(
      need === "canApprove" ? "อนุมัติเงินเดือนได้เฉพาะ CEO" : need === "canManageAccess" ? "เปลี่ยนรายชื่อได้เฉพาะ CEO" : "เฉพาะ CEO และคนที่ CEO เลือกเท่านั้นที่แก้ข้อมูลเงินเดือนได้",
    );
  }
  const actor = await actorOf(session.userId);
  return { session, access, actor, orgId: session.orgId };
}

/**
 * คนแก้เงินเดือนที่ไม่ใช่ CEO แก้ข้อมูลเงินเดือนของตัวเองไม่ได้ (ขึ้นเงินเดือน เพิ่มรายการ เปลี่ยนบัญชีรับเงิน ฯลฯ)
 * — หลักแยกหน้าที่ของระบบเงินเดือน: คนทำจ่ายห้ามแก้ของตัวเอง ให้ CEO แก้ให้ · เช็กที่ server ไม่เชื่อหน้าเว็บ
 */
async function guardFor(employmentId: string, need: "canEdit" = "canEdit") {
  const g = await guard(need);
  if (!g.access.isCeo && (await isOwnEmployment(g.orgId, g.session.userId, employmentId))) {
    throw new Error("แก้ข้อมูลเงินเดือนของตัวเองไม่ได้ — ให้ CEO เป็นคนแก้ให้ (กันการแก้ให้ตัวเอง)");
  }
  return g;
}

function fail(error: unknown): { error: string } {
  if (error instanceof WorkforceError) return { error: error.displayMessage };
  const msg = error instanceof Error ? error.message : String(error);
  // ข้อความจาก trigger ในฐานข้อมูล → ภาษาคน
  if (/lines are locked|cannot change/.test(msg)) return { error: "รอบนี้อนุมัติ/จ่ายแล้ว ตัวเลขล็อก แก้ไม่ได้" };
  if (/Unique constraint|unique/i.test(msg)) return { error: "มีข้อมูลนี้อยู่แล้ว — โหลดหน้าใหม่" };
  return { error: msg.length > 300 ? `${msg.slice(0, 300)}…` : msg };
}

/** ตัวเลขเงินจากฟอร์ม: ต้องเป็นตัวเลข ไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง ไม่เกิน max */
function money(v: unknown, label: string, max = 10_000_000): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label}: ต้องเป็นตัวเลขไม่ติดลบ`);
  if (Math.round(n * 100) / 100 !== Math.round(n * 1e6) / 1e6) throw new Error(`${label}: ทศนิยมได้ไม่เกิน 2 ตำแหน่ง`);
  if (n > max) throw new Error(`${label}: สูงผิดปกติ (เกิน ${max.toLocaleString("en-US")})`);
  return Math.round(n * 100) / 100;
}

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

function refresh(runId?: string) {
  revalidatePath("/salary", "layout");
  if (runId) revalidatePath(`/salary/runs/${runId}`);
}

/* ═════════════════════════ ใครเห็นเงินเดือนได้ (CEO) ═════════════════════════ */

export async function saveAccessAction(input: { editorUserIds: string[]; superAdminAccess: boolean }): Promise<Result> {
  try {
    const { orgId, actor, session } = await guard("canManageAccess");
    const wanted = [...new Set(input.editorUserIds.filter((x) => typeof x === "string"))].slice(0, 20);
    // คนในรายชื่อต้องเป็นผู้ใช้ที่ยังใช้งานของบริษัทนี้ (กันใส่ id บริษัทอื่น)
    const valid = await prisma.user.findMany({ where: { orgId, id: { in: wanted }, isActive: true }, select: { id: true, name: true } });
    const ids = valid.map((u) => u.id);
    const before = await withSalaryTenant(orgId, async (tx) => {
      const old = await readSettings(tx, orgId);
      await tx.salarySettings.upsert({
        where: { orgId },
        create: { orgId, editorUserIds: ids, superAdminAccess: !!input.superAdminAccess, updatedByName: actor.name },
        update: { editorUserIds: ids, superAdminAccess: !!input.superAdminAccess, updatedByName: actor.name },
      });
      const added = ids.filter((x) => !old.editorUserIds.includes(x));
      const removed = old.editorUserIds.filter((x) => !ids.includes(x));
      const nameOf = async (id: string) => valid.find((u) => u.id === id)?.name ?? (await prisma.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? id;
      const summary = [
        added.length ? `เพิ่ม ${(await Promise.all(added.map(nameOf))).join(", ")}` : null,
        removed.length ? `เอาออก ${(await Promise.all(removed.map(nameOf))).join(", ")}` : null,
        old.superAdminAccess !== !!input.superAdminAccess ? `ผู้ดูแลระบบสูงสุด${input.superAdminAccess ? "เห็นได้" : "ไม่เห็นแล้ว"}` : null,
      ].filter(Boolean).join(" · ");
      if (summary) await insertEvent(tx, orgId, { byUserId: actor.userId, byName: actor.name, action: "access", summary: `คนที่เห็นเงินเดือน: ${summary}` });
      return { old, added, removed, summary };
    });
    // ส่งสิทธิ์ใหม่ไประบบบุคคล (ฐานเงินเดือนที่ API) ให้คนที่ถูกเพิ่ม/เอาออก + SUPER_ADMIN เมื่อสวิตช์เปลี่ยน
    const resync = new Set([...before.added, ...before.removed]);
    if (before.old.superAdminAccess !== !!input.superAdminAccess) {
      const supers = await prisma.user.findMany({ where: { orgId, roles: { some: { role: { code: "SUPER_ADMIN" } } } }, select: { id: true } });
      supers.forEach((u) => resync.add(u.id));
    }
    for (const id of resync) await syncUserToWorkforce(id, orgId, session.userId);
    // แจ้ง CEO คนอื่น ๆ ทุกครั้งที่รายชื่อเปลี่ยน (ไม่มีใครแอบเพิ่มตัวเองได้เงียบ ๆ)
    if (before.summary) {
      const ceos = await prisma.user.findMany({ where: { orgId, isActive: true, roles: { some: { role: { code: "CEO" } } } }, select: { id: true } });
      await notifyUsers(orgId, ceos.map((u) => u.id).filter((id) => id !== session.userId), {
        title: "คนที่เห็นข้อมูลเงินเดือนเปลี่ยน",
        body: `${before.summary} · โดย ${actor.name}`,
        type: "salary_access",
      });
    }
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* ═════════════════════════ ตั้งค่า ═════════════════════════ */

export interface SettingsInput {
  cutoffDay: number;
  payDay: number;
  approvalMode: ApprovalMode;
  changeThreshold: number;
  deductLate: boolean;
  lateMode: LateMode;
  latePerTime: number;
  deductAbsent: boolean;
  deductUnpaidLeave: boolean;
  otSsoBase: boolean;
  taxEnabled: boolean;
  otMode: OtMode;
  diligenceEnabled: boolean;
  diligenceSteps: number[];
  diligencePartial: DiligencePartial;
  companyTaxId: string;
  ssoEmployerNo: string;
  ssoBranch: string;
  payBankName: string;
  payBankAccount: string;
}

export async function saveSettingsAction(input: SettingsInput): Promise<Result> {
  try {
    const { orgId, actor } = await guard("canEdit");
    const cutoffDay = Math.trunc(Number(input.cutoffDay));
    const payDay = Math.trunc(Number(input.payDay));
    if (!(cutoffDay >= 1 && cutoffDay <= 31)) return { error: "วันตัดงวดต้องเป็น 1–31" };
    if (!(payDay >= 0 && payDay <= 31)) return { error: "วันจ่ายต้องเป็น 1–31 (หรือสิ้นเดือน)" };
    if (!["ceo", "ceo_on_change", "hr"].includes(input.approvalMode)) return { error: "วิธีอนุมัติไม่ถูกต้อง" };
    if (!["minute", "per_time"].includes(input.lateMode)) return { error: "วิธีหักสายไม่ถูกต้อง" };
    const changeThreshold = money(input.changeThreshold, "% ที่ต้องผ่าน CEO", 100);
    const latePerTime = money(input.latePerTime, "หักสายครั้งละ", 10_000);
    const taxId = text(input.companyTaxId, 20).replace(/\D/g, "");
    if (taxId && taxId.length !== 13) return { error: "เลขผู้เสียภาษีบริษัทต้องมี 13 หลัก" };
    const ssoNo = text(input.ssoEmployerNo, 20).replace(/\D/g, "");
    if (ssoNo && ssoNo.length !== 10) return { error: "เลขบัญชีนายจ้างประกันสังคมต้องมี 10 หลัก" };
    const branch = text(input.ssoBranch, 6).replace(/\D/g, "").padStart(6, "0");
    if (input.otMode !== "hours" && input.otMode !== "days") return { error: "วิธีคิด OT ไม่ถูกต้อง" };
    const diligenceSteps = normalizeDiligenceSteps(input.diligenceSteps);
    if (!diligenceSteps) return { error: "ขั้นเบี้ยขยันต้องเป็นตัวเลขมากกว่า 0 เรียงจากน้อยไปมาก 1–6 ขั้น (เช่น 500, 800, 1000)" };
    if (!["none", "prorate", "full"].includes(input.diligencePartial)) return { error: "ตัวเลือกเบี้ยขยันคนเข้า/ออกกลางรอบไม่ถูกต้อง" };
    const data = {
      cutoffDay,
      payDay,
      approvalMode: input.approvalMode,
      changeThreshold,
      deductLate: !!input.deductLate,
      lateMode: input.lateMode,
      latePerTime,
      deductAbsent: !!input.deductAbsent,
      deductUnpaidLeave: !!input.deductUnpaidLeave,
      otSsoBase: !!input.otSsoBase,
      taxEnabled: !!input.taxEnabled,
      otMode: input.otMode,
      diligenceEnabled: !!input.diligenceEnabled,
      diligenceSteps,
      diligencePartial: input.diligencePartial,
      companyTaxId: taxId,
      ssoEmployerNo: ssoNo,
      ssoBranch: branch,
      payBankName: text(input.payBankName, 60),
      payBankAccount: text(input.payBankAccount, 30).replace(/[^\d-]/g, ""),
      updatedByName: actor.name,
    };
    await withSalaryTenant(orgId, async (tx) => {
      await tx.salarySettings.upsert({ where: { orgId }, create: { orgId, ...data }, update: data });
      await insertEvent(tx, orgId, { byUserId: actor.userId, byName: actor.name, action: "settings", summary: "แก้ตั้งค่าเงินเดือน", detail: data });
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/**
 * สวิตช์รวม "ภาษีหัก ณ ที่จ่าย + ชื่อรายการปรับเพิ่ม/ปรับลด" (ผู้ใช้ 30/10/2569)
 * ปิด = ไม่คิดภาษี และปิดทุกชื่อรายการ — HR พิมพ์รายเพิ่ม/รายหักเองในรายเพิ่ม–รายหักรายคน
 * เปิด = เปิดภาษี + ทุกชื่อรายการ แล้วค่อยปิดทีละอันที่ไม่ใช้ · รายการประจำรายคนที่ตั้งไว้แล้วยังอยู่ ไม่ถูกลบ
 */
export async function setTaxAndItemsAction(input: { on: boolean }): Promise<Result> {
  try {
    const { orgId, actor } = await guard("canEdit");
    const on = !!input.on;
    await withSalaryTenant(orgId, async (tx) => {
      await tx.salarySettings.upsert({ where: { orgId }, create: { orgId, taxEnabled: on, updatedByName: actor.name }, update: { taxEnabled: on, updatedByName: actor.name } });
      await tx.salaryItem.updateMany({ where: { orgId }, data: { active: on } });
      await insertEvent(tx, orgId, { byUserId: actor.userId, byName: actor.name, action: "settings", summary: on ? "เปิดภาษีหัก ณ ที่จ่าย + ชื่อรายการปรับเพิ่ม/ลดทั้งหมด" : "ปิดภาษีหัก ณ ที่จ่าย + ชื่อรายการปรับเพิ่ม/ลดทั้งหมด" });
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** อัตราประกันสังคม/ภาษีใหม่ — เพิ่มแถวที่มีวันเริ่มมีผล (งวดเก่าคิดด้วยอัตราเดิม ไม่แก้ย้อนหลัง) */
export async function addRateAction(input: { kind: "sso" | "tax"; effectiveFrom: string; params: SsoParams | TaxParams }): Promise<Result> {
  try {
    const { orgId, actor } = await guard("canEdit");
    if (!DATE_RE.test(input.effectiveFrom)) return { error: "วันที่มีผลไม่ถูกต้อง" };
    let params: SsoParams | TaxParams;
    if (input.kind === "sso") {
      const p = input.params as SsoParams;
      params = {
        employeeRate: money(p.employeeRate, "% ลูกจ้าง", 20),
        employerRate: money(p.employerRate, "% บริษัท", 20),
        wageFloor: money(p.wageFloor, "ค่าจ้างต่ำสุด", 1_000_000),
        wageCeiling: money(p.wageCeiling, "เพดานค่าจ้าง", 1_000_000),
        maxContribution: money(p.maxContribution, "สมทบสูงสุด", 100_000),
      };
      const err = validateSso(params);
      if (err) return { error: err };
    } else if (input.kind === "tax") {
      const p = input.params as TaxParams;
      params = {
        expenseRate: money(p.expenseRate, "% หักค่าใช้จ่าย", 100),
        expenseCap: money(p.expenseCap, "ค่าใช้จ่ายไม่เกิน", 100_000_000),
        personalAllowance: money(p.personalAllowance, "ลดหย่อนส่วนตัว", 100_000_000),
        brackets: (p.brackets ?? []).slice(0, 20).map((b, i) => ({ upTo: b.upTo === null ? null : money(b.upTo, `ขั้นที่ ${i + 1}`, 1_000_000_000), rate: money(b.rate, `อัตราขั้นที่ ${i + 1}`, 100) })),
      };
      const err = validateTax(params);
      if (err) return { error: err };
    } else return { error: "ชนิดอัตราไม่ถูกต้อง" };
    await withSalaryTenant(orgId, async (tx) => {
      await tx.salaryRate.create({ data: { orgId, kind: input.kind, effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00Z`), params: params as unknown as object, createdByName: actor.name } });
      await insertEvent(tx, orgId, { byUserId: actor.userId, byName: actor.name, action: "rate", summary: `${input.kind === "sso" ? "อัตราประกันสังคม" : "อัตราภาษี"}ใหม่ มีผล ${input.effectiveFrom}`, detail: params });
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* ═════════════════════════ ชื่อรายการเงินได้/รายการหัก ═════════════════════════ */

export async function saveItemAction(input: { id?: string | null; name: string; kind: ItemKind; taxable: boolean; ssoBase: boolean; active: boolean }): Promise<Result<{ id: string }>> {
  try {
    const { orgId, actor } = await guard("canEdit");
    const name = text(input.name, 50);
    if (!name) return { error: "ใส่ชื่อรายการ" };
    if (input.kind !== "earning" && input.kind !== "deduction") return { error: "ชนิดรายการไม่ถูกต้อง" };
    const id = await withSalaryTenant(orgId, async (tx) => {
      const dup = await tx.salaryItem.findFirst({ where: { orgId, name, kind: input.kind, ...(input.id ? { id: { not: input.id } } : {}) } });
      if (dup) throw new Error(`มีรายการ "${name}" อยู่แล้ว`);
      const data = { name, kind: input.kind, taxable: input.kind === "earning" ? !!input.taxable : false, ssoBase: input.kind === "earning" ? !!input.ssoBase : false, active: !!input.active };
      const row = input.id
        ? await tx.salaryItem.update({ where: { id: input.id }, data }).catch(() => null)
        : await tx.salaryItem.create({ data: { orgId, ...data } });
      if (!row) throw new Error("ไม่พบรายการ");
      await insertEvent(tx, orgId, { byUserId: actor.userId, byName: actor.name, action: "item", summary: `${input.id ? "แก้" : "เพิ่ม"}ชื่อรายการ "${name}"` });
      return row.id;
    });
    refresh();
    return { ok: true, id };
  } catch (error) {
    return fail(error);
  }
}

/* ═════════════════════════ ข้อมูลเงินเดือนรายคน ═════════════════════════ */

export interface ProfileInput {
  employmentId: string;
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
  prevIncome: number;
  prevTax: number;
  prevSso: number;
  prevYear: number | null;
  /** ไม่ส่งมา = ไม่แก้ (หน้าจอเก่า) */
  diligenceEligible?: boolean;
  /** ขั้นรอบล่าสุดจากระบบเดิม (บาท) · null = ไม่มี */
  diligenceOpening?: number | null;
}

export async function saveProfileAction(input: ProfileInput): Promise<Result<{ notes: string[] }>> {
  try {
    const { orgId, actor } = await guardFor(input.employmentId);
    if (!input.employmentId) return { error: "ไม่พบพนักงาน" };
    if (input.payChannel !== "transfer" && input.payChannel !== "cash") return { error: "ช่องทางรับเงินไม่ถูกต้อง" };
    const account = text(input.bankAccount, 30).replace(/\D/g, "");
    if (input.payChannel === "transfer" && account && (account.length < 10 || account.length > 15)) return { error: "เลขบัญชีควรมี 10–15 หลัก" };
    if (input.ssoExempt && !text(input.ssoExemptReason, 200)) return { error: "ไม่หักประกันสังคม — ใส่เหตุผล" };
    if (!["auto", "fixed", "none"].includes(input.taxMode)) return { error: "วิธีหักภาษีไม่ถูกต้อง" };
    if (input.taxMode === "none" && !text(input.taxNoneReason, 200)) return { error: "ไม่หักภาษี — ใส่เหตุผล" };
    const known = new Map(ALLOWANCE_FIELDS.map((f) => [f.key, f.label]));
    const raw: AllowanceEntry[] = (input.allowances ?? [])
      .slice(0, 30)
      .map((a) => ({
        key: text(a.key, 40) || `other_${randomUUID().slice(0, 6)}`,
        label: known.get(a.key) ?? text(a.label, 60),
        amount: money(a.amount, `ค่าลดหย่อน ${a.label}`, 10_000_000),
        ...(a.count !== undefined ? { count: Math.max(0, Math.min(99, Math.floor(Number(a.count) || 0))) } : {}),
      }))
      .filter((a) => a.label);
    // นับคน × อัตรา และตัดที่เพดานตามกฎหมาย — ตัวเดียวกับที่หน้าจอใช้โชว์ จึงตรงกันเสมอ
    const { list: allowances, notes } = normalizeAllowances(raw);
    const data = {
      payChannel: input.payChannel,
      bankName: text(input.bankName, 60),
      bankAccount: account,
      accountName: text(input.accountName, 100),
      ssoExempt: !!input.ssoExempt,
      ssoExemptReason: input.ssoExempt ? text(input.ssoExemptReason, 200) : "",
      taxMode: input.taxMode,
      taxFixedAmount: input.taxMode === "fixed" ? money(input.taxFixedAmount, "ภาษีหักคงที่", 1_000_000) : 0,
      taxNoneReason: input.taxMode === "none" ? text(input.taxNoneReason, 200) : "",
      allowances: allowances as unknown as object,
      extraAllowance: allowanceTotal(allowances),
      prevIncome: money(input.prevIncome, "เงินได้สะสม"),
      prevTax: money(input.prevTax, "ภาษีสะสมที่หักไปแล้ว"),
      prevSso: money(input.prevSso ?? 0, "ประกันสังคมสะสม", 100_000),
      prevYear: input.prevYear && Number.isInteger(input.prevYear) ? input.prevYear : null,
      ...(input.diligenceEligible !== undefined ? { diligenceEligible: !!input.diligenceEligible } : {}),
      ...(input.diligenceOpening !== undefined ? { diligenceOpening: input.diligenceOpening === null ? null : money(input.diligenceOpening, "ขั้นเบี้ยขยันยกมา", 1_000_000) } : {}),
      updatedByName: actor.name,
    };
    await withSalaryTenant(orgId, async (tx) => {
      await tx.salaryProfile.upsert({ where: { orgId_employmentId: { orgId, employmentId: input.employmentId } }, create: { orgId, employmentId: input.employmentId, ...data }, update: data });
      await insertEvent(tx, orgId, { byUserId: actor.userId, byName: actor.name, action: "employee", summary: `แก้ข้อมูลเงินเดือนรายคน (${input.employmentId.slice(0, 8)})` });
    });
    refresh();
    return { ok: true, notes };
  } catch (error) {
    return fail(error);
  }
}

/** ตั้ง/ขึ้นเงินเดือน — เก็บที่ระบบบุคคลแบบมีวันมีผล (ประวัติเดิมยังอยู่) */
export async function setSalaryAction(input: { employmentId: string; amount: number; effectiveFrom: string; reason: string }): Promise<Result> {
  try {
    const { orgId, actor } = await guardFor(input.employmentId);
    const amount = money(input.amount, "เงินเดือน", 10_000_000);
    if (amount <= 0) return { error: "ใส่เงินเดือน" };
    if (!DATE_RE.test(input.effectiveFrom)) return { error: "วันที่มีผลไม่ถูกต้อง" };
    const reason = text(input.reason, 200);
    try {
      await wfFetch("/compensation-rates", {
        method: "POST",
        body: {
          employment_id: input.employmentId,
          pay_basis: "MONTHLY",
          amount: amount.toFixed(2),
          currency: "THB",
          effective_from: input.effectiveFrom,
          note: reason || "ตั้งจากโมดูลเงินเดือน",
          supersede_current: true,
        },
      });
    } catch (error) {
      if (error instanceof WorkforceError && error.status === 403) {
        return { error: "ระบบบุคคลยังไม่ได้เปิดสิทธิ์ฐานเงินเดือนให้บัญชีนี้ — ให้ CEO เอาชื่อออกแล้วเพิ่มใหม่ที่ ตั้งค่า › คนที่เห็นเงินเดือน แล้วลองอีกครั้ง" };
      }
      throw error;
    }
    await withSalaryTenant(orgId, (tx) =>
      insertEvent(tx, orgId, { byUserId: actor.userId, byName: actor.name, action: "employee", summary: `ตั้งเงินเดือน ${fmtBaht(amount)} มีผล ${input.effectiveFrom}${reason ? ` · ${reason}` : ""} (${input.employmentId.slice(0, 8)})` }),
    );
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function addRecurringAction(input: { employmentId: string; itemId: string; amount: number; fromPeriod: string; toPeriod: string | null; note: string }): Promise<Result> {
  try {
    const { orgId, actor } = await guardFor(input.employmentId);
    const amount = money(input.amount, "จำนวนเงิน", 10_000_000);
    if (amount <= 0) return { error: "ใส่จำนวนเงิน" };
    if (!PERIOD_RE.test(input.fromPeriod)) return { error: "งวดเริ่มไม่ถูกต้อง" };
    if (input.toPeriod && (!PERIOD_RE.test(input.toPeriod) || input.toPeriod < input.fromPeriod)) return { error: "งวดสุดท้ายต้องไม่ก่อนงวดเริ่ม" };
    await withSalaryTenant(orgId, async (tx) => {
      const item = await tx.salaryItem.findFirst({ where: { orgId, id: input.itemId } });
      if (!item) throw new Error("ไม่พบชื่อรายการ");
      await tx.salaryEmployeeItem.create({ data: { orgId, employmentId: input.employmentId, itemId: item.id, amount, fromPeriod: input.fromPeriod, toPeriod: input.toPeriod, note: text(input.note, 200), createdByName: actor.name } });
      await insertEvent(tx, orgId, { byUserId: actor.userId, byName: actor.name, action: "employee", summary: `รายการประจำ "${item.name}" ${fmtBaht(amount)} ตั้งแต่ ${periodLabel(input.fromPeriod)}${input.toPeriod ? ` ถึง ${periodLabel(input.toPeriod)}` : ""}` });
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function endRecurringAction(input: { id: string }): Promise<Result> {
  try {
    const { orgId, actor, access, session } = await guard("canEdit");
    await withSalaryTenant(orgId, async (tx) => {
      const row = await tx.salaryEmployeeItem.findFirst({ where: { orgId, id: input.id, endedAt: null } });
      if (!row) throw new Error("ไม่พบรายการ (อาจเลิกไปแล้ว)");
      if (!access.isCeo && (await isOwnEmployment(orgId, session.userId, row.employmentId))) throw new Error("แก้ข้อมูลเงินเดือนของตัวเองไม่ได้ — ให้ CEO เป็นคนแก้ให้");
      await tx.salaryEmployeeItem.update({ where: { id: row.id }, data: { endedAt: new Date(), endedByName: actor.name } });
      await insertEvent(tx, orgId, { byUserId: actor.userId, byName: actor.name, action: "employee", summary: `เลิกรายการประจำ ${fmtBaht(Number(row.amount))}` });
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* ═════════════════════════ รอบเงินเดือน ═════════════════════════ */

export async function createRunAction(input: { period: string; startsOn: string; endsOn: string; payDate: string }): Promise<Result<{ id: string }>> {
  try {
    const { orgId, actor } = await guard("canEdit");
    if (!PERIOD_RE.test(input.period)) return { error: "งวดไม่ถูกต้อง" };
    if (![input.startsOn, input.endsOn, input.payDate].every((d) => DATE_RE.test(d))) return { error: "วันที่ไม่ถูกต้อง" };
    if (input.startsOn > input.endsOn) return { error: "วันเริ่มต้องไม่หลังวันตัดงวด" };
    if (input.payDate < input.startsOn) return { error: "วันจ่ายต้องไม่ก่อนวันเริ่มงวด" };
    const days = (Date.parse(input.endsOn) - Date.parse(input.startsOn)) / 86_400_000 + 1;
    if (days < 25 || days > 35) return { error: `งวดยาว ${days} วัน — งวดเงินเดือนรายเดือนควรยาว 28–31 วัน ตรวจวันที่อีกครั้ง` };
    const id = await createRun(orgId, actor, input);
    refresh(id);
    return { ok: true, id };
  } catch (error) {
    return fail(error);
  }
}

export async function recomputeAction(input: { runId: string }): Promise<Result> {
  try {
    const { orgId, actor } = await guard("canEdit");
    await computeRun(orgId, input.runId, actor);
    refresh(input.runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export interface AdjustInput {
  runId: string;
  employmentId: string;
  expectUpdatedAt: string | null;
  kind: ItemKind;
  /** ชื่อจากรายการที่ตั้งไว้ หรือพิมพ์เอง ("อื่นๆ") */
  itemId: string | null;
  label: string;
  amount: number;
  taxable: boolean;
  ssoBase: boolean;
  reason: string;
  /** once = งวดนี้ · monthly = ทุกเดือน · months = ผ่อน N เดือน (เริ่มงวดนี้) */
  repeat: "once" | "monthly" | "months";
  months: number;
  /** จำชื่อที่พิมพ์เองไว้เป็นรายการในตั้งค่า */
  saveName: boolean;
}

export async function addAdjustmentAction(input: AdjustInput): Promise<Result> {
  try {
    const { orgId, actor } = await guardFor(input.employmentId);
    const amount = money(input.amount, "จำนวนเงิน", 10_000_000);
    if (amount <= 0) return { error: "ใส่จำนวนเงิน" };
    const reason = text(input.reason, 300);
    if (!reason) return { error: "ใส่หมายเหตุ (CEO เห็นตอนอนุมัติ)" };
    if (input.kind !== "earning" && input.kind !== "deduction") return { error: "ชนิดรายการไม่ถูกต้อง" };
    // ชื่อ: จากรายการที่ตั้งไว้ (ใช้ธงภาษี/ประกันสังคมของรายการนั้น) หรือพิมพ์เอง
    let label = text(input.label, 50);
    let taxable = input.kind === "earning" ? !!input.taxable : false;
    let ssoBase = input.kind === "earning" ? !!input.ssoBase : false;
    let itemId = input.itemId;
    const run = await withSalaryTenant(orgId, async (tx) => {
      const r = await tx.salaryRun.findFirst({ where: { orgId, id: input.runId } });
      if (!r) throw new Error("ไม่พบรอบ");
      if (itemId) {
        const item = await tx.salaryItem.findFirst({ where: { orgId, id: itemId } });
        if (!item) throw new Error("ไม่พบชื่อรายการ");
        label = item.name;
        taxable = item.taxable;
        ssoBase = item.ssoBase;
      } else {
        if (!label) throw new Error("พิมพ์ชื่อรายการ");
        if (input.saveName || input.repeat !== "once") {
          const found = await tx.salaryItem.findFirst({ where: { orgId, name: label, kind: input.kind } });
          itemId = found ? found.id : (await tx.salaryItem.create({ data: { orgId, name: label, kind: input.kind, taxable, ssoBase } })).id;
        }
      }
      // ทุกเดือน / ผ่อน: สร้างเป็นรายการประจำของคนนี้ เริ่มงวดนี้ (คำนวณใหม่แล้วจะเข้ามาเองในฐานะรายการประจำ)
      if (input.repeat !== "once") {
        const months = Math.trunc(Number(input.months));
        if (input.repeat === "months" && !(months >= 2 && months <= 60)) throw new Error("ผ่อนได้ 2–60 เดือน");
        const [y, m] = r.period.split("-").map(Number) as [number, number];
        const endIdx = y * 12 + (m - 1) + (input.repeat === "months" ? months - 1 : 0);
        const toPeriod = input.repeat === "months" ? `${Math.floor(endIdx / 12)}-${String((endIdx % 12) + 1).padStart(2, "0")}` : null;
        await tx.salaryEmployeeItem.create({ data: { orgId, employmentId: input.employmentId, itemId: itemId!, amount, fromPeriod: r.period, toPeriod, note: reason, createdByName: actor.name } });
      }
      return r;
    });
    if (input.repeat === "once") {
      const adj: Adjustment = { id: randomUUID(), label, kind: input.kind, amount, taxable, ssoBase, reason, byName: actor.name };
      await editLine(orgId, actor, input, (line) => ({
        adjustments: [...line.adjustments, adj],
        info: line.info,
        summary: `${input.kind === "earning" ? "เพิ่ม" : "หัก"} "${label}" ${fmtBaht(amount)} · ${reason}`,
      }));
    } else {
      await computeRun(orgId, run.id, actor);
    }
    refresh(input.runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function removeAdjustmentAction(input: { runId: string; employmentId: string; expectUpdatedAt: string | null; adjustmentId: string }): Promise<Result> {
  try {
    const { orgId, actor } = await guardFor(input.employmentId);
    await editLine(orgId, actor, input, (line) => {
      const gone = line.adjustments.find((a) => a.id === input.adjustmentId);
      if (!gone) throw new Error("ไม่พบรายการ (อาจถูกลบไปแล้ว)");
      return { adjustments: line.adjustments.filter((a) => a.id !== input.adjustmentId), info: line.info, summary: `ลบรายการ "${gone.label}" ${fmtBaht(gone.amount)}` };
    });
    refresh(input.runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** แก้รายเพิ่ม/รายหักงวดนี้ (ประเภท · รายละเอียด · จำนวนเงิน) — ก่อนส่งอนุมัติเท่านั้น */
export async function updateAdjustmentAction(input: {
  runId: string;
  employmentId: string;
  expectUpdatedAt: string | null;
  adjustmentId: string;
  label: string;
  reason: string;
  amount: number;
}): Promise<Result> {
  try {
    const { orgId, actor } = await guardFor(input.employmentId);
    const amount = money(input.amount, "จำนวนเงิน", 10_000_000);
    if (amount <= 0) return { error: "ใส่จำนวนเงิน (ไม่ใช้แล้วให้กดลบ)" };
    const label = text(input.label, 50);
    if (!label) return { error: "ใส่ประเภทรายการ" };
    const reason = text(input.reason, 300);
    if (!reason) return { error: "ใส่รายละเอียด (CEO เห็นตอนอนุมัติ)" };
    await editLine(orgId, actor, input, (line) => {
      const old = line.adjustments.find((a) => a.id === input.adjustmentId);
      if (!old) throw new Error("ไม่พบรายการ (อาจถูกลบไปแล้ว)");
      const changes = [
        old.label !== label ? `ประเภท "${old.label}" → "${label}"` : null,
        old.amount !== amount ? `${fmtBaht(old.amount)} → ${fmtBaht(amount)}` : null,
        old.reason !== reason ? `รายละเอียด "${old.reason}" → "${reason}"` : null,
      ].filter(Boolean);
      return {
        adjustments: line.adjustments.map((a) => (a.id === old.id ? { ...a, label, reason, amount, byName: actor.name } : a)),
        info: line.info,
        summary: `แก้${old.kind === "earning" ? "รายเพิ่ม" : "รายหัก"} "${old.label}": ${changes.join(" · ") || "ไม่เปลี่ยน"}`,
      };
    });
    refresh(input.runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** ปรับยอดประกันสังคม/ภาษีงวดนี้เอง (ต้องมีเหตุผล) · amount null = กลับไปใช้ที่ระบบคิด */
export async function overrideAction(input: { runId: string; employmentId: string; expectUpdatedAt: string | null; which: "sso" | "tax" | "commission" | "diligence"; amount: number | null; reason: string }): Promise<Result> {
  try {
    const { orgId, actor } = await guardFor(input.employmentId);
    if (!["sso", "tax", "commission", "diligence"].includes(input.which)) return { error: "รายการไม่ถูกต้อง" };
    const reason = text(input.reason, 300);
    const name = input.which === "sso" ? "ประกันสังคม" : input.which === "tax" ? "ภาษี" : input.which === "commission" ? "ค่าคอม" : "เบี้ยขยัน";
    const amount = input.amount === null ? null : money(input.amount, name, input.which === "commission" ? 10_000_000 : 1_000_000);
    if (amount !== null && !reason) return { error: "ใส่เหตุผลที่ปรับ" };
    await editLine(orgId, actor, input, (line) => {
      const overrides = { ...(line.info.overrides ?? {}) };
      if (amount === null) delete overrides[input.which];
      else overrides[input.which] = { amount, reason, byName: actor.name };
      return { adjustments: line.adjustments, info: { ...line.info, overrides }, summary: amount === null ? `${name}กลับไปใช้ที่ระบบคิด` : `ปรับ${name}เป็น ${fmtBaht(amount)} · ${reason}` };
    });
    refresh(input.runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** เลื่อนหักเบิกล่วงหน้าใบนี้ไปงวดหน้า (เช่น ยอดสุทธิไม่พอหัก) / กลับมาหักงวดนี้ */
export async function deferAdvanceAction(input: { runId: string; employmentId: string; expectUpdatedAt: string | null; requestId: string; defer: boolean }): Promise<Result> {
  try {
    const { orgId, actor } = await guardFor(input.employmentId);
    await editLine(orgId, actor, input, (line) => {
      const cur = new Set(line.info.deferAdvances ?? []);
      if (input.defer) cur.add(input.requestId);
      else cur.delete(input.requestId);
      return { adjustments: line.adjustments, info: { ...line.info, deferAdvances: [...cur] }, summary: input.defer ? "เลื่อนหักเบิกล่วงหน้าไปงวดหน้า" : "กลับมาหักเบิกล่วงหน้างวดนี้" };
    });
    refresh(input.runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function submitRunAction(input: { runId: string }): Promise<Result<{ auto: boolean }>> {
  try {
    const { orgId, actor, session } = await guard("canEdit");
    const res = await submitRun(orgId, actor, input.runId);
    const run = await withSalaryTenant(orgId, (tx) => tx.salaryRun.findFirst({ where: { orgId, id: input.runId }, select: { period: true } }));
    const label = run ? periodLabel(run.period) : "";
    // แจ้ง CEO (ไม่ใส่ยอดเงินในแจ้งเตือน — ขึ้นบนหน้าจอล็อกได้)
    const ceos = await prisma.user.findMany({ where: { orgId, isActive: true, roles: { some: { role: { code: "CEO" } } } }, select: { id: true } });
    await notifyUsers(orgId, ceos.map((u) => u.id).filter((id) => id !== session.userId), {
      title: res.auto ? `เงินเดือน ${label} อนุมัติแล้ว (ตามตั้งค่า)` : `เงินเดือน ${label} รออนุมัติ`,
      body: `ส่งโดย ${actor.name}`,
      type: "salary_run",
      referenceId: input.runId,
    });
    refresh(input.runId);
    return { ok: true, auto: res.auto };
  } catch (error) {
    return fail(error);
  }
}

export async function decideRunAction(input: { runId: string; outcome: "approve" | "return"; note: string }): Promise<Result> {
  try {
    const { orgId, actor } = await guard(input.outcome === "approve" ? "canApprove" : "canEdit");
    const note = text(input.note, 500);
    await decideRun(orgId, actor, input.runId, input.outcome, note);
    const run = await withSalaryTenant(orgId, (tx) => tx.salaryRun.findFirst({ where: { orgId, id: input.runId }, select: { period: true, submittedBy: true } }));
    if (run?.submittedBy && run.submittedBy !== actor.userId) {
      await notifyUsers(orgId, [run.submittedBy], {
        title: input.outcome === "approve" ? `CEO อนุมัติเงินเดือน ${periodLabel(run.period)} แล้ว` : `เงินเดือน ${periodLabel(run.period)} ถูกส่งกลับให้แก้`,
        body: input.outcome === "approve" ? "บันทึกจ่ายเมื่อโอนเสร็จ" : note,
        type: "salary_run",
        referenceId: input.runId,
      });
    }
    refresh(input.runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function markPaidAction(input: { runId: string; paidOn: string; bankFee: number }): Promise<Result> {
  try {
    const { orgId, actor } = await guard("canEdit");
    if (!DATE_RE.test(input.paidOn)) return { error: "วันที่โอนไม่ถูกต้อง" };
    const bankFee = money(input.bankFee ?? 0, "ค่าธรรมเนียม", 100_000);
    const { notify } = await markPaid(orgId, actor as Actor, input.runId, input.paidOn, bankFee);
    const run = await withSalaryTenant(orgId, (tx) => tx.salaryRun.findFirst({ where: { orgId, id: input.runId }, select: { period: true } }));
    // พนักงานได้แจ้งเตือนว่าสลิปพร้อม — ไม่ใส่ยอดเงิน (ขึ้นบนหน้าจอล็อก/ให้คนข้าง ๆ เห็นได้)
    await notifyUsers(orgId, notify.map((n) => n.userId), {
      title: `สลิปเงินเดือน ${run ? periodLabel(run.period) : ""} พร้อมแล้ว`,
      body: "เปิดดูรายละเอียดได้ที่เมนูเงินเดือน",
      type: "salary_slip",
      referenceId: input.runId,
    });
    refresh(input.runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** พนักงานรับเงินสด: กด "ได้รับเงินแล้ว" ที่สลิปของตัวเอง */
export async function confirmCashAction(input: { runId: string }): Promise<Result> {
  try {
    const session = await requireOrg();
    const orgId = session.orgId;
    await withSalaryTenant(orgId, async (tx) => {
      const run = await tx.salaryRun.findFirst({ where: { orgId, id: input.runId, status: "paid" } });
      if (!run) throw new Error("ไม่พบสลิป");
      const line = await tx.salaryRunLine.findFirst({ where: { orgId, runId: run.id, userId: session.userId } });
      if (!line) throw new Error("ไม่พบสลิปของคุณในงวดนี้");
      // รอบที่จ่ายแล้วแก้ไม่ได้ (trigger) — บันทึกการรับเงินเป็นประวัติแทน
      await insertEvent(tx, orgId, { runId: run.id, byUserId: session.userId, byName: line.name, action: "received", summary: `${line.name} ยืนยันได้รับเงินสดแล้ว` });
    });
    revalidatePath("/salary");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function excludeAction(input: { runId: string; employmentId: string; exclude: boolean; reason: string }): Promise<Result> {
  try {
    const { orgId, actor } = await guardFor(input.employmentId);
    const reason = text(input.reason, 300);
    if (input.exclude && !reason) return { error: "ใส่เหตุผลที่ไม่จ่ายงวดนี้" };
    await setExcluded(orgId, actor, input.runId, input.employmentId, input.exclude, reason);
    refresh(input.runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteRunAction(input: { runId: string }): Promise<Result> {
  try {
    const { orgId, actor } = await guard("canEdit");
    await deleteRun(orgId, actor, input.runId);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function runNoteAction(input: { runId: string; note: string }): Promise<Result> {
  try {
    const { orgId, actor } = await guard("canEdit");
    await setRunNote(orgId, actor, input.runId, text(input.note, 2000));
    refresh(input.runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
