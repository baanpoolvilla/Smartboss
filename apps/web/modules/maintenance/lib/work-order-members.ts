/**
 * ใบแจ้งซ่อมแบบกลุ่ม (ผู้ใช้ 5/11/2569 "เอาให้เหมือนของ task") — กติกาเดียวกับงานกลุ่ม:
 * ปิดงานเมื่อครบทุกคน / คนใดคนหนึ่ง / ช่วยกันทำ · เลยกำหนดหักคนที่ยังไม่เสร็จ
 *
 * assignedTo = คนแรกที่เลือก · groupMemberIds = คนที่เหลือ · ว่าง = ใบเดี่ยว ทำงานเหมือนเดิมทุกอย่าง
 */
export function workOrderMemberIds(wo: { assignedTo: string | null; groupMemberIds?: string[] | null }): string[] {
  return [...new Set([...(wo.assignedTo ? [wo.assignedTo] : []), ...(wo.groupMemberIds ?? [])])];
}

export function isWorkOrderMember(wo: { assignedTo: string | null; groupMemberIds?: string[] | null }, userId: string): boolean {
  return wo.assignedTo === userId || (wo.groupMemberIds ?? []).includes(userId);
}

/**
 * refId ของคะแนน "ใบงานเกินกำหนด" — ตารางคะแนนกันซ้ำด้วย refId ใบกลุ่มจึงต้องแยกรายคน
 * ใบเดี่ยวคงเป็นรหัสใบเหมือนเดิม คะแนนเก่าทั้งหมดอ่านได้ตามเดิม
 */
export function workOrderDockRefId(wo: { id: string; groupMemberIds?: string[] | null }, userId: string): string {
  return (wo.groupMemberIds ?? []).length > 0 ? `${wo.id}:${userId}` : wo.id;
}

/** รหัสใบงานจาก refId ของคะแนนใบงาน — ใช้ได้ทั้งใบเดี่ยวและใบกลุ่ม */
export function workOrderIdOfDockRef(refId: string): string {
  return refId.split(":")[0]!;
}

export const COMPLETION_RULE_LABEL: Record<string, string> = {
  all: "ครบทุกคน",
  any: "คนใดคนหนึ่ง",
  shared: "ช่วยกันทำ",
};

type GroupState = { assignedTo: string | null; groupMemberIds?: string[] | null; completionRule?: string | null; completedMemberIds?: string[] | null };

/** สมาชิกที่ยังไม่เสร็จ — คนกลุ่มนี้โดนหักถ้าเลยกำหนด · ใบเดี่ยวคือผู้รับผิดชอบเสมอ */
export function pendingMemberIds(wo: GroupState): string[] {
  const done = wo.completedMemberIds ?? [];
  return workOrderMemberIds(wo).filter((id) => !done.includes(id));
}

/** ปิดงานเมื่อครบทุกคน: ยังต้องรอใครอยู่ นอกจากคนที่กำลังจะปิด · แบบอื่นไม่ต้องรอ */
export function waitingOnMembers(wo: GroupState, actorId: string): string[] {
  if ((wo.groupMemberIds ?? []).length === 0 || (wo.completionRule ?? "all") !== "all") return [];
  return pendingMemberIds(wo).filter((id) => id !== actorId);
}

type DueState = GroupState & { dueDate: Date | null; memberDueDates?: unknown };

/** กำหนดส่งของคนนี้ — ตั้งแยกไว้ใช้วันนั้น ไม่งั้นใช้กำหนดส่งของใบ (เหมือนงานกลุ่ม) */
export function memberDueAt(wo: DueState, userId: string): Date | null {
  const own = (wo.memberDueDates as Record<string, string> | null | undefined)?.[userId];
  return own ? new Date(`${own}T23:59:59.999+07:00`) : wo.dueDate;
}

/** กำหนดส่งที่เร็วที่สุดของคนที่ยังไม่เสร็จ — ใช้แสดงและเรียงบนบอร์ด · ใบเดี่ยวคือกำหนดส่งของใบ */
export function earliestPendingDue(wo: DueState): Date | null {
  if ((wo.groupMemberIds ?? []).length === 0) return wo.dueDate;
  const dues = pendingMemberIds(wo).map((id) => memberDueAt(wo, id)).filter((d): d is Date => !!d);
  return dues.length > 0 ? new Date(Math.min(...dues.map((d) => d.getTime()))) : wo.dueDate;
}
