import { redirect } from "next/navigation";
import { requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { APP_CLOCK_ENABLED } from "@/modules/hr/lib/app-clock";
import { Today } from "@/app/m/today";

/**
 * "ลงเวลา" ของคนงาน — หน้าเดียวกับ HR → ลงเวลา (/hr/clock) ทุกอย่าง แค่ย้ายที่ให้คนงาน
 * คนงานเห็นแค่ไอคอน "คนงานรายวัน" → ลงเวลา (ระบบบุคคลซ่อนจากคนงาน — hideForRoles ใน modules/hr/manifest.ts)
 */
export default async function DailyWorkerClockPage() {
  if (!APP_CLOCK_ENABLED) redirect("/");
  const session = await requireOrg();
  return (
    <HrPage
      title="ลงเวลา"
      permission={HR_PERMS.access}
      width="max-w-lg"
      load={async () => {
        const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } });
        return <Today userName={me?.name ?? ""} showFriendHint={false} />;
      }}
    />
  );
}
