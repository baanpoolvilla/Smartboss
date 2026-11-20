import { AppScaffold } from "@/components/module/app-scaffold";
import { MySlipList } from "@/modules/salary/components/my-slips";
import { SalaryTabs } from "@/modules/salary/components/tabs";
import { salaryPage } from "@/modules/salary/lib/page";
import { MySavingsBox } from "@/modules/salary/components/my-slips";

export const dynamic = "force-dynamic";

/** สลิปของฉัน — ทุกคน (คนที่จัดการเงินเดือนเห็นเป็นแท็บหนึ่ง) */
export default async function MySlipsPage() {
  const { session, access } = await salaryPage();
  return (
    <AppScaffold title="สลิปเงินเดือน" width="max-w-none">
      <div className="flex flex-col gap-4">
        {access.canEdit && <SalaryTabs active="my" />}
        <MySavingsBox orgId={session.orgId} userId={session.userId} />
        <MySlipList orgId={session.orgId} userId={session.userId} />
      </div>
    </AppScaffold>
  );
}
