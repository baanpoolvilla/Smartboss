import "server-only";
import { prisma } from "@smartboss/database";

/**
 * บันทึกการใช้งานโมดูลแจ้งซ่อมบำรุง — ใครทำอะไร กับอะไร เมื่อไหร่
 * เรียกจาก server action หลังทำสำเร็จแล้ว (ก่อน redirect) · ห้าม throw: บันทึกพลาดต้องไม่ทำให้งานจริงพลาดตาม
 * อ่านที่ /maintenance/settings/activity-log (Super admin / CEO)
 */

export type ActivityEntity =
  | "work_order"
  | "purchase_order"
  | "property"
  | "category"
  | "asset"
  | "expense"
  | "pm"
  | "contractor"
  | "return"
  | "settings";

export const ENTITY_LABELS: Record<ActivityEntity, string> = {
  work_order: "ใบงาน",
  purchase_order: "สั่งซื้ออุปกรณ์",
  property: "บ้าน",
  category: "หมวดบ้าน",
  asset: "อุปกรณ์",
  expense: "ค่าใช้จ่าย",
  pm: "บำรุงรักษา",
  contractor: "Contact",
  return: "คืนของ",
  settings: "ตั้งค่าโมดูล",
};

export type ActivityKind = "create" | "update" | "delete" | "status" | "comment" | "other";

export const ACTION_LABELS: Record<ActivityKind, string> = {
  create: "สร้าง",
  update: "แก้ไข",
  delete: "ลบ",
  status: "เปลี่ยนสถานะ",
  comment: "ความคิดเห็น",
  other: "อื่น ๆ",
};

export interface ActivityInput {
  /** null = ระบบ/ช่างภายนอก */
  userId: string | null;
  actorLabel?: string | null;
  entity: ActivityEntity;
  entityId?: string | null;
  entityCode?: string | null;
  action: ActivityKind;
  /** ประโยคภาษาไทยที่อ่านแล้วรู้เรื่อง เช่น 'อนุมัติ PR-2569-0012 "ท่อน้ำ"' */
  summary: string;
  detail?: Record<string, unknown> | null;
}

export async function logActivity(orgId: string, input: ActivityInput): Promise<void> {
  try {
    await prisma.maintenanceActivity.create({
      data: {
        orgId,
        userId: input.userId,
        actorLabel: input.actorLabel ?? null,
        entity: input.entity,
        entityId: input.entityId ?? null,
        entityCode: input.entityCode ?? null,
        action: input.action,
        summary: input.summary.slice(0, 500),
        detail: (input.detail ?? undefined) as never,
      },
    });
  } catch (err) {
    console.error("[maintenance-activity] failed to write log:", err);
  }
}

export interface ActivityFilter {
  userId?: string;
  entity?: string;
  from?: Date;
  to?: Date;
  q?: string;
}

export const ACTIVITY_PAGE_SIZE = 100;

export async function listActivity(orgId: string, f: ActivityFilter, page = 1) {
  const where = {
    orgId,
    ...(f.userId ? { userId: f.userId } : {}),
    ...(f.entity ? { entity: f.entity } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(f.q
      ? {
          OR: [
            { summary: { contains: f.q, mode: "insensitive" as const } },
            { entityCode: { contains: f.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.maintenanceActivity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * ACTIVITY_PAGE_SIZE,
      take: ACTIVITY_PAGE_SIZE,
    }),
    prisma.maintenanceActivity.count({ where }),
  ]);
  return { rows, total };
}

/** คนที่เคยมีบันทึก (ตัวเลือกกรองตามคน) */
export async function activityActors(orgId: string): Promise<string[]> {
  const rows = await prisma.maintenanceActivity.findMany({
    where: { orgId, userId: { not: null } },
    distinct: ["userId"],
    select: { userId: true },
  });
  return rows.map((r) => r.userId!).filter(Boolean);
}
