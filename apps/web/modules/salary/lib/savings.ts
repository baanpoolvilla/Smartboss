import "server-only";

import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";

import { num, withSalaryTenant, ymd, type Tx } from "./db";

/**
 * สมุดเงินสะสมรายคน (เช่น กองทุนสงเคราะห์ลูกจ้าง) — ผู้ใช้ 20/11/2569
 * ยอดยกมา/จ่ายคืน อยู่ใน salary.savings_entries · ยอดรายเดือนอ่านจากรอบที่ "จ่ายแล้ว" (ไม่เก็บซ้ำ)
 *   - รายการหักงวดเดียว: adjustments ที่ติด savings (บริษัทสมทบอยู่ใน employer)
 *   - รายการประจำ/ผ่อน: บรรทัด recurring ที่ชื่อรายการเป็นเงินสะสม (บริษัทสมทบอยู่ที่ employee_items.employer_amount)
 */
export interface SavingsRow {
  key: string;
  kind: "opening" | "payroll" | "payout";
  label: string;
  /** YYYY-MM-DD (ยกมา/จ่ายคืน) หรือวันจ่ายของรอบ */
  date: string;
  employee: number;
  employer: number;
  note: string;
  by: string;
}

export interface SavingsBook {
  itemId: string;
  name: string;
  rows: SavingsRow[];
  employee: number;
  employer: number;
  total: number;
  /** ยอดยกมาปัจจุบัน (ไว้แก้) */
  opening: { employee: number; employer: number; note: string } | null;
  /** งวดล่าสุดที่มีการหัก (YYYY-MM) */
  lastPeriod: string | null;
}

type Adj = { id: string; label: string; kind: string; amount: number; savings?: boolean; employer?: number; itemId?: string | null };
type Ln = { key: string; kind: string; amount: number; source: string; refId?: string };

const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const periodText = (p: string) => `${TH_MONTH[Number(p.slice(5, 7)) - 1]} ${Number(p.slice(0, 4)) + 543}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function savingsBooksTx(tx: Tx, orgId: string, employmentIds: string[]): Promise<Map<string, SavingsBook[]>> {
  const out = new Map<string, SavingsBook[]>();
  if (employmentIds.length === 0) return out;
  const entries = await tx.salarySavingsEntry.findMany({ where: { orgId, employmentId: { in: employmentIds }, voidedAt: null }, orderBy: { createdAt: "asc" } });
  const items = await tx.salaryItem.findMany({ where: { orgId, OR: [{ savings: true }, { id: { in: [...new Set(entries.map((e) => e.itemId))] } }] } });
  const savingsIds = new Set(items.filter((i) => i.savings).map((i) => i.id));
  const nameOf = new Map(items.map((i) => [i.id, i.name]));
  if (items.length === 0) return out;

  const runs = await tx.salaryRun.findMany({ where: { orgId, status: "paid" }, select: { id: true, period: true, payDate: true, paidOn: true } });
  const runBy = new Map(runs.map((r) => [r.id, r]));
  const lines = runs.length
    ? await tx.salaryRunLine.findMany({ where: { orgId, runId: { in: runs.map((r) => r.id) }, employmentId: { in: employmentIds } }, select: { runId: true, employmentId: true, lines: true, adjustments: true } })
    : [];
  const recIds = new Set<string>();
  for (const l of lines) for (const x of (l.lines ?? []) as unknown as Ln[]) if (x.source === "recurring" && x.kind === "deduction" && x.refId) recIds.add(x.refId);
  const empItems = recIds.size ? await tx.salaryEmployeeItem.findMany({ where: { orgId, id: { in: [...recIds] } } }) : [];
  const empItemBy = new Map(empItems.map((e) => [e.id, e]));

  // employmentId → itemId → rows
  const acc = new Map<string, Map<string, SavingsRow[]>>();
  const push = (emp: string, itemId: string, row: SavingsRow) => {
    if (!acc.has(emp)) acc.set(emp, new Map());
    const m = acc.get(emp)!;
    if (!m.has(itemId)) m.set(itemId, []);
    m.get(itemId)!.push(row);
  };

  for (const l of lines) {
    const run = runBy.get(l.runId)!;
    const date = ymd(run.paidOn ?? run.payDate);
    const label = `${periodText(run.period)} · หักในรอบเงินเดือน`;
    for (const a of (l.adjustments ?? []) as unknown as Adj[]) {
      if (!a.savings || a.kind !== "deduction") continue;
      const itemId = a.itemId ?? items.find((i) => i.name === a.label)?.id ?? `label:${a.label}`;
      if (!nameOf.has(itemId)) nameOf.set(itemId, a.label);
      push(l.employmentId, itemId, { key: `adj:${l.runId}:${a.id}`, kind: "payroll", label, date, employee: Number(a.amount) || 0, employer: Number(a.employer) || 0, note: "", by: "" });
    }
    for (const x of (l.lines ?? []) as unknown as Ln[]) {
      if (x.source !== "recurring" || x.kind !== "deduction" || !x.refId) continue;
      const ei = empItemBy.get(x.refId);
      if (!ei || !savingsIds.has(ei.itemId)) continue;
      push(l.employmentId, ei.itemId, { key: `rec:${l.runId}:${x.refId}`, kind: "payroll", label, date, employee: Number(x.amount) || 0, employer: num(ei.employerAmount), note: "", by: "" });
    }
  }
  for (const e of entries) {
    push(e.employmentId, e.itemId, {
      key: e.id,
      kind: e.kind === "payout" ? "payout" : "opening",
      label: e.kind === "payout" ? "จ่ายคืนแล้ว" : "ยอดยกมา (ก่อนมีระบบ)",
      date: ymd(e.onDate),
      employee: num(e.employeeAmount),
      employer: num(e.employerAmount),
      note: e.note,
      by: e.createdByName,
    });
  }

  for (const [emp, byItem] of acc) {
    const books: SavingsBook[] = [];
    for (const [itemId, rows] of byItem) {
      const order = { opening: 0, payroll: 1, payout: 2 } as const;
      rows.sort((a, b) => (a.kind === "opening" ? -1 : b.kind === "opening" ? 1 : a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]));
      let employee = 0;
      let employer = 0;
      for (const r of rows) {
        const sign = r.kind === "payout" ? -1 : 1;
        employee += sign * r.employee;
        employer += sign * r.employer;
      }
      const op = rows.find((r) => r.kind === "opening");
      const lastPay = rows.filter((r) => r.kind === "payroll").at(-1);
      books.push({
        itemId,
        name: nameOf.get(itemId) ?? "เงินสะสม",
        rows,
        employee: r2(employee),
        employer: r2(employer),
        total: r2(employee + employer),
        opening: op ? { employee: op.employee, employer: op.employer, note: op.note } : null,
        lastPeriod: lastPay ? lastPay.date.slice(0, 7) : null,
      });
    }
    out.set(emp, books);
  }
  return out;
}

/** หน้าพนักงาน (HR): สมุดของคนนี้ + ชื่อรายการเงินสะสมทั้งหมด (ไว้กรอกยอดยกมาแม้ยังไม่มีการหัก) */
export async function savingsForEmployee(orgId: string, employmentId: string) {
  return withSalaryTenant(orgId, async (tx) => {
    const books = (await savingsBooksTx(tx, orgId, [employmentId])).get(employmentId) ?? [];
    const items = await tx.salaryItem.findMany({ where: { orgId, savings: true, kind: "deduction" }, orderBy: [{ sort: "asc" }, { name: "asc" }] });
    for (const i of items) {
      if (!books.some((b) => b.itemId === i.id)) books.push({ itemId: i.id, name: i.name, rows: [], employee: 0, employer: 0, total: 0, opening: null, lastPeriod: null });
    }
    return books;
  });
}

/** สลิปของฉัน: ยอดรวมของตัวเองเท่านั้น (ไม่แยกรายเดือน/ส่วนบริษัท — ผู้ใช้ 20/11/2569 "แค่ยอดเก็บพอ") */
export async function mySavings(orgId: string, userId: string): Promise<{ name: string; total: number; asOf: string | null }[]> {
  const fromLines = await withSalaryTenant(orgId, (tx) => tx.salaryRunLine.findMany({ where: { orgId, userId }, select: { employmentId: true }, distinct: ["employmentId"] }));
  const fromWf = await withWorkforceTenant(orgId, (wtx) =>
    wtx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT e.id::text AS id FROM workforce.employments e JOIN workforce.principals p ON p.person_id = e.person_id WHERE p.subject = $1`,
      userId,
    ),
  ).catch(() => [] as { id: string }[]);
  const ids = [...new Set([...fromLines.map((l) => l.employmentId), ...fromWf.map((r) => r.id)])];
  if (ids.length === 0) return [];
  const map = await withSalaryTenant(orgId, (tx) => savingsBooksTx(tx, orgId, ids));
  const out: { name: string; total: number; asOf: string | null }[] = [];
  for (const books of map.values()) for (const b of books) if (b.rows.length > 0) out.push({ name: b.name, total: b.total, asOf: b.lastPeriod });
  return out;
}
