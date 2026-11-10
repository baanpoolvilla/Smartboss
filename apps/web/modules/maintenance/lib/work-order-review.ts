/**
 * ตรวจใบแจ้งซ่อมก่อนบันทึกค่าใช้จ่าย (ผู้ใช้ 10/11/2569 "ตรวจผ่าน/ไม่ผ่านแบบ task") — กติกาล้วน ไม่แตะฐานข้อมูล
 *
 *   ต้องตรวจ: ใบที่คนเปิด (ไม่ใช่ระบบเปิดให้) — รวมใบที่กด "สร้างใบงาน" เองจากแผน PM (ผู้ใช้: "เปิดมาน่าจะมีปัญหา/ค่าใช้จ่าย")
 *   ไม่ต้องตรวจ: ใบ PM อัตโนมัติ · ใบรอบ PM (ทำล่วงหน้า / CEO รวบ) · ใบส่วนตัว · ใบไม่มีคนเปิด · บริษัทปิดสวิตช์
 *   คนตรวจ = คนเปิดใบ (เปิดให้ตัวเองก็ตรวจเอง) · บอสเข้ามาตรวจได้ทุกใบ แต่ไม่ได้แจ้งเตือน (ผู้ใช้ "เห็นและกดได้ แค่ไม่มีแจ้งเตือน")
 *   ส่งงาน → pending (สถานะยังเป็น "เสร็จแล้ว" เหมือนงานบนบอร์ด) · ผ่าน → passed ไปขั้นค่าใช้จ่าย · ไม่ผ่าน → failed กลับ "กำลังทำ"
 */

export type ReviewState = "none" | "pending" | "passed" | "failed";

export interface ReviewableOrder {
  autoCreated: boolean;
  pmRoundDate: Date | null;
  isPrivate: boolean;
  createdBy: string | null;
}

/** ใบนี้ต้องให้คนเปิดใบตรวจก่อนไปขั้นค่าใช้จ่ายไหม */
export function needsReview(wo: ReviewableOrder, enabled: boolean): boolean {
  return enabled && !wo.autoCreated && !wo.pmRoundDate && !wo.isPrivate && !!wo.createdBy;
}

/** คนที่ได้แจ้งเตือนให้ตรวจ (คนเปิดใบ) */
export function reviewerOf(wo: { createdBy: string | null }): string | null {
  return wo.createdBy;
}

/** กด ผ่าน/ไม่ผ่าน ได้ไหม — คนเปิดใบ หรือบอส (เห็นทุกใบ) */
export function canReviewOrder(wo: { createdBy: string | null }, userId: string, isBoss: boolean): boolean {
  return wo.createdBy === userId || isBoss;
}

/** ส่งงานแล้ว รอตรวจ */
export function isAwaitingReview(wo: { status: string; reviewState?: string | null }): boolean {
  return wo.status === "completed" && wo.reviewState === "pending";
}

/** เงื่อนไข Prisma: ใบที่ไม่ได้ค้างรอตรวจ — ใช้กับทุกที่ที่นับ "ปิดแล้ว รอบันทึกค่าใช้จ่าย" */
export const NOT_AWAITING_REVIEW = { reviewState: { not: "pending" } } as const;

/** วันกำหนดส่งใหม่ตอน "ไม่ผ่าน" ใช้ได้ไหม — YYYY-MM-DD ไม่ย้อนหลังวันนี้ (เวลาไทย) */
export function validRedoDate(day: string, today: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= today;
}
