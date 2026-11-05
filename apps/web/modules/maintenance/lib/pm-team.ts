/**
 * แผน PM แบบกลุ่ม (ผู้ใช้ 5/11/2569 "แก้ทีเดียวไปเลย") — ใบทุกรอบได้ทีม วิธีปิดงาน และเช็กลิสต์จากแผน
 * แผนเดี่ยว (groupMemberIds ว่าง) ได้ใบเดี่ยวแบบเดิมทุกอย่าง
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "@smartboss/database";
import { checklistFromTemplate, readChecklistTemplate } from "@/modules/maintenance/lib/work-order-checklist";

type PmTeam = { groupMemberIds?: string[] | null; completionRule?: string | null; checklist?: unknown };

/** ฟิลด์ทีม + เช็กลิสต์ของใบรอบใหม่ — ใส่ต่อจาก assignedTo ตอน workOrder.create */
export function roundOrderTeam(pm: PmTeam, assignedTo: string | null) {
  const groupMemberIds = (pm.groupMemberIds ?? []).filter((id) => id && id !== assignedTo);
  const completionRule = groupMemberIds.length > 0 ? (pm.completionRule ?? "all") : null;
  const checklist = checklistFromTemplate(readChecklistTemplate(pm.checklist), { assignedTo, groupMemberIds, completionRule }, () => randomUUID());
  return {
    groupMemberIds,
    completionRule,
    ...(checklist.length > 0 ? { checklist: checklist as unknown as Prisma.InputJsonValue } : {}),
  };
}
