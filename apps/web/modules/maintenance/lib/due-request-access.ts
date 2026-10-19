/**
 * ใครอนุมัติคำขอเลื่อนกำหนดส่งใบงานได้ — CEO (ดูข้อมูลทั้งบริษัท) หรือคนเปิดใบงาน · คนขอเองไม่ได้
 * ใช้ทั้งหน้าใบงาน (โชว์ปุ่ม) และ server action (ตรวจซ้ำ)
 */
export function canDecideDueRequest(
  me: { userId: string; viewAll: boolean },
  wo: { createdBy: string | null },
  requestedBy: string
): boolean {
  if (me.userId === requestedBy) return false;
  return me.viewAll || wo.createdBy === me.userId;
}

/**
 * ใครแก้กำหนดส่งใบงานตรง ๆ ได้ (ไม่ต้องขออนุมัติ) — CEO หรือคนเปิดใบงาน (ผู้ใช้ขอ 19/10/2569)
 * เลื่อนออก/เลื่อนเข้าได้ แต่ไม่ก่อนวันนี้ · ใช้ทั้งหน้าใบงานและ server action
 */
export function canEditDueDate(
  me: { userId: string; viewAll: boolean },
  wo: { createdBy: string | null }
): boolean {
  return me.viewAll || wo.createdBy === me.userId;
}
