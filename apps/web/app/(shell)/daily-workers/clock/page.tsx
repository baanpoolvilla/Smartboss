import { redirect } from "next/navigation";
import { requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { APP_CLOCK_ENABLED } from "@/modules/hr/lib/app-clock";
import { Today } from "@/app/m/today";
import { WorkerLangProvider } from "@/app/m/worker-lang";
import { tr } from "@/modules/daily_worker/i18n";
import { workerLangFor } from "@/modules/daily_worker/lang-server";

/**
 * "ลงเวลา" ของคนงาน — หน้าเดียวกับ HR → ลงเวลา (/hr/clock) ทุกอย่าง แค่ย้ายที่ให้คนงาน
 * คนงานเห็นแค่ไอคอน "คนงานรายวัน" → ลงเวลา (ระบบบุคคลซ่อนจากคนงาน — hideForRoles ใน modules/hr/manifest.ts)
 */
export default async function DailyWorkerClockPage() {
  if (!APP_CLOCK_ENABLED) redirect("/");
  const session = await requireOrg();
  const lang = await workerLangFor(session.roles);
  return (
    <HrPage
      title={tr(lang, "menuClock")}
      permission={HR_PERMS.access}
      width="max-w-none"
      load={async () => {
        const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } });
        return (
          <WorkerLangProvider lang={lang}>
            <Today userName={me?.name ?? ""} showFriendHint={false} showMyMonth={false} />
          </WorkerLangProvider>
        );
      }}
    />
  );
}
