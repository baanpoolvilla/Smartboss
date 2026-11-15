import { redirect } from "next/navigation";
import { requireOrg, isSuperAdmin } from "@smartboss/auth";
import { AppScaffold } from "@/components/module/app-scaffold";
import { AiSettingsPage } from "@/modules/report_task/components/ai-settings/ai-settings-page";

/** ตั้งค่า AI (15/11/2569) — Boss เท่านั้น (ผู้ดูแลระบบสูงสุดเห็นด้วย + ตั้งคีย์ OpenAI ของบริษัท) */
export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await requireOrg();
  if (!session.roles.includes("CEO") && !isSuperAdmin(session)) redirect("/");
  return (
    <AppScaffold title="ตั้งค่า AI" backHref="/chat-report/report-feed">
      <AiSettingsPage />
    </AppScaffold>
  );
}
