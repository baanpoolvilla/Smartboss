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
