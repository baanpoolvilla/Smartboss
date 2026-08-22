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
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import {
  createCategoryAction,
  renameCategoryAction,
  deleteCategoryAction,
  moveCategoryAction,
  setPropertyCategoryAction,
} from "./actions";
import {
  listProperties,
  workOrderStatusCounts,
} from "@/modules/maintenance/data/properties";
import { listCategoriesWithCount } from "@/modules/maintenance/data/categories";
import { CategoryManager } from "@/modules/maintenance/components/category-manager";
import { PropertyCategoryPicker } from "@/modules/maintenance/components/property-category-picker";
import { userNameMap } from "@/modules/maintenance/data/users";
import {
  AppScaffold,
  AppBarLink,
  Fab,
} from "@/modules/maintenance/components/app-scaffold";

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

  const [properties, categories] = await Promise.all([
    listProperties(orgId),
    listCategoriesWithCount(orgId),
  ]);
  const counts = await workOrderStatusCounts(
    orgId,
    properties.map((p) => p.id)
  );
  const caretakerNames = await userNameMap(
    orgId,
    properties.map((p) => p.caretakerId)
  );

  /*
   * จัดกลุ่มตามหมวดที่ "ถูกเลือกไว้" ไม่ใช่เดาจากชื่อบ้านเหมือนเดิม
   *
   * ไล่จาก categories ก่อนเสมอ ⇒ หมวดที่ยังไม่มีบ้านก็ยังโผล่บนหน้าจอ
   * (ของเดิมสร้างกลุ่มจากบ้านที่มีอยู่ ⇒ หมวดเปล่าไม่มีทางแสดง)
   * และลำดับหมวดตรงกับที่ตั้งไว้ในกล่องจัดการหมวด ไม่ใช่เรียงตามตัวอักษร
   */
  const byCategory = new Map<string, typeof properties>(
    categories.map((c) => [c.id, [] as typeof properties])
  );
  const uncategorised: typeof properties = [];
  for (const p of properties) {
    const list = p.categoryId ? byCategory.get(p.categoryId) : undefined;
    if (list) list.push(p);
    else uncategorised.push(p);
  }

  const pickerOptions = categories.map((c) => ({
    id: c.id,
    displayName: c.displayName,
  }));

  const sections: { key: string; title: string; rows: typeof properties }[] = [
    ...categories.map((c) => ({
      key: c.id,
      title: c.displayName,
      rows: byCategory.get(c.id)!,
    })),
    // กองท้ายสุดเสมอ และแสดงก็ต่อเมื่อมีบ้านตกค้างจริง
    ...(uncategorised.length > 0
      ? [{ key: "__none__", title: "ยังไม่จัดหมวด", rows: uncategorised }]
      : []),
  ];

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
      {canManage && (
        <div className="mb-4 flex items-center gap-2">
          <CategoryManager
            categories={categories.map((c) => ({
              id: c.id,
              displayName: c.displayName,
              propertyCount: c.propertyCount,
            }))}
            createAction={createCategoryAction}
            renameAction={renameCategoryAction}
            deleteAction={deleteCategoryAction}
            moveAction={moveCategoryAction}
          />
          <span className="text-xs text-(--ink-soft)">
            {categories.length} หมวด · {properties.length} หลัง
          </span>
        </div>
      )}

      {properties.length === 0 ? (
        <Card className="p-10 text-center text-sm text-(--ink-soft)">
          ยังไม่มีข้อมูลบ้าน {canManage ? "— เพิ่มบ้านแรกได้เลย" : ""}
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {sections.map((sec) => (
            <section key={sec.key}>
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5"
                  style={{
                    backgroundColor:
                      sec.key === "__none__" ? "var(--bg-soft)" : "#CCFBF1",
                  }}
                >
                  <Building2
                    className="h-4 w-4"
                    style={{
                      color: sec.key === "__none__" ? "var(--ink-soft)" : "#0F766E",
                    }}
                  />
                  <span
                    className="text-sm font-bold"
                    style={{
                      color: sec.key === "__none__" ? "var(--ink-soft)" : "#0F766E",
                    }}
                  >
                    {sec.title} ({sec.rows.length})
                  </span>
                </span>
                <span className="h-px flex-1 bg-(--line)" />
              </div>

              {sec.rows.length === 0 ? (
                <p className="px-1 text-xs text-(--ink-soft)">
                  ยังไม่มีบ้านในหมวดนี้
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {sec.rows.map((p) => (
                    <Card
                      key={p.id}
                      className="flex flex-wrap items-center gap-2 p-3 transition-colors hover:bg-(--bg-soft) sm:flex-nowrap sm:gap-3"
                    >
                      <Link
                        href={`/maintenance/properties/${p.id}`}
                        className="flex min-w-0 flex-1 items-center gap-3"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ECFDF7]">
                          <HomeIcon
                            className="h-4 w-4"
                            style={{ color: "#0D9488" }}
                          />
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

                      {canManage && (
                        <PropertyCategoryPicker
                          propertyId={p.id}
                          categoryId={p.categoryId}
                          categories={pickerOptions}
                          action={setPropertyCategoryAction}
                        />
                      )}

                      {/* ทางลัดไป PM ของบ้านนี้ */}
                      <Link
                        href={`/maintenance/pm?propertyId=${p.id}`}
                        title="PM ของบ้านนี้"
                        className="inline-flex shrink-0 items-center rounded-full border px-2 py-1"
                        style={{
                          borderColor: "#2563EB66",
                          backgroundColor: "#2563EB1a",
                        }}
                      >
                        <CalendarClock
                          className="h-3.5 w-3.5"
                          style={{ color: "#2563EB" }}
                        />
                      </Link>

                      <StatusDot propertyId={p.id} counts={counts[p.id]} />
                      <ChevronRight className="h-4 w-4 shrink-0 text-(--ink-soft)" />
                    </Card>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </AppScaffold>
  );
}
