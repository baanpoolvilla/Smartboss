import { AppScaffold } from "@/components/module/app-scaffold";
import { SalaryGuide } from "@/modules/salary/components/guide";
import { SalaryTabs } from "@/modules/salary/components/tabs";
import { readSettings, withSalaryTenant } from "@/modules/salary/lib/db";
import { salaryPage } from "@/modules/salary/lib/page";

export const dynamic = "force-dynamic";

/** คู่มือเงินเดือน — สำหรับคนทำเงินเดือน (CEO + คนที่ CEO เลือก) · พนักงานมีคำอธิบายบนสลิปของตัวเองแทน */
export default async function SalaryGuidePage() {
  const { session } = await salaryPage({ edit: true });
  const settings = await withSalaryTenant(session.orgId, (tx) => readSettings(tx, session.orgId));
  return (
    <AppScaffold title="เงินเดือน" width="max-w-4xl">
      <div className="flex flex-col gap-4">
        <SalaryTabs active="guide" />
        <div>
          <h1 className="text-xl font-bold text-(--ink)">คู่มือเงินเดือน</h1>
          <p className="text-sm text-(--ink-soft)">อ่าน 5 นาทีแล้วทำเงินเดือนได้ทั้งเดือน · ในหน้ารอบเงินเดือนกดปุ่ม ⓘ ข้างคำที่ไม่เข้าใจได้ทุกที่</p>
        </div>
        <SalaryGuide cutoffDay={settings.cutoffDay} payDayText={settings.payDay === 0 ? "สิ้นเดือน" : `วันที่ ${settings.payDay}`} />
      </div>
    </AppScaffold>
  );
}
