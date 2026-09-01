import "server-only";
import { prisma } from "@smartboss/database";
import { canUserAccessReportTopic } from "@/modules/report_task/lib/room-access-server";

/**
 * ตรวจว่าผู้ใช้คนนี้เปิด "ไฟล์คลังกลาง (company-files)" ก้อนนี้ได้ไหม — ใช้ตอนเสิร์ฟ
 * ไบต์ที่ /api/files/[...key] ไม่ใช่แค่ตอน list
 *
 * ทำไมต้องมี: สิทธิ์ระดับห้อง (โฟลเดอร์ที่ผูก roomId เห็นเฉพาะสมาชิกห้อง) เดิมบังคับ
 * แค่ตอนแสดงรายการ/ทำ action ใน data/files.ts เท่านั้น ตัวไฟล์จริงยังเปิดได้ด้วย URL
 * ถ้าอยู่บริษัทเดียวกัน — คนที่ไม่ได้อยู่ในห้องลับจึงยังแอบเปิดไฟล์ห้องนั้นได้ถ้าได้ลิงก์
 * ที่นี่จึงเดินหาห้องที่ไฟล์สังกัดแล้วเช็คสิทธิ์ห้องซ้ำอีกชั้นตอนเสิร์ฟ
 *
 * key ที่รับเข้ามาคือส่วนหลัง /api/files/ (เช่น `<orgId>/company-files/<uuid>.pdf`)
 * ส่วน storageKey ที่เก็บใน DB เป็น URL เต็ม `/api/files/<key>` (ดู createFile/addFileVersion)
 */
export async function canServeCompanyFileKey(
  orgId: string,
  userId: string,
  joinedKey: string
): Promise<boolean> {
  const storageKey = `/api/files/${joinedKey}`;

  // หาไฟล์จากทุกเวอร์ชัน (แต่ละเวอร์ชันมี storageKey ของตัวเอง) แล้วผูกกลับไปหา
  // โฟลเดอร์ของไฟล์ — จำกัด orgId ไว้ด้วยกันข้ามบริษัท (route ก็กัน orgId แล้ว แต่กันซ้ำ)
  const version = await prisma.companyFileVersion.findFirst({
    where: { storageKey, file: { orgId } },
    select: { file: { select: { folderId: true } } },
  });
  const file =
    version?.file ??
    (await prisma.companyFile.findFirst({
      where: { storageKey, orgId },
      select: { folderId: true },
    }));

  // ไม่พบแถว (เพิ่งอัปโหลดยังไม่ทันบันทึก DB / เป็น key ที่ไม่ใช่ของ company-files)
  // ⇒ ปล่อยผ่าน เพราะชั้น orgId ที่ route กันไว้แล้วยังอยู่ ไม่เปิดช่องข้ามบริษัท
  if (!file) return true;

  const roomId = await getEffectiveRoomId(orgId, file.folderId);
  if (!roomId) return true; // ไฟล์ระดับบริษัท (ไม่ผูกห้อง) — ใครในบริษัทก็เปิดได้
  return canUserAccessReportTopic(orgId, roomId, userId);
}

/**
 * เดินขึ้นสายพ่อแม่ของโฟลเดอร์เพื่อหา roomId ตัวแรก — โฟลเดอร์ลูกของโฟลเดอร์ห้อง
 * ถือว่าอยู่ในห้องนั้นด้วย (ตรรกะเดียวกับ getEffectiveRoomId ใน data/files.ts)
 */
async function getEffectiveRoomId(orgId: string, folderId: string | null): Promise<string | null> {
  let currentId = folderId;
  for (let i = 0; i < 20 && currentId; i++) {
    const folder = await prisma.companyFolder.findFirst({
      where: { id: currentId, orgId },
      select: { roomId: true, parentId: true },
    });
    if (!folder) return null;
    if (folder.roomId) return folder.roomId;
    currentId = folder.parentId;
  }
  return null;
}
