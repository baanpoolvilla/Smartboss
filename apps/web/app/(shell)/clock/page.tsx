import { redirect } from "next/navigation";
import { hasPermission, requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { APP_CLOCK_ENABLED } from "@/modules/hr/lib/app-clock";
import { HR_PERMS } from "@/modules/hr/permissions";
import { Today } from "@/app/m/today";

/**
 * "ลงเวลา" ในแอป — หน้าจอ "วันนี้" ตัวเดียวกับใน LINE Mini App (app/m/today.tsx)
 * ปุ่มใหญ่ปุ่มเดียว เข้า/ออกสลับเอง + แผนที่ดูว่าอยู่ในเขตไหม
 *
 * อยู่นอกระบบบุคคลโดยตั้งใจ (เดิม /hr/clock): หน้านี้ได้แถบล่างของหน้าแรก (ปุ่มลงเวลาตรงกลาง)
 * ไม่ใช่เมนูของระบบบุคคล — "แยกออกมา เวลากลับจะได้กดง่ายๆ"
 *
 * ใช้โค้ดชุดเดียวกับ LINE โดยตั้งใจ — สถานที่ทำงาน / นโยบายลงเวลามาจากระบบบุคคลชุดเดียวกัน
 * (/hr/sites, /hr/checkin-policy) ไม่ต้องตั้งซ้ำ
 *
 * เข้าจากปุ่มกลางของแถบล่าง (มือถือ) หรือไอคอน "ลงเวลา" บนหน้าแรก (คอม) — สองแตะ
 * (ปุ่ม → ปุ่มใหญ่) โดยตั้งใจ กันแตะพลาดแล้วกลายเป็นลงเวลาไปแล้ว
 */
export default async function ClockPage() {
  if (!APP_CLOCK_ENABLED) redirect("/");
  const session = await requireOrg();
  if (!hasPermission(session, HR_PERMS.access)) redirect("/");
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } });
  return (
    <div className="mx-auto w-full max-w-lg">
      <Today userName={me?.name ?? ""} showFriendHint={false} />
    </div>
  );
}
