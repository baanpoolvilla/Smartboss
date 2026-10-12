import "server-only";
import { prisma } from "@smartboss/database";
import { hasPermission, hasRole, isSuperAdmin, type OrgSession } from "@smartboss/auth";

import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { workOrderAccess, workOrderVisibilityWhere, type WorkOrderAccess } from "@/modules/maintenance/data/work-order-access";
import type { MaintenanceBoardItem, MaintenanceColumn } from "@/modules/report_task/lib/maintenance-board";
import type { TaskPriority } from "@/modules/report_task/types";

/**
 * ใบงานซ่อม สำหรับหน้างาน (ดู lib/maintenance-board.ts) — แสดงอย่างเดียว · สั่งซื้ออุปกรณ์ไม่มาที่นี่แล้ว
 *
 * บนบอร์ดงานทุกคนเห็นเฉพาะใบที่ "เกี่ยวกับตัวเอง" — ดูทั้งหมดให้ไปที่โมดูลแจ้งซ่อม ("อยากเห็นแค่ของที่เกี่ยวกับผม
 * ถ้าจะดูทั้งหมดให้ไปดูที่แจ้งซ่อม ... เห็นทั้งหมดมีแค่ CEO กับแอดมินสูงสุดพอ") ⇒ ไม่ใช้สิทธิ์ "เห็นข้อมูลทั้งบริษัท"
 * (core.data.view_all) ของโมดูลแจ้งซ่อมที่นี่ — บทบาท ADMIN (IT) ถือสิทธิ์นั้นอยู่ เคยเห็นใบงานทั้งบริษัทเต็มบอร์ด
 *   ใบงาน: รับผิดชอบ/เปิดเอง/CC/ผู้ดูแลบ้านหลังนั้น (เกณฑ์เดียวกับแจ้งซ่อมสำหรับคนที่ไม่เห็นทั้งบริษัท)
 *   CEO และผู้ดูแลระบบสูงสุด: ทุกใบที่ยังไม่ปิด
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

  // เห็นทั้งหมดบนบอร์ด = CEO / ผู้ดูแลระบบสูงสุดเท่านั้น
  const seeAll = isSuperAdmin(session) || hasRole(session, "CEO");

  if (hasPermission(session, MAINT_PERMS.workorderView)) {
    const full = await workOrderAccess(session);
    // คนที่ไม่ใช่ CEO/ผู้ดูแลระบบสูงสุด ใช้เกณฑ์ "เกี่ยวกับตัวเอง" แม้จะมีสิทธิ์เห็นทั้งบริษัทในแจ้งซ่อม
    const access: WorkOrderAccess = seeAll
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
        property: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
    });
    for (const w of rows) {
      const done = w.status === "completed";
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
        involvedIds: [...new Set([w.assignedTo, w.createdBy, ...w.ccUserIds].filter((x): x is string => !!x))],
        place: w.property?.name ?? null,
        href: `/maintenance/work-orders/${w.id}`,
      });
    }
  }

  return items;
}
