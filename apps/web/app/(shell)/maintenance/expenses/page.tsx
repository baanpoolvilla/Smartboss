import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Wallet, Download } from "lucide-react";
import { requireOrg, hasPermission, isSuperAdmin } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { listExpensesForMonth } from "@/modules/maintenance/data/expenses";
import { listProperties } from "@/modules/maintenance/data/properties";
import { listWorkOrders } from "@/modules/maintenance/data/work-orders";
import { listActivePmSchedules } from "@/modules/maintenance/data/pm";
import { listPurchaseOrders } from "@/modules/maintenance/data/purchase-orders";
import { listCategories } from "@/modules/maintenance/data/categories";
import { userNameMap } from "@/modules/maintenance/data/users";
import {
  formatBaht,
  paidByLabel,
  costTypeLabel,
  categoryLabel,
  THAI_MONTHS,
} from "@/modules/maintenance/lib/expense";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";
import { deleteExpenseAction } from "./actions";
import { AppScaffold, Fab } from "@/modules/maintenance/components/app-scaffold";

function amt(v: unknown): number {
  return Number(v);
}

export default async function ExpensesReportPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; cat?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.expenseView)) redirect("/");
  const orgId = session.orgId;
  const canManage = hasPermission(session, MAINT_PERMS.expenseManage);
  const canDelete = isSuperAdmin(session);

  const sp = await searchParams;
  const now = new Date();
  const year = Number(sp.year) || now.getFullYear();
  const month = Number(sp.month) || now.getMonth() + 1;
  const cat = sp.cat || null;

  const [expenses, properties, workOrders, pms, purchaseOrders, categories] =
    await Promise.all([
      listExpensesForMonth(orgId, year, month),
      listProperties(orgId),
      listWorkOrders(orgId),
      listActivePmSchedules(orgId),
      listPurchaseOrders(orgId),
      listCategories(orgId),
    ]);

  const propNames: Record<string, string> = Object.fromEntries(
    properties.map((p) => [p.id, p.name])
  );
  const woTitles: Record<string, string> = Object.fromEntries(
    workOrders.map((w) => [w.id, w.title])
  );
  const pmTitles: Record<string, string> = Object.fromEntries(
    pms.map((p) => [p.id, p.title])
  );
  const poTitles: Record<string, string> = Object.fromEntries(
    purchaseOrders.map((p) => [p.id, p.title])
  );
  const creatorNames = await userNameMap(
    orgId,
    expenses.map((e) => e.createdBy)
  );

  /*
   * กรองตามหมวดที่ถูกจัดไว้ที่หน้า "บ้าน" — เดิมเทียบด้วย name.startsWith(prefix)
   * ซึ่งพังทันทีที่บ้านถูกย้ายข้ามหมวดโดยไม่เปลี่ยนชื่อ
   */
  const propCat: Record<string, string | null> = Object.fromEntries(
    properties.map((p) => [p.id, p.categoryId])
  );
  const filtered = cat
    ? expenses.filter((e) =>
        e.propertyId ? propCat[e.propertyId] === cat : false
      )
    : expenses;

  // group by property
  const byProp = new Map<string, typeof filtered>();
  let grandTotal = 0;
  for (const e of filtered) {
    const pid = e.propertyId ?? "unknown";
    if (!byProp.has(pid)) byProp.set(pid, []);
    byProp.get(pid)!.push(e);
    grandTotal += amt(e.amount);
  }
  const totalCount = filtered.length;

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const catQ = cat ? `&cat=${encodeURIComponent(cat)}` : "";

  /** ชื่ออ้างอิง (ใบงาน → คำสั่งซื้อ → PM) — ตรงกับ _getExpenseReferenceTitle เดิม */
  const referenceTitle = (e: (typeof filtered)[number]): string | null => {
    if (e.workOrderId && woTitles[e.workOrderId]) return woTitles[e.workOrderId]!;
    if (e.purchaseOrderId && poTitles[e.purchaseOrderId])
      return poTitles[e.purchaseOrderId]!;
    if (e.pmScheduleId && pmTitles[e.pmScheduleId]) return pmTitles[e.pmScheduleId]!;
    return null;
  };

  const displayTitle = (e: (typeof filtered)[number]): string => {
    const ref = referenceTitle(e);
    if (ref) return ref;
    const desc = e.description?.trim();
    if (desc) return desc;
    return e.isNoExpense ? "ไม่มีค่าใช้จ่าย" : categoryLabel(e.category);
  };

  const displayDetail = (e: (typeof filtered)[number]): string => {
    if (e.isNoExpense) return "ไม่มีค่าใช้จ่าย";
    const desc = e.description?.trim();
    if (desc && desc !== referenceTitle(e)) return desc;
    return categoryLabel(e.category);
  };

  /** ลิงก์ไปต้นทาง (ใบงาน / คำสั่งซื้อ) เหมือน onTap ของเดิม */
  const linkFor = (e: (typeof filtered)[number]): string | null => {
    if (e.workOrderId) return `/maintenance/work-orders/${e.workOrderId}`;
    if (e.purchaseOrderId)
      return `/maintenance/purchase-orders/${e.purchaseOrderId}`;
    return null;
  };

  return (
    <AppScaffold
      title="ค่าใช้จ่าย"
      actions={
        <a
          href={`/maintenance/expenses/export?year=${year}&month=${month}${catQ}`}
          title="Export รายงาน"
          aria-label="Export รายงาน"
          className="rounded-full p-2 text-(--app-strong) transition-colors hover:bg-(--bg-soft)"
        >
          <Download className="h-5 w-5" />
        </a>
      }
      fab={
        canManage ? (
          <Fab href="/maintenance/expenses/new" label="เพิ่มค่าใช้จ่าย" />
        ) : null
      }
    >
      {/* Month selector */}
      <div className="mb-3 flex items-center justify-center gap-4">
        <Link href={`/maintenance/expenses?year=${prev.y}&month=${prev.m}${catQ}`}>
          <Button variant="ghost" size="icon">
            <ChevronLeft className="h-5 w-5" />
          </Button>
        </Link>
        <span className="min-w-[160px] text-center text-base font-semibold text-(--ink)">
          {THAI_MONTHS[month]} {year}
        </span>
        <Link href={`/maintenance/expenses?year=${next.y}&month=${next.m}${catQ}`}>
          <Button variant="ghost" size="icon">
            <ChevronRight className="h-5 w-5" />
          </Button>
        </Link>
      </div>

      {/* Category filter */}
      {categories.length > 0 && (
        <div className="mb-3 flex flex-wrap justify-center gap-2">
          <Link href={`/maintenance/expenses?year=${year}&month=${month}`}>
            <span
              className="rounded-full border px-3 py-1 text-xs"
              style={!cat ? { color: "#0D9488", borderColor: "#0D9488", backgroundColor: "#ECFDF7" } : { color: "var(--ink-soft)", borderColor: "var(--line)" }}
            >
              ทั้งหมด
            </span>
          </Link>
          {categories.map((c) => (
            <Link key={c.id} href={`/maintenance/expenses?year=${year}&month=${month}&cat=${encodeURIComponent(c.id)}`}>
              <span
                className="rounded-full border px-3 py-1 text-xs"
                style={cat === c.id ? { color: "#0D9488", borderColor: "#0D9488", backgroundColor: "#ECFDF7" } : { color: "var(--ink-soft)", borderColor: "var(--line)" }}
              >
                {c.displayName}
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* Grand total */}
      <Card className="mb-4 flex items-center gap-3 p-5" style={{ backgroundColor: "#ECFDF7", borderColor: "#0D948833" }}>
        <Wallet className="h-8 w-8" style={{ color: "#0D9488" }} />
        <div className="flex-1">
          <p className="text-xs text-(--ink-soft)">รวมทั้งเดือน</p>
          <p className="text-2xl font-bold" style={{ color: "#0F766E" }}>
            {formatBaht(grandTotal)}
          </p>
        </div>
        <div className="text-right text-xs text-(--ink-soft)">
          <p>{byProp.size} บ้าน</p>
          <p>{totalCount} รายการ</p>
        </div>
      </Card>

      {byProp.size === 0 ? (
        <Card className="p-10 text-center text-sm text-(--ink-soft)">
          ไม่มีค่าใช้จ่ายในเดือนนี้
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {Array.from(byProp.entries()).map(([pid, items]) => {
            const total = items.reduce((s, e) => s + amt(e.amount), 0);
            const propName = pid === "unknown" ? "ไม่ระบุบ้าน" : propNames[pid] ?? "ไม่ทราบชื่อ";
            return (
              <Card key={pid} className="overflow-hidden">
                <details>
                  <summary className="flex cursor-pointer items-center gap-3 p-4">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#ECFDF7] text-sm">🏠</span>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-(--ink)">{propName}</p>
                      <p className="text-xs text-(--ink-soft)">
                        {items.length} รายการ • {formatBaht(total)}
                      </p>
                    </div>
                  </summary>
                  <div className="border-t border-(--line)">
                    {/* สรุปตามหมวด (ข้าม "ไม่มีค่าใช้จ่าย") */}
                    {(() => {
                      const catTotals = new Map<string, number>();
                      for (const e of items) {
                        if (e.isNoExpense) continue;
                        const k = e.category ?? "other";
                        catTotals.set(k, (catTotals.get(k) ?? 0) + amt(e.amount));
                      }
                      if (catTotals.size === 0) return null;
                      return (
                        <div className="border-b border-(--line) px-4 py-2">
                          {Array.from(catTotals.entries()).map(([k, v]) => (
                            <div
                              key={k}
                              className="flex items-center justify-between py-0.5 text-xs text-(--ink-soft)"
                            >
                              <span>{categoryLabel(k)}</span>
                              <span className="font-semibold text-(--ink)">
                                {formatBaht(v)}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    {items.map((e) => {
                      const href = linkFor(e);
                      const sourceLabel = e.purchaseOrderId
                        ? "คำสั่งซื้อ"
                        : costTypeLabel(e.costType);
                      const subtitle = `${displayDetail(e)} • ${fmtThaiDate(e.expenseDate)} • ${sourceLabel} • ${paidByLabel(e.paidBy)}${
                        e.createdBy && creatorNames[e.createdBy]
                          ? ` • บันทึกโดย ${creatorNames[e.createdBy]}`
                          : ""
                      }`;
                      return (
                      <div key={e.id} className="flex items-center gap-2 border-b border-(--line) px-4 py-2.5 last:border-b-0">
                        <div className="min-w-0 flex-1">
                          {href ? (
                            <Link href={href} className="block min-w-0">
                              <p className="truncate text-sm text-(--ink) hover:underline">
                                {displayTitle(e)}
                              </p>
                            </Link>
                          ) : (
                            <p className="truncate text-sm text-(--ink)">
                              {displayTitle(e)}
                            </p>
                          )}
                          <p className="truncate text-xs text-(--ink-soft)">
                            {subtitle}
                          </p>
                        </div>
                        <div className="text-right">
                          <p
                            className="text-sm font-bold"
                            style={{ color: e.isNoExpense ? "#16A34A" : "var(--ink)" }}
                          >
                            {e.isNoExpense ? "ไม่มีค่าใช้จ่าย" : formatBaht(amt(e.amount))}
                          </p>
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px]"
                            style={
                              e.paidBy === "company"
                                ? { color: "#2563EB", backgroundColor: "#2563EB1a" }
                                : { color: "#EA580C", backgroundColor: "#EA580C1a" }
                            }
                          >
                            {paidByLabel(e.paidBy)}
                          </span>
                        </div>
                        {canDelete && (
                          <form action={deleteExpenseAction}>
                            <input type="hidden" name="id" value={e.id} />
                            <Button type="submit" variant="ghost" size="sm" className="text-[#DC2626]">
                              ลบ
                            </Button>
                          </form>
                        )}
                      </div>
                      );
                    })}
                  </div>
                </details>
              </Card>
            );
          })}
        </div>
      )}
    </AppScaffold>
  );
}
