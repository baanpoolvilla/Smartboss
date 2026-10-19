import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";

import { AppScaffold } from "@/components/module/app-scaffold";
import { DW_PERMS } from "@/modules/daily_worker/permissions";
import { bangkokToday, loadMonth } from "@/modules/daily_worker/lib/data";
import { PaySettings } from "@/modules/daily_worker/components/pay-settings";
import { PayTabs } from "@/modules/daily_worker/components/pay-tabs";

export const dynamic = "force-dynamic";

/** ตั้งค่าแรงคนงาน — แยกจากหน้าตารางคนงาน (ผู้ใช้ 19/10/2569) · เฉพาะคนที่มีสิทธิ์ตั้งค่าแรง (HR/CEO) */
export default async function PaySettingsPage() {
  const session = await requireOrg();
  if (!hasPermission(session, DW_PERMS.pay)) redirect("/daily-workers/pay");
  const today = bangkokToday();
  const data = await loadMonth(session.orgId, today.slice(0, 7)).catch((error: unknown) => {
    console.error("[daily-workers/pay/settings] load failed", error);
    return null;
  });

  return (
    <AppScaffold title="จ่ายเงินคนงาน" width="max-w-5xl">
      <div className="flex flex-col gap-4">
        <PayTabs active="settings" month={today.slice(0, 7)} canSetPay />
        {!data ? (
          <div className="rounded-2xl border border-(--line) bg-(--bg) p-6 text-sm text-(--ink-soft)">อ่านข้อมูลไม่ได้ ลองรีเฟรชอีกครั้ง</div>
        ) : (
          <PaySettings
            rows={data.workers
              .filter((w) => w.employmentId)
              .map((w) => ({ employmentId: w.employmentId!, name: w.name, employeeCode: w.employeeCode, dailyWage: w.dailyWage, otPercent: w.otPercent }))}
            otPercent={data.otPercent}
            today={data.today}
          />
        )}
      </div>
    </AppScaffold>
  );
}
