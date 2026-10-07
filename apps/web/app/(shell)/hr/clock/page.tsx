import { requireOrg } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { Today } from "@/app/m/today";

/**
 * "ลงเวลา" ในแอป — หน้าจอ "วันนี้" ตัวเดียวกับใน LINE Mini App (app/m/today.tsx)
 * ปุ่มใหญ่ปุ่มเดียว เข้า/ออกสลับเอง + แผนที่ดูว่าอยู่ในเขตไหม + กล้องถ้าบริษัทบังคับ
 *
 * ใช้โค้ดชุดเดียวกับ LINE โดยตั้งใจ — แก้หน้าจอที่เดียวเปลี่ยนทั้งสองทาง และสถานที่ทำงาน /
 * นโยบายลงเวลามาจากระบบบุคคลชุดเดียวกัน (/hr/sites, /hr/checkin-policy) ไม่ต้องตั้งซ้ำ
 *
 * เข้าจากไอคอน "ลงเวลา" บนหน้าแรก (components/home/clock-tile.tsx) — สองแตะ (ไอคอน → ปุ่ม)
 * โดยตั้งใจ กันแตะไอคอนพลาดแล้วกลายเป็นลงเวลาไปแล้ว
 */
export default async function ClockPage() {
  return (
    <HrPage
      title="ลงเวลา"
      permission={HR_PERMS.access}
      width="max-w-lg"
      load={async () => {
        const session = await requireOrg();
        const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } });
        return <Today userName={me?.name ?? ""} showFriendHint={false} />;
      }}
    />
  );
}
