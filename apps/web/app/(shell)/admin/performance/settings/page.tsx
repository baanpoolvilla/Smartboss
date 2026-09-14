import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { PerformanceSettingsForm } from "@/modules/admin/components/performance-settings-form";
import { loadPerformanceSettings } from "@/lib/performance";

/**
 * ตั้งเกณฑ์คะแนนผลงานของบริษัท (หลังบ้าน)
 *
 * ฟอร์มตัวเดียวกับ /hr/settings/scoring — ดู PerformanceSettingsForm
 * บริษัทที่ยังไม่เคยตั้ง จะเห็นค่าเริ่มต้นกรอกไว้ให้ กดบันทึกครั้งแรกจึงเกิดแถวจริง
 */
export const dynamic = "force-dynamic";

export default async function PerformanceSettingsPage() {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.performanceSettingManage)) {
    redirect("/admin/performance");
  }

  const settings = await loadPerformanceSettings(session.orgId);

  return (
    <AppScaffold title="เกณฑ์คะแนนผลงาน" width="max-w-3xl" backHref="/admin/performance">
      <PerformanceSettingsForm settings={settings} />
    </AppScaffold>
  );
}
