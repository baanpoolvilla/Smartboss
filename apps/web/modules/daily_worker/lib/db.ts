import "server-only";
import { prisma } from "@smartboss/database";

import type { DwSettings, PayRateEntry, PaymentEntry, TimeEditEntry } from "./types";
import { DEFAULT_OT_PERCENT } from "./types";

/**
 * ที่เก็บเงินของคนงานรายวัน — schema daily_worker (migration 20261019150000_daily_worker_money)
 *
 * ทุกตารางเปิด RLS แบบ FORCE ผูกกับบริษัท: อ่าน/เขียนได้เฉพาะใน withDailyWorkerTenant() ที่
 *   1) SET LOCAL ROLE workforce_app — role ธรรมดา (ไม่ใช่ superuser/BYPASSRLS) ให้ policy มีผลจริง
 *   2) set_config('daily_worker.org_id', orgId) — บริษัทของคนที่ล็อกอิน (ไม่รับจากหน้าเว็บ)
 * เรียกนอกนี้ = ไม่เห็นข้อมูลเลย (fail closed) · role นี้ไม่มีสิทธิ์ DELETE และแก้แถวจ่ายเงินได้แค่ช่องยกเลิก
 * Smartboss ขายหลายบริษัท — ข้อมูลเงินของบริษัทหนึ่งต้องไม่หลุดไปอีกบริษัท (ผู้ใช้ 19/10/2569)
 */

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function withDailyWorkerTenant<T>(orgId: string, run: (tx: Tx) => Promise<T>): Promise<T> {
  if (!orgId) throw new Error("ไม่มีบริษัท");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE workforce_app");
    await tx.$executeRaw`SELECT set_config('daily_worker.org_id', ${orgId}, true)`;
    return run(tx);
  });
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : Number(d.toString()));

export async function readPaymentsDb(orgId: string): Promise<PaymentEntry[]> {
  const rows = await withDailyWorkerTenant(orgId, (tx) =>
    tx.dailyWorkerPayment.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } }),
  );
  return rows.map((r) => ({
    id: r.id,
    employmentId: r.employmentId,
    date: ymd(r.payDate),
    amount: num(r.amount)!,
    kind: r.kind === "advance" ? "advance" : "wage",
    note: r.note,
    byUserId: r.byUserId,
    byName: r.byName,
    at: r.createdAt.toISOString(),
    snapshot: (r.snapshot as Record<string, number> | null) ?? undefined,
    voided: r.voidedAt ? { byName: r.voidedByName ?? "", at: r.voidedAt.toISOString(), reason: r.voidReason ?? "" } : undefined,
  }));
}

export async function readPayRatesDb(orgId: string): Promise<PayRateEntry[]> {
  const rows = await withDailyWorkerTenant(orgId, (tx) => tx.dailyWorkerPayRate.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } }));
  return rows.map((r) => ({
    employmentId: r.employmentId,
    dailyWage: num(r.dailyWage)!,
    otPercent: num(r.otPercent),
    from: ymd(r.effectiveFrom),
    byUserId: r.byUserId,
    byName: r.byName,
    at: r.createdAt.toISOString(),
  }));
}

/** การแก้เวลาที่ยังมีผล — แถวล่าสุดที่ยังไม่ถูกยกเลิกของแต่ละ (คน, วัน) */
export async function readTimeEditsDb(orgId: string): Promise<TimeEditEntry[]> {
  const rows = await withDailyWorkerTenant(orgId, (tx) =>
    tx.dailyWorkerTimeEdit.findMany({ where: { orgId, revokedAt: null }, orderBy: { createdAt: "desc" } }),
  );
  const seen = new Set<string>();
  const out: TimeEditEntry[] = [];
  for (const r of rows) {
    const date = ymd(r.workDate);
    const key = `${r.employmentId}:${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ employmentId: r.employmentId, date, inAt: r.inAt, outAt: r.outAt, reason: r.reason, byUserId: r.byUserId, byName: r.byName, at: r.createdAt.toISOString() });
  }
  return out;
}

export async function readSettingsDb(orgId: string): Promise<DwSettings> {
  const row = await withDailyWorkerTenant(orgId, (tx) => tx.dailyWorkerSettings.findUnique({ where: { orgId } }));
  const p = num(row?.otPercent);
  return { otPercent: p && p > 0 ? p : DEFAULT_OT_PERCENT };
}

/* ───────────── ประวัติการแก้ไข (audit_events — เพิ่มได้อย่างเดียว) ───────────── */

export interface AuditInput {
  byUserId: string;
  byName: string;
  action: string;
  employmentIds?: string[];
  workDate?: string | null;
  summary: string;
  detail?: unknown;
}

export interface AuditEvent extends AuditInput {
  id: string;
  at: string;
  employmentIds: string[];
  workDate: string | null;
}

/** บันทึกใน transaction เดียวกับการแก้ (เรื่องเงิน: แก้สำเร็จ = มี log เสมอ) */
export async function insertAudit(tx: Tx, orgId: string, e: AuditInput) {
  await tx.dailyWorkerAuditEvent.create({
    data: {
      orgId,
      byUserId: e.byUserId,
      byName: e.byName,
      action: e.action,
      employmentIds: e.employmentIds ?? [],
      workDate: e.workDate ? new Date(`${e.workDate}T00:00:00Z`) : null,
      summary: e.summary.slice(0, 500),
      detail: (e.detail ?? undefined) as never,
    },
  });
}

/** บันทึกแยก (การแก้ที่เก็บที่อื่น เช่น วันหยุดในระบบบุคคล/OT) — บันทึกไม่ได้ไม่ทำให้งานหลักพัง */
export async function logDw(orgId: string, e: AuditInput) {
  try {
    await withDailyWorkerTenant(orgId, (tx) => insertAudit(tx, orgId, e));
  } catch (error) {
    console.error("[daily-worker] audit log failed", error);
  }
}

export async function readAudit(orgId: string, opts: { from: Date; to: Date; employmentId?: string; limit?: number }): Promise<AuditEvent[]> {
  const rows = await withDailyWorkerTenant(orgId, (tx) =>
    tx.dailyWorkerAuditEvent.findMany({
      where: { orgId, at: { gte: opts.from, lt: opts.to }, ...(opts.employmentId ? { employmentIds: { has: opts.employmentId } } : {}) },
      orderBy: { at: "desc" },
      take: opts.limit ?? 500,
    }),
  );
  return rows.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    byUserId: r.byUserId,
    byName: r.byName,
    action: r.action,
    employmentIds: r.employmentIds,
    workDate: r.workDate ? ymd(r.workDate) : null,
    summary: r.summary,
    detail: r.detail,
  }));
}
