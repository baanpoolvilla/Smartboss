import "server-only";
import { prisma } from "@smartboss/database";
import { hasPermission, isSuperAdmin, type OrgSession } from "@smartboss/auth";

import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { workOrderAccess, workOrderVisibilityWhere, type WorkOrderAccess } from "@/modules/maintenance/data/work-order-access";
import type { MaintenanceBoardItem, MaintenanceColumn, WoType, WorkOrderReaction } from "@/modules/report_task/lib/maintenance-board";
import { listWorkOrderReactions } from "./work-order-reactions";
import type { TaskPriority } from "@/modules/report_task/types";

/**
 * ใบงานซ่อม สำหรับหน้างาน (ดู lib/maintenance-board.ts) — แสดงอย่างเดียว · สั่งซื้ออุปกรณ์ไม่มาที่นี่แล้ว
 *
 * บนบอร์ดงานทุกคน **รวม CEO** เห็นเฉพาะใบที่ "เกี่ยวกับตัวเอง" — ดูทั้งหมดให้ไปที่โมดูลแจ้งซ่อม
 * ("ถ้ามีอะไรเกี่ยวกับเค้าค่อยมาแสดงในนี้ ง่ายดี") ⇒ ไม่ใช้สิทธิ์ "เห็นข้อมูลทั้งบริษัท" (core.data.view_all) ของ
 * โมดูลแจ้งซ่อมที่นี่ · บริษัทมีคนถือ CEO หลายคน เคยเห็นทุกใบเต็มบอร์ดทั้งที่ไม่เกี่ยว
 * ยกเว้น **ผู้ดูแลระบบสูงสุด** ที่เห็นทุกใบที่ยังไม่ปิด ("ผู้ดูแลสูงสุดคือคนดูระบบ มันต้องเห็นได้หมดอยู่แล้ว")
 * และ **CEO** (บทบาท CEO) เห็นทุกใบด้วย — ผู้ใช้ขอ 19/10/2569 "จะได้รู้งานของแต่ละคน ว่าได้ task เท่าไหร่ แจ้งซ่อมใบงานเท่าไหร่"
 *   20/10/2569: ไม่ต้องมีสิทธิ์ "เห็นทั้งบริษัท" ในแจ้งซ่อมแล้ว (เดิมต้องมี CEO เลยเห็นแค่ใบของตัวเอง) · กรองต่อได้ด้วย
 *   "งานของฉัน" (ได้รับมอบหมาย) / "ที่ฉันมอบหมาย" (เปิดใบเอง) — matchesMaintenanceFilters
 * (แท็บภาระงานนับใบงานจากชุดนี้) · เห็นอย่างเดียว ไม่มีแจ้งเตือนเพิ่ม — แจ้งเตือนยังไปเฉพาะคนที่เกี่ยว (มอบหมาย/CC/@กล่าวถึง)
 * ADMIN (IT) ที่มีสิทธิ์เห็นทั้งบริษัทในแจ้งซ่อม ยังเห็นเฉพาะของตัวเองบนบอร์ดเหมือนเดิม
 *   ใบงาน: รับผิดชอบ/เปิดเอง/CC/ผู้ดูแลบ้านหลังนั้น (เกณฑ์เดียวกับแจ้งซ่อมสำหรับคนที่ไม่เห็นทั้งบริษัท)
 * ใบที่ซ่อมเสร็จแล้วแสดง 7 วันล่าสุด · ใบที่ยกเลิกไม่แสดง
 */
const DONE_DAYS = 7;
const LIMIT = 300;

const WO_PRIORITY: Record<string, TaskPriority> = { low: "low", medium: "medium", high: "high", urgent: "critical" };

/** วันนี้ตามเวลาไทย YYYY-MM-DD — "เลยกำหนด" นับเป็นวัน แบบเดียวกับงาน */
function bangkokDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

export async function listMaintenanceBoardItems(session: OrgSession): Promise<MaintenanceBoardItem[]> {
  const orgId = session.orgId;
  const since = new Date(Date.now() - DONE_DAYS * 86_400_000);
  const today = bangkokDay(new Date());
  const items: MaintenanceBoardItem[] = [];
  const reactionsByWo = new Map<string, WorkOrderReaction[]>();
  for (const r of await listWorkOrderReactions(orgId)) {
    reactionsByWo.set(r.workOrderId, [...(reactionsByWo.get(r.workOrderId) ?? []), r]);
  }

  if (hasPermission(session, MAINT_PERMS.workorderView)) {
    const full = await workOrderAccess(session);
    // ผู้ดูแลระบบสูงสุดเห็นทุกใบ · คนอื่นใช้เกณฑ์ "เกี่ยวกับตัวเอง" แม้จะมีสิทธิ์เห็นทั้งบริษัทในแจ้งซ่อม
    // CEO เห็นทุกใบแม้ไม่มีสิทธิ์เห็นทั้งบริษัทในแจ้งซ่อม (20/10/2569 — เดิมต้องมีด้วย เลยเห็นแค่ใบของตัวเอง)
    const access: WorkOrderAccess = isSuperAdmin(session) || session.roles.includes("CEO")
      ? { ...full, seeAll: true }
      : full.seeAll
        ? {
            seeAll: false,
            userId: session.userId,
            caretakerPropertyIds: (
              await prisma.property.findMany({ where: { orgId, caretakerId: session.userId }, select: { id: true } })
            ).map((r) => r.id),
          }
        : full;
    const vis = workOrderVisibilityWhere(access);
    const rows = await prisma.workOrder.findMany({
      where: {
        orgId,
        AND: [
          vis ?? {},
          { OR: [{ status: { in: ["open", "in_progress"] } }, { status: "completed", completedAt: { gte: since } }] },
        ],
      },
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        createdAt: true,
        assignedTo: true,
        createdBy: true,
        ccUserIds: true,
        pmScheduleId: true,
        pmScheduleIds: true,
        autoCreated: true,
        _count: { select: { purchaseOrders: { where: { status: { not: "cancelled" } } } } },
        property: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
    });
    for (const w of rows) {
      const done = w.status === "completed";
      const isPm = !!w.pmScheduleId || (w.pmScheduleIds ?? []).length > 0;
      const woTypes: WoType[] = [
        ...(!isPm && !w.autoCreated ? (["normal"] as const) : []),
        ...(isPm || w.autoCreated ? (["pm"] as const) : []),
        ...(w.autoCreated ? (["auto"] as const) : []),
        ...((w._count?.purchaseOrders ?? 0) > 0 ? (["po"] as const) : []),
      ];
      const column: MaintenanceColumn = done ? "done" : w.status === "in_progress" ? "in_progress" : "todo";
      items.push({
        kind: "wo",
        id: w.id,
        code: w.code,
        title: w.title,
        column,
        statusLabel: done ? "ซ่อมเสร็จแล้ว" : w.status === "in_progress" ? "กำลังซ่อม" : "รอดำเนินการ",
        priority: WO_PRIORITY[w.priority] ?? "medium",
        dueDate: w.dueDate?.toISOString() ?? null,
        createdAt: w.createdAt.toISOString(),
        overdue: !done && !!w.dueDate && bangkokDay(w.dueDate) < today,
        responsibleId: w.assignedTo ?? w.createdBy,
        assigneeId: w.assignedTo,
        createdById: w.createdBy,
        involvedIds: [...new Set([w.assignedTo, w.createdBy, ...w.ccUserIds].filter((x): x is string => !!x))],
        place: w.property?.name ?? null,
        href: `/maintenance/work-orders/${w.id}`,
        reactions: reactionsByWo.get(w.id) ?? [],
        woTypes,
      });
    }
  }

  return items;
}
