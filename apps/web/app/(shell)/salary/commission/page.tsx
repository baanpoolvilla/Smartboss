import { AppScaffold } from "@/components/module/app-scaffold";
import { SalaryTabs } from "@/modules/salary/components/tabs";
import { salaryPage } from "@/modules/salary/lib/page";
import { resolveScorePeriodParam } from "@/lib/score-period";
import { loadScorePeriodConfig } from "@/lib/score-period-config";
import { renderCommissionTab } from "../../hr/employees/commission-tab";

export const dynamic = "force-dynamic";

/**
 * เงินเดือน › ค่าคอม — หน้าจอเดียวกับ ระบบบุคคล › พนักงาน › ค่าคอม (ข้อมูลชุดเดียวกัน)
 * ผู้ใช้ 30/10/2569: รวมเรื่องคิดเงินไว้ที่เงินเดือนที่เดียว HR จะได้ไม่งง · สิทธิ์เท่าเดิม (คนทำเงินเดือน)
 */
export default async function SalaryCommissionPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { session, access } = await salaryPage({ edit: true });
  const sp = await searchParams;
  const month = resolveScorePeriodParam(await loadScorePeriodConfig(session.orgId), sp.month);
  return (
    <AppScaffold title="เงินเดือน" width="max-w-none">
      <div className="flex flex-col gap-4">
        <SalaryTabs active="commission" />
        {await renderCommissionTab(session, month, access.canEdit, "/salary/commission")}
      </div>
    </AppScaffold>
  );
}
