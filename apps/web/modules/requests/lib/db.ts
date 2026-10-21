import "server-only";
import { prisma } from "@smartboss/database";

import {
  DEFAULT_SETTINGS,
  type ApproverLevel,
  type Attachment,
  type BeneficiaryKind,
  type OtRate,
  type PaymentMethod,
  type RequestKind,
  type RequestSettings,
  type RequestStatus,
  type AdvanceCapMode,
  type ApprovalRoute,
} from "./types";

/**
 * ที่เก็บของโมดูลเบิกจ่าย & OT — schema requests (migration 20261021120000_requests_module)
 *
 * ทุกตารางเปิด RLS แบบ FORCE ผูกกับบริษัท: อ่าน/เขียนได้เฉพาะใน withRequestsTenant() ที่
 *   1) SET LOCAL ROLE workforce_app — role ธรรมดา (ไม่ใช่ superuser/BYPASSRLS) ให้ policy มีผลจริง
 *   2) set_config('requests.org_id', orgId) — บริษัทของคนที่ล็อกอิน (ไม่รับจากหน้าเว็บ)
 * ตั้ง daily_worker.org_id ด้วย — เบิกล่วงหน้าของคนงานลงบัญชีคนงานใน transaction เดียวกัน (สำเร็จ/ล้มพร้อมกัน)
 * role นี้ไม่มีสิทธิ์ DELETE เลย · จ่ายแล้ว/ลงเงินสดย่อยแล้วแก้ได้แค่ช่องยกเลิก
 */

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function withRequestsTenant<T>(orgId: string, run: (tx: Tx) => Promise<T>): Promise<T> {
  return withRequestsTenantAfter(orgId, async () => undefined, (tx) => run(tx));
}

/**
 * `pre` ทำก่อนสลับ role — ใช้จองเลขที่เอกสาร (core.document_counters ที่ role ธรรมดาเขียนไม่ได้)
 * ใน transaction เดียวกัน: สร้างใบไม่สำเร็จ เลขก็ไม่ถูกกินไปเปล่า ๆ
 */
export async function withRequestsTenantAfter<P, T>(orgId: string, pre: (tx: Tx) => Promise<P>, run: (tx: Tx, pre: P) => Promise<T>): Promise<T> {
  if (!orgId) throw new Error("ไม่มีบริษัท");
  return prisma.$transaction(async (tx) => {
    const before = await pre(tx);
    await tx.$executeRawUnsafe("SET LOCAL ROLE workforce_app");
    await tx.$executeRaw`SELECT set_config('requests.org_id', ${orgId}, true)`;
    await tx.$executeRaw`SELECT set_config('daily_worker.org_id', ${orgId}, true)`;
    return run(tx, before);
  });
}

export const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);
const num = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : Number(d.toString()));
const num0 = (d: { toString(): string } | null | undefined) => num(d) ?? 0;

export interface PaymentView {
  id: string;
  amount: number;
  method: PaymentMethod;
  paidOn: string;
  pettyHolderId: string | null;
  payrollPeriod: string | null;
  slips: Attachment[];
  note: string;
  byUserId: string;
  byName: string;
  at: string;
  voided: { byName: string; at: string; reason: string } | null;
}

export interface EventView {
  id: string;
  at: string;
  byName: string;
  action: string;
  summary: string;
}

export interface RequestView {
  id: string;
  code: string;
  kind: RequestKind;
  status: RequestStatus;
  title: string;
  detail: string;
  beneficiaryUserId: string | null;
  beneficiaryName: string;
  beneficiaryKind: BeneficiaryKind;
  employmentId: string | null;
  vendorId: string | null;
  propertyId: string | null;
  propertyName: string | null;
  workOrderId: string | null;
  workOrderCode: string | null;
  workDate: string;
  otStart: string | null;
  otEnd: string | null;
  otMinutes: number | null;
  otPercent: number | null;
  otRateLabel: string | null;
  otBase: number | null;
  otBaseKind: string | null;
  amount: number;
  vatPercent: number;
  vatAmount: number;
  whtPercent: number;
  whtAmount: number;
  netAmount: number;
  lines: { item: string; amount: number }[];
  attachments: Attachment[];
  createdBy: string;
  createdByName: string;
  createdAt: string;
  approverLevel: ApproverLevel;
  needCeo: boolean;
  firstDecidedBy: string | null;
  firstDecidedByName: string | null;
  firstDecidedAt: string | null;
  firstDecisionNote: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  cancelledByName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  receivedAt: string | null;
  deductAmount: number;
  deductedAt: string | null;
  deductedByName: string | null;
  deductedPeriod: string | null;
  clearDueDate: string | null;
  clearStatus: string | null;
  clearSpent: number | null;
  clearReturned: number | null;
  clearNote: string | null;
  clearedAt: string | null;
  clearedByName: string | null;
  dwOtEntryId: string | null;
  dwPaymentId: string | null;
  maintenanceExpenseId: string | null;
  /** ผลรวมการจ่ายที่ยังไม่ถูกยกเลิก */
  paidTotal: number;
  payments: PaymentView[];
}

type RequestRow = Awaited<ReturnType<Tx["moneyRequest"]["findFirstOrThrow"]>>;
type PaymentRow = Awaited<ReturnType<Tx["moneyRequestPayment"]["findFirstOrThrow"]>>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toPayment(p: PaymentRow): PaymentView {
  return {
    id: p.id,
    amount: num0(p.amount),
    method: p.method as PaymentMethod,
    paidOn: ymd(p.paidOn),
    pettyHolderId: p.pettyHolderId,
    payrollPeriod: p.payrollPeriod,
    slips: (p.slips as unknown as Attachment[]) ?? [],
    note: p.note,
    byUserId: p.byUserId,
    byName: p.byName,
    at: p.createdAt.toISOString(),
    voided: p.voidedAt ? { byName: p.voidedByName ?? "", at: p.voidedAt.toISOString(), reason: p.voidReason ?? "" } : null,
  };
}

export function toRequest(r: RequestRow, payments: PaymentRow[]): RequestView {
  const pays = payments.map(toPayment);
  const paidTotal = Math.round(pays.filter((p) => !p.voided).reduce((s, p) => s + p.amount, 0) * 100) / 100;
  return {
    id: r.id,
    code: r.code,
    kind: r.kind as RequestKind,
    status: r.status as RequestStatus,
    title: r.title,
    detail: r.detail,
    beneficiaryUserId: r.beneficiaryUserId,
    beneficiaryName: r.beneficiaryName,
    beneficiaryKind: r.beneficiaryKind as BeneficiaryKind,
    employmentId: r.employmentId,
    vendorId: r.vendorId,
    propertyId: r.propertyId,
    propertyName: r.propertyName,
    workOrderId: r.workOrderId,
    workOrderCode: r.workOrderCode,
    workDate: ymd(r.workDate),
    otStart: r.otStart,
    otEnd: r.otEnd,
    otMinutes: r.otMinutes,
    otPercent: num(r.otPercent),
    otRateLabel: r.otRateLabel,
    otBase: num(r.otBase),
    otBaseKind: r.otBaseKind,
    amount: num0(r.amount),
    vatPercent: num0(r.vatPercent),
    vatAmount: num0(r.vatAmount),
    whtPercent: num0(r.whtPercent),
    whtAmount: num0(r.whtAmount),
    netAmount: num0(r.netAmount),
    lines: (r.lines as { item: string; amount: number }[] | null) ?? [],
    attachments: (r.attachments as unknown as Attachment[]) ?? [],
    createdBy: r.createdBy,
    createdByName: r.createdByName,
    createdAt: r.createdAt.toISOString(),
    approverLevel: r.approverLevel as ApproverLevel,
    needCeo: r.needCeo,
    firstDecidedBy: r.firstDecidedBy,
    firstDecidedByName: r.firstDecidedByName,
    firstDecidedAt: iso(r.firstDecidedAt),
    firstDecisionNote: r.firstDecisionNote,
    decidedBy: r.decidedBy,
    decidedByName: r.decidedByName,
    decidedAt: iso(r.decidedAt),
    decisionNote: r.decisionNote,
    cancelledByName: r.cancelledByName,
    cancelledAt: iso(r.cancelledAt),
    cancelReason: r.cancelReason,
    receivedAt: iso(r.receivedAt),
    deductAmount: num0(r.deductAmount),
    deductedAt: iso(r.deductedAt),
    deductedByName: r.deductedByName,
    deductedPeriod: r.deductedPeriod,
    clearDueDate: r.clearDueDate ? ymd(r.clearDueDate) : null,
    clearStatus: r.clearStatus,
    clearSpent: num(r.clearSpent),
    clearReturned: num(r.clearReturned),
    clearNote: r.clearNote,
    clearedAt: iso(r.clearedAt),
    clearedByName: r.clearedByName,
    dwOtEntryId: r.dwOtEntryId,
    dwPaymentId: r.dwPaymentId,
    maintenanceExpenseId: r.maintenanceExpenseId,
    paidTotal,
    payments: pays,
  };
}

/** ใบหลายใบพร้อมการจ่ายของแต่ละใบ (query ละสองครั้ง ไม่ใช่ทีละใบ) */
export async function loadRequests(tx: Tx, orgId: string, where: Record<string, unknown>, take = 500): Promise<RequestView[]> {
  const rows = await tx.moneyRequest.findMany({ where: { ...where, orgId }, orderBy: { createdAt: "desc" }, take });
  if (rows.length === 0) return [];
  const pays = await tx.moneyRequestPayment.findMany({ where: { orgId, requestId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: "asc" } });
  const byReq = new Map<string, PaymentRow[]>();
  for (const p of pays) byReq.set(p.requestId, [...(byReq.get(p.requestId) ?? []), p]);
  return rows.map((r) => toRequest(r, byReq.get(r.id) ?? []));
}

export async function insertEvent(
  tx: Tx,
  orgId: string,
  e: { requestId?: string | null; byUserId: string; byName: string; action: string; summary: string; detail?: unknown },
) {
  await tx.moneyRequestEvent.create({
    data: {
      orgId,
      requestId: e.requestId ?? null,
      byUserId: e.byUserId,
      byName: e.byName,
      action: e.action,
      summary: e.summary.slice(0, 500),
      ...(e.detail === undefined ? {} : { detail: e.detail as object }),
    },
  });
}

export async function readSettings(tx: Tx, orgId: string): Promise<RequestSettings> {
  const s = await tx.moneyRequestSettings.findUnique({ where: { orgId } });
  if (!s) return DEFAULT_SETTINGS;
  const rates = (s.otRates as unknown as OtRate[] | null) ?? [];
  const wht = (s.whtRates as unknown as number[] | null) ?? [];
  const saved = (s.approvalRoutes as Partial<Record<RequestKind, ApprovalRoute>> | null) ?? {};
  return {
    approvalRoutes: { ...DEFAULT_SETTINGS.approvalRoutes, ...saved },
    otRates: rates.length > 0 ? rates : DEFAULT_SETTINGS.otRates,
    advanceCapMode: (s.advanceCapMode as AdvanceCapMode) ?? "baht",
    advanceCapValue: num0(s.advanceCapValue),
    whtRates: wht.length > 0 ? wht : DEFAULT_SETTINGS.whtRates,
    vatPercent: num0(s.vatPercent),
    receiptMaxAgeDays: s.receiptMaxAgeDays,
    clearDueDays: s.clearDueDays,
  };
}

export interface VendorView {
  id: string;
  name: string;
  kind: string;
  taxId: string;
  phone: string;
  address: string;
  bankName: string;
  bankAccount: string;
  accountName: string;
  whtPercent: number;
  vatRegistered: boolean;
  note: string;
  active: boolean;
}

export function toVendor(v: Awaited<ReturnType<Tx["moneyVendor"]["findFirstOrThrow"]>>): VendorView {
  return {
    id: v.id,
    name: v.name,
    kind: v.kind,
    taxId: v.taxId,
    phone: v.phone,
    address: v.address,
    bankName: v.bankName,
    bankAccount: v.bankAccount,
    accountName: v.accountName,
    whtPercent: num0(v.whtPercent),
    vatRegistered: v.vatRegistered,
    note: v.note,
    active: v.active,
  };
}

export interface PettyEntryView {
  id: string;
  holderUserId: string;
  holderName: string;
  kind: "top_up" | "spend" | "return" | "adjust";
  delta: number;
  requestId: string | null;
  note: string;
  attachments: Attachment[];
  byName: string;
  at: string;
  voided: { byName: string; at: string; reason: string } | null;
}

export function toPetty(e: Awaited<ReturnType<Tx["moneyPettyCashEntry"]["findFirstOrThrow"]>>): PettyEntryView {
  return {
    id: e.id,
    holderUserId: e.holderUserId,
    holderName: e.holderName,
    kind: e.kind as PettyEntryView["kind"],
    delta: num0(e.delta),
    requestId: e.requestId,
    note: e.note,
    attachments: (e.attachments as unknown as Attachment[]) ?? [],
    byName: e.byName,
    at: e.createdAt.toISOString(),
    voided: e.voidedAt ? { byName: e.voidedByName ?? "", at: e.voidedAt.toISOString(), reason: e.voidReason ?? "" } : null,
  };
}

/** ยอดเงินสดย่อยคงเหลือของคนถือแต่ละคน */
export async function pettyBalances(tx: Tx, orgId: string): Promise<Map<string, number>> {
  const rows = await tx.moneyPettyCashEntry.groupBy({
    by: ["holderUserId"],
    where: { orgId, voidedAt: null },
    _sum: { delta: true },
  });
  return new Map(rows.map((r) => [r.holderUserId, num0(r._sum.delta)]));
}
