import "server-only";
import { hasPermission, type Session } from "@smartboss/auth";

import { sourceKeyOfThumb } from "@/lib/doc-thumb";
import { canServeCompanyFileKey } from "@/modules/company-files/lib/serve-access";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { canServeRequestFileKey } from "@/modules/requests/lib/serve-access";

/**
 * สิทธิ์เปิดไฟล์ "ของบริษัทตัวเอง" ที่ละเอียดกว่าระดับบริษัท (ผู้เรียกเช็ค orgId มาแล้ว)
 *
 * รูปหน้าแรก `<ไฟล์>.thumb.png` เห็นเนื้อหาของไฟล์ จึงต้องใช้สิทธิ์ของไฟล์ต้นทางเสมอ
 * ⚠ ห้ามส่ง key ของรูปไปเช็คตรง ๆ: รูปไม่มีแถวใน DB และ canServeCompanyFileKey ปล่อยผ่าน
 * เมื่อไม่พบแถว ไฟล์ในห้องที่จำกัดสิทธิ์จะรั่วทางรูปหน้าแรกทันที
 */
export async function canServeOwnedFileKey(session: Session, rawKey: string): Promise<boolean> {
  const key = sourceKeyOfThumb(rawKey);
  const orgId = session.orgId;
  if (!orgId) return false;

  // คลังกลาง: ไฟล์ในโฟลเดอร์ผูกห้อง ต้องเป็นสมาชิกห้องนั้น (ดู serve-access.ts)
  if (key.startsWith(`${orgId}/company-files/`)) {
    return canServeCompanyFileKey(orgId, session.userId, key);
  }
  // เบิกจ่าย & OT — ใบเสร็จ/สลิปเห็นเฉพาะคนที่เกี่ยวกับใบนั้น
  if (key.startsWith(`${orgId}/requests/`)) {
    return canServeRequestFileKey(orgId, session, key);
  }
  // ใบเสร็จค่าใช้จ่ายแจ้งซ่อม — มีชื่อคนและเลขบัญชี เปิดได้เฉพาะคนดูค่าใช้จ่ายได้ (ผู้ใช้ 3/11/2569)
  if (key.startsWith(`${orgId}/maintenance/receipts/`)) {
    return [MAINT_PERMS.expenseView, MAINT_PERMS.expenseManage].some((p) => hasPermission(session, p));
  }
  return true;
}
