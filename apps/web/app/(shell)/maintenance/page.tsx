import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ShoppingCart,
  CalendarDays,
  CalendarClock,
  ReceiptText,
  FileText,
  Loader,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import {
  dashboardStats,
  noExpenseWorkOrderCount,
  recentWorkOrders,
} from "@/modules/maintenance/data/dashboard";
import { listExpensesForMonth } from "@/modules/maintenance/data/expenses";
import {
  listProperties,
  propertyCategoryMap,
} from "@/modules/maintenance/data/properties";
import {
  ExpenseDonut,
  type DonutCategory,
} from "@/modules/maintenance/components/expense-donut";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";

const STATUS_META: Record<
  string,
  { color: string; Icon: typeof FileText }
> = {
  open: { color: "#2563EB", Icon: FileText },
  in_progress: { color: "#EA580C", Icon: Loader },
  completed: { color: "#16A34A", Icon: CheckCircle2 },
  cancelled: { color: "#6B7280", Icon: XCircle },
};

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "#DC2626",
  high: "#EA580C",
  medium: "#2563EB",
  low: "#6B7280",
};

function SummaryCard({
  title,
  value,
  color,
  href,
  Icon,
}: {
  title: string;
  value: number;
  color: string;
  href: string;
  Icon: typeof FileText;
}) {
  return (
    <Link href={href}>
      <Card className="p-4 transition-colors hover:bg-(--bg-soft)">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-(--radius)"
          style={{ backgroundColor: `${color}1a` }}
        >
          <Icon className="h-5 w-5" style={{ color }} />
        </span>
        <p className="mt-2 text-2xl font-bold" style={{ color }}>
          {value}
        </p>
        <p className="mt-0.5 text-xs text-(--ink-soft)">{title}</p>
      </Card>
    </Link>
  );
}

function SectionHeader({ title, href }: { title: string; href: string }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between">
      <h2 className="text-base font-bold text-(--ink)">{title}</h2>
      <Link href={href} className="text-sm text-[#0F766E] hover:underline">
        ดูทั้งหมด
      </Link>
    </div>
  );
}

/** แดชบอร์ด — port จาก dashboard_screen.dart */
export default async function MaintenanceDashboardPage() {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.access)) redirect("/");
  const orgId = session.orgId;

  const now = new Date();
  const [stats, noExpense, recent, properties, propCats, monthExpenses] =
    await Promise.all([
      dashboardStats(orgId),
      noExpenseWorkOrderCount(orgId),
      recentWorkOrders(orgId, 5),
      listProperties(orgId),
      propertyCategoryMap(orgId),
      listExpensesForMonth(orgId, now.getFullYear(), now.getMonth() + 1),
    ]);

  const propNames: Record<string, string> = Object.fromEntries(
    properties.map((p) => [p.id, p.name])
  );

  // ยอดต่อบ้านของเดือนนี้ (ข้ามรายการ "ไม่มีค่าใช้จ่าย")
  const byProperty = new Map<string, number>();
  for (const e of monthExpenses) {
    if (e.isNoExpense) continue;
    const pid = e.propertyId ?? "unknown";
    byProperty.set(pid, (byProperty.get(pid) ?? 0) + Number(e.amount));
  }

  // จัดกลุ่มตามหมวดที่ถูกจัดไว้ที่หน้า "บ้าน" — ไม่เดาจากชื่อบ้านอีกต่อไป
  const catMap = new Map<string, DonutCategory>();
  for (const [pid, value] of byProperty) {
    const name = propNames[pid] ?? pid;
    const label =
      pid === "unknown" ? "ไม่ระบุบ้าน" : (propCats[pid] ?? "ยังไม่จัดหมวด");
    const c = catMap.get(label) ?? {
      key: label,
      label,
      items: [],
    };
    c.items.push({
      key: pid,
      label: pid === "unknown" ? "ไม่ระบุบ้าน" : name,
      value,
    });
    catMap.set(label, c);
  }
  const categories = Array.from(catMap.values()).sort(
    (a, b) =>
      b.items.reduce((s, i) => s + i.value, 0) -
      a.items.reduce((s, i) => s + i.value, 0)
  );

  return (
    <AppScaffold title="แดชบอร์ด">
      {/* ─── การ์ดสรุป 4 ช่อง ─── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          title="PR รอ CEO อนุมัติ"
          value={stats.pendingPr}
          color="#EA580C"
          href="/maintenance/purchase-orders"
          Icon={ShoppingCart}
        />
        <SummaryCard
          title="งานใหม่วันนี้"
          value={stats.todayCount}
          color="#0D9488"
          href="/maintenance/work-orders?filter=today"
          Icon={CalendarDays}
        />
        <SummaryCard
          title="PM ใกล้ครบกำหนด"
          value={stats.pmDueSoon}
          color="#E65100"
          href="/maintenance/pm"
          Icon={CalendarClock}
        />
        <SummaryCard
          title="ยังไม่บันทึกค่าใช้จ่าย"
          value={noExpense}
          color="#DC2626"
          href="/maintenance/work-orders?filter=no-expense"
          Icon={ReceiptText}
        />
      </div>

      {/* ─── ค่าใช้จ่ายเดือนนี้ ─── */}
      <SectionHeader title="ค่าใช้จ่ายเดือนนี้" href="/maintenance/expenses" />
      <Card className="p-4">
        {categories.length === 0 ? (
          <p className="py-6 text-center text-sm text-(--ink-soft)">
            ยังไม่มีค่าใช้จ่ายในเดือนนี้
          </p>
        ) : (
          <ExpenseDonut categories={categories} />
        )}
      </Card>

      {/* ─── งานล่าสุด ─── */}
      <SectionHeader title="งานล่าสุด" href="/maintenance/work-orders" />
      {recent.length === 0 ? (
        <Card className="p-6 text-center text-sm text-(--ink-soft)">
          ยังไม่มีใบงาน
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {recent.map((wo) => {
            const meta = STATUS_META[wo.status] ?? STATUS_META.open!;
            const isNew = wo.status === "open";
            return (
              <Link key={wo.id} href={`/maintenance/work-orders/${wo.id}`}>
                <Card
                  className="flex items-center gap-3 p-3 hover:bg-(--bg-soft)"
                  style={isNew ? { backgroundColor: "#FEF2F2" } : undefined}
                >
                  <meta.Icon
                    className="h-5 w-5 shrink-0"
                    style={{ color: meta.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm"
                      style={
                        isNew
                          ? { color: "#991B1B", fontWeight: 700 }
                          : { color: "var(--ink)" }
                      }
                    >
                      {wo.title}
                    </p>
                    <p className="truncate text-xs text-(--ink-soft)">
                      {propNames[wo.propertyId] ?? ""}
                    </p>
                  </div>
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{
                      backgroundColor: isNew
                        ? "#DC2626"
                        : (PRIORITY_COLOR[wo.priority] ?? "#6B7280"),
                    }}
                  />
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </AppScaffold>
  );
}
