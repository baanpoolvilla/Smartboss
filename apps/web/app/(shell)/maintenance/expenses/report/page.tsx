import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Wallet } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { listExpensesForMonth } from "@/modules/maintenance/data/expenses";
import { listProperties } from "@/modules/maintenance/data/properties";
import {
  formatBaht,
  categoryLabel,
  THAI_MONTHS,
} from "@/modules/maintenance/lib/expense";
import { fmtThaiDate, fmtThaiDateTime } from "@/modules/maintenance/lib/format";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";

/** รายงานค่าใช้จ่ายรายเดือน — port จาก expense_report_screen.dart */
export default async function ExpenseReportPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.expenseView)) redirect("/");
  const orgId = session.orgId;

  const sp = await searchParams;
  const now = new Date();
  const year = Number(sp.year) || now.getFullYear();
  const month = Number(sp.month) || now.getMonth() + 1;

  const [expenses, properties] = await Promise.all([
    listExpensesForMonth(orgId, year, month),
    listProperties(orgId),
  ]);
  const propNames: Record<string, string> = Object.fromEntries(
    properties.map((p) => [p.id, p.name])
  );

  const byProp = new Map<string, typeof expenses>();
  let grand = 0;
  for (const e of expenses) {
    const pid = e.propertyId ?? "unknown";
    if (!byProp.has(pid)) byProp.set(pid, []);
    byProp.get(pid)!.push(e);
    grand += Number(e.amount);
  }

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };

  return (
    <AppScaffold
      title="รายงานค่าใช้จ่ายรายเดือน"
      width="max-w-4xl"
      backHref="/maintenance/expenses"
    >

      <div className="mb-3 flex items-center justify-center gap-4">
        <Link href={`/maintenance/expenses/report?year=${prev.y}&month=${prev.m}`}>
          <Button variant="ghost" size="icon">
            <ChevronLeft className="h-5 w-5" />
          </Button>
        </Link>
        <span className="min-w-[160px] text-center text-base font-semibold text-(--ink)">
          {THAI_MONTHS[month]} {year}
        </span>
        <Link href={`/maintenance/expenses/report?year=${next.y}&month=${next.m}`}>
          <Button variant="ghost" size="icon">
            <ChevronRight className="h-5 w-5" />
          </Button>
        </Link>
      </div>

      <Card
        className="mb-4 flex items-center gap-3 p-5"
        style={{ backgroundColor: "#ECFDF7", borderColor: "#0D948833" }}
      >
        <Wallet className="h-8 w-8" style={{ color: "#0D9488" }} />
        <div className="flex-1">
          <p className="text-xs text-(--ink-soft)">รวมทั้งเดือน</p>
          <p className="text-2xl font-bold" style={{ color: "#0F766E" }}>
            {formatBaht(grand)}
          </p>
        </div>
        <div className="text-right text-xs text-(--ink-soft)">
          <p>{byProp.size} บ้าน</p>
          <p>{expenses.length} รายการ</p>
        </div>
      </Card>

      {byProp.size === 0 ? (
        <Card className="p-10 text-center text-sm text-(--ink-soft)">
          ไม่มีค่าใช้จ่ายในเดือนนี้
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {Array.from(byProp.entries()).map(([pid, items]) => {
            const total = items.reduce((s, e) => s + Number(e.amount), 0);
            const name =
              pid === "unknown" ? "ไม่ระบุบ้าน" : (propNames[pid] ?? "ไม่ทราบชื่อ");
            const catTotals = new Map<string, number>();
            for (const e of items) {
              if (e.isNoExpense) continue;
              const k = e.category ?? "other";
              catTotals.set(k, (catTotals.get(k) ?? 0) + Number(e.amount));
            }
            return (
              <Card key={pid} className="overflow-hidden">
                <details>
                  <summary className="flex cursor-pointer items-center gap-3 p-4">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#ECFDF7] text-sm">
                      🏠
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-(--ink)">
                        {name}
                      </p>
                      <p className="text-xs text-(--ink-soft)">
                        {items.length} รายการ • {formatBaht(total)}
                      </p>
                    </div>
                  </summary>
                  <div className="border-t border-(--line)">
                    {catTotals.size > 0 && (
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
                    )}
                    {items.map((e) => (
                      <div
                        key={e.id}
                        className="flex items-center gap-2 border-b border-(--line) px-4 py-2.5 last:border-b-0"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-(--ink)">
                            {e.isNoExpense
                              ? "ไม่มีค่าใช้จ่าย"
                              : (e.description ?? categoryLabel(e.category))}
                          </p>
                          <p className="truncate text-xs text-(--ink-soft)">
                            {fmtThaiDate(e.expenseDate)} • บันทึกเมื่อ{" "}
                            {fmtThaiDateTime(e.createdAt)}
                          </p>
                        </div>
                        <p
                          className="text-sm font-bold"
                          style={{ color: e.isNoExpense ? "#16A34A" : "var(--ink)" }}
                        >
                          {e.isNoExpense
                            ? "ไม่มีค่าใช้จ่าย"
                            : formatBaht(Number(e.amount))}
                        </p>
                      </div>
                    ))}
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
