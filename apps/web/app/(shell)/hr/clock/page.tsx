import { redirect } from "next/navigation";
import { requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { APP_CLOCK_ENABLED } from "@/modules/hr/lib/app-clock";
import { Today } from "@/app/m/today";

/**
 * "ลงเวลา" — เมนูแรกของระบบบุคคล (หน้าที่เปิดมาเจอเมื่อกดเข้า HR) · หน้าจอ "วันนี้" ตัวเดียวกับ LINE Mini App
 * (app/m/today.tsx): มือถือ = แผนที่ + ปุ่มใหญ่ปุ่มเดียว เข้า/ออกสลับเอง · คอม = QR ไปลงเวลาบนมือถือ (คอมไม่มี GPS)
 *
 * เดิมอยู่นอกระบบบุคคล (/clock + ปุ่มกลางแถบล่างของหน้าแรก) — ย้ายมาไว้ใน HR ที่เดียว
 * ("เอาออกจากหน้าหลัก ให้ไปอยู่ใน HR เป็นหัวข้อนึง ... เมนูลงเวลาแยกมาเป็นอีกเมนู")
 */
export default async function HrClockPage() {
  if (!APP_CLOCK_ENABLED) redirect("/hr");
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
