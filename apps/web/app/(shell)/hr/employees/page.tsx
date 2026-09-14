import Link from "next/link";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Fab } from "@/components/module/app-scaffold";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { resolveMonthParam } from "@/lib/performance-month";
import { renderRegistryTab } from "./registry-tab";
import { renderScoreTab } from "./score-tab";
import { renderCommissionTab } from "./commission-tab";

const TAB_TITLE = { registry: "พนักงาน", score: "คะแนน & เกรด", commission: "ค่าคอม" } as const;
type TabId = keyof typeof TAB_TITLE;

/**
 * หน้าพนักงาน — รวม "พนักงาน" (ทะเบียน) กับ "ผลงานรายคน" (คะแนน/เกรด, เดิมอยู่
 * ที่ /hr/performance) เป็น tab เดียวกันตาม IA ใหม่ (ยุบเมนู 15 → 5)
 *
 * แท็บคะแนนใช้สิทธิ์ core.performance.view (ข้ามโมดูล ไม่ใช่ HR_PERMS) เหมือนเดิม
 * ทุกประการ — HrPage เช็คได้แค่สิทธิ์เดียวระดับหน้า จึงต้องเช็คสิทธิ์ของแท็บนี้
 * เองก่อนตัดสินว่าจะโชว์แท็บให้เลือกไหม (ไม่ใช่แค่ตอนกดเข้าไป)
 *
 * แท็บค่าคอมเป็นตัวเลขเงินรายคน จึงใช้สิทธิ์ฐานเงินเดือน (ดู = salary.view, แก้ = salary.manage)
 */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    status?: string;
    imported?: string;
    range?: string;
    month?: string;
  }>;
}) {
  const session = await requireOrg();
  const canManage = hasPermission(session, HR_PERMS.employeeManage);
  const canSeeScore = hasPermission(session, ADMIN_PERMS.performanceView);
  const canManageCommission = hasPermission(session, HR_PERMS.salaryManage);
  const canSeeCommission = canManageCommission || hasPermission(session, HR_PERMS.salaryView);

  const sp = await searchParams;
  const allowed: Record<TabId, boolean> = {
    registry: true,
    score: canSeeScore,
    commission: canSeeCommission,
  };
  const requested: TabId = sp.tab === "score" || sp.tab === "commission" ? sp.tab : "registry";
  const tab: TabId = allowed[requested] ? requested : "registry";
  const visibleTabs = (Object.keys(TAB_TITLE) as TabId[]).filter((t) => allowed[t]);

  return (
    <HrPage
      title={TAB_TITLE[tab]}
      permission={HR_PERMS.employeeView}
      fab={tab === "registry" && canManage ? <Fab href="/hr/employees/new" label="เพิ่มพนักงาน" /> : null}
      actions={
        tab === "registry" && canManage ? (
          <Link
            href="/hr/employees/import"
            className="text-sm text-(--app-strong) hover:underline"
          >
            นำเข้าจากผู้ใช้
          </Link>
        ) : null
      }
      load={async () => {
        const tabBar =
          visibleTabs.length > 1 ? (
            <div className="mb-4 flex gap-1 overflow-x-auto border-b border-(--line)">
              {visibleTabs.map((t) => (
                <Link
                  key={t}
                  href={t === "registry" ? "/hr/employees" : `/hr/employees?tab=${t}`}
                  className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
                    tab === t
                      ? "border-(--app-strong,var(--ink)) text-(--ink)"
                      : "border-transparent text-(--ink-soft) hover:text-(--ink)"
                  }`}
                >
                  {t === "registry" ? "ทะเบียน" : TAB_TITLE[t]}
                </Link>
              ))}
            </div>
          ) : null;

        const body =
          tab === "score"
            ? await renderScoreTab(session, sp.range)
            : tab === "commission"
              ? await renderCommissionTab(session, resolveMonthParam(sp.month), canManageCommission)
              : await renderRegistryTab(session, canManage, sp.status, sp.imported);

        return (
          <>
            {tabBar}
            {body}
          </>
        );
      }}
    />
  );
}
