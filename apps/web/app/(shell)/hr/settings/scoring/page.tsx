import { requireOrg } from "@smartboss/auth";
import { HrPage } from "@/modules/hr/components/hr-page";
import { SettingsSubnav } from "@/modules/hr/components/design-kit";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { PerformanceSettingsForm } from "@/modules/admin/components/performance-settings-form";
import { loadPerformanceSettings } from "@/lib/performance";

/**
 * เกณฑ์คะแนนผลงาน ในหน้าตั้งค่าของระบบบุคคล — เดิมเมนูนี้ลิงก์ออกไปหลังบ้าน
 * (/admin/performance/settings) ทำให้หลุดออกจากหน้าตั้งค่าที่กำลังใช้อยู่
 *
 * ฟอร์มและ action ตัวเดียวกับหลังบ้าน (ข้อมูลชุดเดียว core.performance_settings)
 * สิทธิ์เท่าเดิมทุกประการ: ตั้งเกณฑ์คะแนนผลงานของบริษัท ไม่ใช่ hr.setting.manage
 */
export const dynamic = "force-dynamic";

export default async function HrScoringSettingsPage() {
  const session = await requireOrg();

  return (
    <HrPage
      title="เกณฑ์คะแนน"
      permission={ADMIN_PERMS.performanceSettingManage}
      load={async () => {
        const settings = await loadPerformanceSettings(session.orgId);
        return (
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <SettingsSubnav active="/hr/settings/scoring" />
            <div className="min-w-0 max-w-3xl flex-1">
              <PerformanceSettingsForm settings={settings} />
            </div>
          </div>
        );
      }}
    />
  );
}
