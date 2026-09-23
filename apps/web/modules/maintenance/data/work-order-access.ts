import "server-only";
import { prisma, Prisma } from "@smartboss/database";
import { canViewAll, type OrgSession } from "@smartboss/auth";

/**
 * ใครเห็นใบงานใบไหนได้บ้าง — กติกาเดียวใช้ร่วมกันทุกหน้า
 *
 * ใบงานเป็นเรื่องของ "คนที่เกี่ยวข้องกับงานนั้นจริง ๆ" ไม่ใช่ประกาศของบริษัท:
 * คนเปิดใบ · คนที่ถูกมอบหมาย · คน CC (เขาได้รับแจ้งเตือนอยู่แล้ว ถ้ากดเข้ามา
 * ดูไม่ได้ แจ้งเตือนก็ไร้ความหมาย) · และผู้ดูแลบ้านหลังนั้น ซึ่งรับผิดชอบทุกงาน
 * ที่เกิดในบ้านของตัวเองแม้ไม่ได้ถูกมอบหมายเป็นรายใบ
 *
 * คนที่ยังเห็นทั้งบริษัทคือคนที่ถือสิทธิ์ "เห็นข้อมูลทั้งบริษัท"
 * (core.data.view_all — SUPER_ADMIN/ADMIN/CEO ตามค่าเริ่มต้น) ไม่ได้ผูกกับ
 * ตำแหน่งแบบตายตัว ⇒ บริษัทไหนอยากให้ผู้จัดการเห็นทุกใบ ก็ไปติ๊กสิทธิ์นั้นให้
 * บทบาทนั้นเองที่ /admin/roles ไม่ต้องแก้โค้ด
 *
 * ⚠ ไม่ได้ใช้ maintenance.workorder.manage เป็นเกณฑ์ "เห็นทุกใบ" อีกต่อไป —
 * สิทธิ์นั้นแปลว่า "สร้าง/แก้/มอบหมายใบงานได้" ซึ่งผู้ดูแลบ้านทุกคนถืออยู่
 * (ดู ROLE_EXTRA_GRANTS ใน packages/database/defaults.ts) การเอามาใช้เป็น
 * เกณฑ์การมองเห็นจึงเท่ากับผู้ดูแลบ้านทุกคนเห็นงานของบ้านคนอื่นทั้งบริษัท
 */
export interface WorkOrderAccess {
  /** true = เห็นทุกใบของบริษัท (ข้ามการกรองด้านล่างทั้งหมด) */
  seeAll: boolean;
  userId: string;
  /** บ้านที่คนนี้เป็น "ผู้ดูแลบ้าน" อยู่ */
  caretakerPropertyIds: string[];
}

export async function workOrderAccess(
  session: OrgSession
): Promise<WorkOrderAccess> {
  if (canViewAll(session)) {
    return { seeAll: true, userId: session.userId, caretakerPropertyIds: [] };
  }
  const rows = await prisma.property.findMany({
    where: { orgId: session.orgId, caretakerId: session.userId },
    select: { id: true },
  });
  return {
    seeAll: false,
    userId: session.userId,
    caretakerPropertyIds: rows.map((r) => r.id),
  };
}

/**
 * กติกาเดียวกันในรูปเงื่อนไข query — ใช้กับทุกที่ที่ "นับ" หรือ "ลิสต์" ใบงาน
 * (หน้ารายการ, แดชบอร์ด) คืน null เมื่อเห็นได้ทุกใบอยู่แล้ว
 */
export function workOrderVisibilityWhere(
  access: WorkOrderAccess
): Prisma.WorkOrderWhereInput | null {
  if (access.seeAll) return null;
  const props = access.caretakerPropertyIds;
  return {
    OR: [
      { assignedTo: access.userId },
      { createdBy: access.userId },
      { ccUserIds: { has: access.userId } },
      // ผู้ดูแลบ้านเห็นงานของบ้านตัวเองทุกใบ รวมบ้านที่ใบงานพ่วงมาเพิ่ม
      // (ใบเดียวครอบหลายหลัง) ไม่ใช่เฉพาะบ้านหลัก
      ...(props.length > 0
        ? [
            { propertyId: { in: props } },
            { additionalPropertyIds: { hasSome: props } },
          ]
        : []),
    ],
  };
}

/**
 * เกณฑ์เดียวกับ workOrderVisibilityWhere แต่ใช้กับใบเดียวที่โหลดมาแล้ว
 * (หน้ารายละเอียด / การผูกใบงานเข้ากับ PR) — ต้องแก้คู่กันเสมอ ไม่งั้นจะเกิด
 * สภาพ "ไม่เห็นในลิสต์ แต่เปิดลิงก์ตรงเข้าไปดูได้"
 */
export function canSeeWorkOrder(
  access: WorkOrderAccess,
  wo: {
    assignedTo: string | null;
    createdBy: string | null;
    ccUserIds: string[];
    propertyId: string;
    additionalPropertyIds: string[];
  }
): boolean {
  if (access.seeAll) return true;
  if (wo.assignedTo === access.userId || wo.createdBy === access.userId) {
    return true;
  }
  if (wo.ccUserIds.includes(access.userId)) return true;
  if (access.caretakerPropertyIds.length === 0) return false;
  return (
    access.caretakerPropertyIds.includes(wo.propertyId) ||
    wo.additionalPropertyIds.some((id) =>
      access.caretakerPropertyIds.includes(id)
    )
  );
}
