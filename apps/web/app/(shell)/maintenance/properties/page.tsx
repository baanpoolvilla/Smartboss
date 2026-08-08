import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Package,
  Home as HomeIcon,
  Building2,
  CalendarClock,
  ChevronRight,
} from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { Input } from "@smartboss/ui/components/input";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { upsertCategoryAction } from "./actions";
import {
  listProperties,
  categoryPrefix,
  workOrderStatusCounts,
} from "@/modules/maintenance/data/properties";
import { getCategoryNames } from "@/modules/maintenance/data/categories";
import { userNameMap } from "@/modules/maintenance/data/users";
import {
  AppScaffold,
  AppBarLink,
  Fab,
} from "@/modules/maintenance/components/app-scaffold";

/** ชื่อหมวดสำรองเมื่อยังไม่เคยตั้งชื่อเอง — ตรงกับ _getCategoryDisplayName เดิม */
const CATEGORY_FALLBACK: Record<string, string> = {
  "BS-A": "BS-A (บ้านเดี่ยว A)",
  "BS-HS": "BS-HS (โฮมสเตย์)",
  "BS-M": "BS-M (บ้านเดี่ยว M)",
  "BS-T": "BS-T (ทาวน์เฮาส์)",
  "PT-BT": "PT-BT (พูลวิลล่า)",
};

function StatusDot({
  propertyId,
  counts,
}: {
  propertyId: string;
  counts?: { open: number; in_progress: number };
}) {
  const open = counts?.open ?? 0;
  const inProgress = counts?.in_progress ?? 0;
  let color = "#16A34A"; // green
  let label = "ไม่มีใบงานค้าง";
  let n = 0;
  if (inProgress > 0) {
    color = "#D97706"; // amber
    label = `กำลังดำเนินการ ${inProgress} ใบงาน`;
    n = inProgress;
  } else if (open > 0) {
    color = "#DC2626"; // red
    label = `รอดำเนินการ ${open} ใบงาน`;
    n = open;
  }
  const dot = (
    <span
      title={label}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-bold"
      style={{ color, borderColor: `${color}80`, backgroundColor: `${color}1f` }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {n > 0 ? n : ""}
    </span>
  );
  // มีใบงานค้าง = กดแล้วไปหน้าใบงานของบ้านนั้น (เหมือนของเดิม)
  return n > 0 ? (
    <Link href={`/maintenance/work-orders?propertyId=${propertyId}`}>{dot}</Link>
  ) : (
    dot
  );
}

export default async function PropertiesListPage() {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.propertyView)) redirect("/");
  const canManage = hasPermission(session, MAINT_PERMS.propertyManage);
  const orgId = session.orgId;

  const [properties, categoryNames] = await Promise.all([
    listProperties(orgId),
    getCategoryNames(orgId),
  ]);
  const counts = await workOrderStatusCounts(
    orgId,
    properties.map((p) => p.id)
  );
  const caretakerNames = await userNameMap(
    orgId,
    properties.map((p) => p.caretakerId)
  );

  // group by category prefix
  const groups = new Map<string, typeof properties>();
  for (const p of properties) {
    const key = categoryPrefix(p.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const sortedKeys = Array.from(groups.keys()).sort();

  const displayName = (prefix: string) =>
    categoryNames[prefix.toUpperCase()] ||
    CATEGORY_FALLBACK[prefix.toUpperCase()] ||
    prefix;

  return (
    <AppScaffold
      title="รายชื่อบ้าน"
      actions={
        <AppBarLink href="/maintenance/assets" label="อุปกรณ์ทั้งหมด">
          <Package className="h-5 w-5" />
        </AppBarLink>
      }
      fab={canManage ? <Fab href="/maintenance/properties/new" /> : null}
    >
      {properties.length === 0 ? (
        <Card className="p-10 text-center text-sm text-(--ink-soft)">
          ยังไม่มีข้อมูลบ้าน {canManage ? "— เพิ่มบ้านแรกได้เลย" : ""}
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {sortedKeys.map((key) => (
            <section key={key}>
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5"
                  style={{ backgroundColor: "#CCFBF1" }}
                >
                  <Building2 className="h-4 w-4" style={{ color: "#0F766E" }} />
                  <span className="text-sm font-bold" style={{ color: "#0F766E" }}>
                    {displayName(key)} ({groups.get(key)!.length})
                  </span>
                </span>
                {canManage && (
                  <CategoryEditor prefix={key} current={displayName(key)} />
                )}
                <span className="h-px flex-1 bg-(--line)" />
              </div>
              <div className="flex flex-col gap-2">
                {groups.get(key)!.map((p) => (
                  <Card
                    key={p.id}
                    className="flex items-center gap-3 p-3 transition-colors hover:bg-(--bg-soft)"
                  >
                    <Link
                      href={`/maintenance/properties/${p.id}`}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ECFDF7]">
                        <HomeIcon className="h-4 w-4" style={{ color: "#0D9488" }} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-(--ink)">
                          {p.name}
                        </span>
                        <span className="block truncate text-xs text-(--ink-soft)">
                          {p.caretakerId
                            ? `ผู้จัดการ: ${caretakerNames[p.caretakerId] ?? "-"}`
                            : "ไม่มีผู้จัดการ"}
                        </span>
                      </span>
                    </Link>

                    {/* ทางลัดไป PM ของบ้านนี้ */}
                    <Link
                      href={`/maintenance/pm?propertyId=${p.id}`}
                      title="PM ของบ้านนี้"
                      className="inline-flex items-center rounded-full border px-2 py-1"
                      style={{ borderColor: "#2563EB66", backgroundColor: "#2563EB1a" }}
                    >
                      <CalendarClock className="h-3.5 w-3.5" style={{ color: "#2563EB" }} />
                    </Link>

                    <StatusDot propertyId={p.id} counts={counts[p.id]} />
                    <ChevronRight className="h-4 w-4 text-(--ink-soft)" />
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </AppScaffold>
  );
}

function CategoryEditor({ prefix, current }: { prefix: string; current: string }) {
  return (
    <details className="group relative">
      <summary className="cursor-pointer list-none text-xs text-(--brand-green) hover:underline">
        แก้ชื่อหมวด
      </summary>
      <form
        action={upsertCategoryAction}
        className="absolute z-10 mt-1 flex gap-2 rounded-(--radius) border border-(--line) bg-(--bg) p-2 shadow-(--shadow-card)"
      >
        <input type="hidden" name="prefix" value={prefix} />
        <Input
          name="displayName"
          defaultValue={current}
          className="h-9 w-48"
          placeholder="ชื่อหมวด"
        />
        <Button type="submit" size="sm">
          บันทึก
        </Button>
      </form>
    </details>
  );
}
