import { earliestPendingDue } from "@/modules/maintenance/lib/work-order-members";
import "server-only";
import { prisma, type Prisma } from "@smartboss/database";
import { hasPermission, isSuperAdmin, type OrgSession } from "@smartboss/auth";

import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { workOrderAccess, workOrderVisibilityWhere, type WorkOrderAccess } from "@/modules/maintenance/data/work-order-access";
import type { MaintenanceBoardItem, MaintenanceColumn, WoType, WorkOrderReaction } from "@/modules/report_task/lib/maintenance-board";
import { loadExpenseTracking, pendingExpenseWorkOrders, recordedExpenseWorkOrders } from "@/modules/maintenance/data/expense-tracking";
import { expenseDueAt } from "@/modules/maintenance/lib/expense-deadline";
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
 *
 * ผู้บันทึกค่าใช้จ่าย: ใบที่ปิดแล้วรอบันทึกทุกใบขึ้นเป็นงานของตัวเอง กำหนด = กำหนดบันทึก เรียงบนสุด ไม่จำกัด 7 วัน
 * (ผู้ใช้ 3/11/2569 "สร้างให้เป็นงานของเค้า มี due date")
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
    const select = {
      id: true,
      code: true,
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      createdAt: true,
      completedAt: true,
      expenseDueDate: true,
      assignedTo: true,
      groupMemberIds: true,
      completedMemberIds: true,
      memberDueDates: true,
      createdBy: true,
      ccUserIds: true,
      pmScheduleId: true,
      pmScheduleIds: true,
      autoCreated: true,
      isPrivate: true,
      photoUrls: true,
      afterPhotoUrls: true,
      _count: {
        select: {
          purchaseOrders: { where: { status: { not: "cancelled" } } },
          comments: { where: { OR: [{ kind: null }, { kind: { not: "log" } }] } },
          dueRequests: { where: { status: "pending" } },
        },
      },
      property: { select: { name: true } },
    } satisfies Prisma.WorkOrderSelect;
    // ใบรอบันทึกแยกดึงต่างหาก — เก่าแค่ไหนก็ต้องขึ้น ไม่อยู่ใต้เงื่อนไข 7 วันและเพดาน LIMIT
    const pendingIds = access.expensePendingIds ?? [];
    const pendingSet = new Set(pendingIds);
    const vis = workOrderVisibilityWhere({ ...access, expensePendingIds: undefined, expenseRecordedIds: undefined });
    // ผู้บันทึก: ใบที่เพิ่งบันทึกไป (7 วัน) ขึ้นคอลัมน์เสร็จพร้อมยอด ให้รู้ว่าเสร็จแล้วและกลับมาแก้ได้
    const recordedMap = new Map(
      access.expenseRecordedIds
        ? (await recordedExpenseWorkOrders(orgId)).filter((r) => r.at >= since && !pendingSet.has(r.id)).map((r) => [r.id, r.total] as const)
        : [],
    );
    const specialIds = [...pendingIds, ...recordedMap.keys()];
    const rows = await prisma.workOrder.findMany({
      where: {
        orgId,
        ...(specialIds.length > 0 ? { id: { notIn: specialIds } } : {}),
        AND: [
          vis ?? {},
          { OR: [{ status: { in: ["open", "in_progress"] } }, { status: "completed", completedAt: { gte: since } }] },
        ],
      },
      select,
      orderBy: { createdAt: "desc" },
      take: LIMIT,
    });
    const pendingRows = specialIds.length > 0 ? await prisma.workOrder.findMany({ where: { orgId, id: { in: specialIds } }, select }) : [];
    const tracking = pendingIds.length > 0 ? await loadExpenseTracking(orgId) : null;
    const clockFrom = new Map(tracking ? (await pendingExpenseWorkOrders(orgId)).map((o) => [o.id, o.clockFrom] as const) : []);
    for (const w of [...pendingRows, ...rows]) {
      const expensePending = pendingSet.has(w.id);
      const expenseRecordedTotal = recordedMap.get(w.id);
      const done = w.status === "completed" && !expensePending;
      const isPm = !!w.pmScheduleId || (w.pmScheduleIds ?? []).length > 0;
      const woTypes: WoType[] = [
        ...(!isPm && !w.autoCreated ? (["normal"] as const) : []),
        ...(isPm || w.autoCreated ? (["pm"] as const) : []),
        ...(w.autoCreated ? (["auto"] as const) : []),
        ...((w._count?.purchaseOrders ?? 0) > 0 ? (["po"] as const) : []),
      ];
      const column: MaintenanceColumn = done ? "done" : w.status === "in_progress" ? "in_progress" : "todo";
      const expenseDue = expensePending && tracking ? expenseDueAt({ ...w, clockFrom: clockFrom.get(w.id) }, tracking) : null;
      items.push({
        kind: "wo",
        id: w.id,
        code: w.code,
        title: w.title,
        column,
        statusLabel: expensePending ? "รอบันทึกค่าใช้จ่าย" : done ? "ซ่อมเสร็จแล้ว" : w.status === "in_progress" ? "กำลังซ่อม" : "รอดำเนินการ",
        priority: WO_PRIORITY[w.priority] ?? "medium",
        dueDate: (expenseDue ?? earliestPendingDue(w))?.toISOString() ?? null,
        createdAt: w.createdAt.toISOString(),
        overdue: expenseDue ? bangkokDay(expenseDue) < today : !done && !!earliestPendingDue(w) && bangkokDay(earliestPendingDue(w)!) < today,
        responsibleId: expensePending || expenseRecordedTotal !== undefined ? session.userId : (w.assignedTo ?? w.createdBy),
        assigneeId: w.assignedTo,
        assigneeMore: w.groupMemberIds.length,
        groupMemberIds: w.groupMemberIds,
        createdById: w.createdBy,
        involvedIds: [...new Set([w.assignedTo, ...w.groupMemberIds, w.createdBy, ...w.ccUserIds].filter((x): x is string => !!x))],
        place: w.property?.name ?? null,
        href: `/maintenance/work-orders/${w.id}`,
        reactions: reactionsByWo.get(w.id) ?? [],
        woTypes,
        commentCount: w._count?.comments ?? 0,
        photoCount: w.photoUrls.length + w.afterPhotoUrls.length,
        pendingDue: w._count?.dueRequests ?? 0,
        isPrivate: w.isPrivate,
        status: w.status,
        autoCreated: w.autoCreated,
        expensePending,
        expenseRecordedTotal,
      });
    }
  }

  return items;
}
