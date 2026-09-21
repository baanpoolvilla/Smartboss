/**
 * สติกเกอร์ (ให้คะแนน/หักคะแนน) ของงานกลุ่มส่งให้ "ทั้งกลุ่ม" หรือ "รายคน" ได้
 * - ไม่มี targetUserId = ทั้งกลุ่ม (รวมสติกเกอร์เก่าที่ติดไว้ก่อนมีตัวเลือกนี้ และงานเดี่ยว)
 * - มี targetUserId = เฉพาะคนนั้น
 * ไม่ import อะไรเลยเพื่อให้เทสต์ตรง ๆ ได้
 */

/** สติกเกอร์นี้นับเป็นของคน userId ไหม (ไม่ส่ง userId = นับหมด เช่น ยอดรวมทั้งงาน/แผนก) */
export function reactionCountsFor(reaction: { targetUserId?: string }, userId?: string): boolean {
  if (!userId || !reaction.targetUserId) return true;
  return reaction.targetUserId === userId;
}

/** ป้ายผู้รับที่แสดงข้างอิโมจิ: ชื่อคน (รายคน) หรือ "ทั้งกลุ่ม" */
export function reactionTargetLabel(reaction: { targetUserId?: string }, nameOf: (id: string) => string | undefined): string {
  return reaction.targetUserId ? (nameOf(reaction.targetUserId) ?? "ไม่ทราบชื่อ") : "ทั้งกลุ่ม";
}

/** รายชื่อที่ควรได้รับแจ้งเตือนตอนติดสติกเกอร์: คนที่เลือก หรือผู้รับผิดชอบทุกคน */
export function reactionRecipients(assigneeIds: string[], targetUserId?: string): string[] {
  return targetUserId && assigneeIds.includes(targetUserId) ? [targetUserId] : assigneeIds;
}
