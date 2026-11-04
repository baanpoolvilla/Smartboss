/**
 * คนที่มีสิทธิ์ลบแยก (ไม่ใช่แอดมินโมดูล) ลบได้เฉพาะใบที่ยังไม่ปิดและยังไม่เลยกำหนด
 * ใบที่ไม่มีกำหนดส่งยังไม่มีทางโดนหักจึงลบได้ · ใบเลยกำหนดลบไม่ได้ เพราะการลบจะคืนคะแนนที่โดนหัก
 */
export function canDeleteWorkOrderWithPerm(
  wo: { status: string; dueDate: Date | null },
  now: Date = new Date(),
): boolean {
  if (wo.status !== "open" && wo.status !== "in_progress") return false;
  return !wo.dueDate || wo.dueDate >= now;
}
