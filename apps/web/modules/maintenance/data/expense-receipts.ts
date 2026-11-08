import "server-only";
import { prisma } from "@smartboss/database";
import { listExpensesForMonth } from "@/modules/maintenance/data/expenses";
import { listProperties } from "@/modules/maintenance/data/properties";
import { groupExpenseBatches } from "@/modules/maintenance/lib/expense-batches";

/**
 * ข้อมูลหน้า "ใบเสร็จ" ของแจ้งซ่อม รายเดือน — ใช้แถวเดียวกับรายงานค่าใช้จ่าย (listExpensesForMonth) ยอดรายบ้านจึงตรงกัน
 * รายบ้าน: ทุกแถวยอดเต็มตามกติกาเดิม · รายการ/ยอดจ่ายจริง: ใบหลายบ้านนับครั้งเดียว (lib/expense-batches.ts)
 */
export async function loadMonthReceipts(orgId: string, year: number, month: number, propertyId: string | null) {
  const [all, properties] = await Promise.all([listExpensesForMonth(orgId, year, month), listProperties(orgId)]);
  const houseName = new Map(properties.map((p) => [p.id, p.name]));
  const rows = all.filter((e) => !e.isNoExpense && (!propertyId || e.propertyId === propertyId));
  const woIds = [...new Set(rows.map((e) => e.workOrderId).filter((x): x is string => !!x))];
  const wos = woIds.length ? await prisma.workOrder.findMany({ where: { orgId, id: { in: woIds } }, select: { id: true, code: true, title: true } }) : [];
  const woById = new Map(wos.map((w) => [w.id, w]));

  const byHouse = new Map<string, { name: string; total: number; count: number }>();
  for (const e of rows) {
    const id = e.propertyId ?? "";
    const cur = byHouse.get(id) ?? { name: e.propertyId ? (houseName.get(e.propertyId) ?? "-") : "ไม่ระบุบ้าน", total: 0, count: 0 };
    byHouse.set(id, { ...cur, total: cur.total + Number(e.amount), count: cur.count + 1 });
  }

  const items = groupExpenseBatches(rows)
    .map(({ first: e, amount, houses, rows: batch }) => ({
      id: e.id,
      date: e.expenseDate,
      amount,
      houses,
      houseNames: batch.map((r) => (r.propertyId ? (houseName.get(r.propertyId) ?? "-") : "-")),
      description: e.description,
      payee: e.payee,
      payer: e.payer,
      paidAt: e.paidAt,
      receiptNo: e.receiptNo,
      paymentMethod: e.paymentMethod,
      noReceipt: e.noReceipt,
      receiptUrl: e.receiptUrl,
      fromRequest: !!e.receiptUrl?.includes("/requests/"),
      workOrder: e.workOrderId ? (woById.get(e.workOrderId) ?? null) : null,
      purchaseOrderId: e.purchaseOrderId,
      // ค่าของ / ค่าแรง-ค่าบริการ + ภาษี (ผู้ใช้ 8/11/2569) — ใบหลายบ้านรวมทุกแถวของชุด
      costKind: e.costKind,
      payeeKind: e.payeeKind,
      whtPercent: e.whtPercent === null ? null : Number(e.whtPercent),
      vat: batch.reduce((n, r) => n + Number(r.vatAmount ?? 0), 0),
      wht: batch.reduce((n, r) => n + Number(r.whtAmount ?? 0), 0),
    }))
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  return {
    items,
    byHouse: [...byHouse.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.total - a.total),
    houses: properties.map((p) => ({ id: p.id, name: p.name })),
    realTotal: items.reduce((n, i) => n + i.amount, 0),
    houseTotal: rows.reduce((n, e) => n + Number(e.amount), 0),
    withReceipt: items.filter((i) => !!i.receiptUrl).length,
    tax: {
      vat: items.reduce((n, i) => n + i.vat, 0),
      wht3: items.filter((i) => i.payeeKind !== "company").reduce((n, i) => n + i.wht, 0),
      wht53: items.filter((i) => i.payeeKind === "company").reduce((n, i) => n + i.wht, 0),
    },
    without: items.filter((i) => !i.receiptUrl).length,
  };
}
