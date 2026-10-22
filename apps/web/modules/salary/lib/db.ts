import "server-only";
import { prisma } from "@smartboss/database";

import {
  DEFAULT_SETTINGS,
  DEFAULT_SSO,
  DEFAULT_TAX,
  type ApprovalMode,
  type LateMode,
  type RateRow,
  type SettingsView,
  type SsoParams,
  type TaxParams,
} from "./types";

/**
 * ที่เก็บของโมดูลเงินเดือน — schema salary (migration 20261022150000_salary_module)
 *
 * แยกข้อมูลรายบริษัท ("อย่าลืมนะ แยกข้อมูลแต่ละบริษัทออกจากกันนะ" 22/10/2569): ทุกตารางเปิด RLS แบบ FORCE
 * อ่าน/เขียนได้เฉพาะใน withSalaryTenant() ที่
 *   1) SET LOCAL ROLE workforce_app — role ธรรมดา (NOBYPASSRLS) ให้ policy มีผลจริง
 *   2) set_config('salary.org_id', orgId) — บริษัทของคนที่ล็อกอิน (มาจาก session ไม่รับจากหน้าเว็บ)
 * ลืมตั้ง = current_org_id() เป็น NULL = ไม่เห็นแถวไหนเลย (fail closed) · role นี้ลบได้แค่ผลรายคนของรอบที่ยังเป็นร่าง
 * ตั้ง requests.org_id ด้วย — ตอนบันทึกจ่าย ปิดใบ OT/เบิกล่วงหน้าในรอบใน transaction เดียวกัน (สำเร็จ/ล้มพร้อมกัน)
 */

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function withSalaryTenant<T>(orgId: string, run: (tx: Tx) => Promise<T>): Promise<T> {
  if (!orgId) throw new Error("ไม่มีบริษัท");
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE workforce_app");
      await tx.$executeRaw`SELECT set_config('salary.org_id', ${orgId}, true)`;
      await tx.$executeRaw`SELECT set_config('requests.org_id', ${orgId}, true)`;
      return run(tx);
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

export const num = (d: { toString(): string } | null | undefined): number => (d === null || d === undefined ? 0 : Number(d.toString()));
export const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);

export async function readSettings(tx: Tx, orgId: string): Promise<SettingsView> {
  const row = await tx.salarySettings.findUnique({ where: { orgId } });
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    cutoffDay: row.cutoffDay,
    payDay: row.payDay,
    approvalMode: row.approvalMode as ApprovalMode,
    changeThreshold: num(row.changeThreshold),
    deductLate: row.deductLate,
    lateMode: row.lateMode as LateMode,
    latePerTime: num(row.latePerTime),
    deductAbsent: row.deductAbsent,
    deductUnpaidLeave: row.deductUnpaidLeave,
    otSsoBase: row.otSsoBase,
    editorUserIds: row.editorUserIds,
    superAdminAccess: row.superAdminAccess,
    companyTaxId: row.companyTaxId,
    ssoEmployerNo: row.ssoEmployerNo,
    ssoBranch: row.ssoBranch,
    payBankName: row.payBankName,
    payBankAccount: row.payBankAccount,
    updatedByName: row.updatedByName,
  };
}

export interface Rates {
  sso: RateRow<SsoParams>[];
  tax: RateRow<TaxParams>[];
}

/** อัตราทั้งหมดของบริษัท (มีวันเริ่มมีผล) — ยังไม่เคยบันทึก = ใช้ค่าตั้งต้นของปี 2569 */
export async function readRates(tx: Tx, orgId: string): Promise<Rates> {
  const rows = await tx.salaryRate.findMany({ where: { orgId }, orderBy: { effectiveFrom: "asc" } });
  const sso = rows.filter((r) => r.kind === "sso").map((r) => ({ effectiveFrom: ymd(r.effectiveFrom), params: { ...DEFAULT_SSO, ...(r.params as object) } as SsoParams }));
  const tax = rows.filter((r) => r.kind === "tax").map((r) => ({ effectiveFrom: ymd(r.effectiveFrom), params: { ...DEFAULT_TAX, ...(r.params as object) } as TaxParams }));
  return { sso, tax };
}

export async function insertEvent(
  tx: Tx,
  orgId: string,
  e: { runId?: string | null; byUserId: string; byName: string; action: string; summary: string; detail?: unknown },
) {
  await tx.salaryEvent.create({
    data: { orgId, runId: e.runId ?? null, byUserId: e.byUserId, byName: e.byName, action: e.action, summary: e.summary.slice(0, 1000), ...(e.detail !== undefined ? { detail: e.detail as object } : {}) },
  });
}
