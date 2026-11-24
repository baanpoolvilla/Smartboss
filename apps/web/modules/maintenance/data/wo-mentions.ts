import "server-only";
import { prisma } from "@smartboss/database";

import { propertyCaretaker } from "@/modules/maintenance/data/notify";

/** ทุกคนในบริษัทที่ยังใช้งานอยู่ — @ ได้ในคอมเมนต์ใบงาน (ไม่ส่วนตัว) และใบสั่งซื้อ */
export async function orgMentionPeople(orgId: string): Promise<{ id: string; name: string }[]> {
  const rows = await prisma.user.findMany({
    where: { orgId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return rows.filter((r) => r.name.trim());
}

/**
 * ใคร @ ได้ในคอมเมนต์ใบงานซ่อม
 *  - ใบงานทั่วไป: ทุกคนในบริษัท (ผู้ใช้ 24/11/2569 "ให้แท็กได้และเมนชั่นถึงคนอื่น" — เดิมเฉพาะคนในใบ + CEO
 *    แท็กคนนอกใบแล้วชื่อไม่ขึ้นสี ไม่มีแจ้งเตือน)
 *  - ใบงานส่วนตัว: คนในใบงาน (ผู้รับมอบหมาย/ผู้เปิด/cc/ผู้ดูแลบ้าน) + CEO เหมือนเดิม — คนนอกเปิดใบไม่ได้อยู่แล้ว
 * ผู้ใช้ขอ 29/10/2569: ใบงานที่ CEO ไม่เกี่ยวไม่แจ้ง "ยกเว้นจะ @ ceo"
 */
export async function workOrderMentionPeople(
  orgId: string,
  wo: { assignedTo: string | null; groupMemberIds?: string[]; createdBy: string | null; ccUserIds: string[]; propertyId: string | null; isPrivate?: boolean }
): Promise<{ id: string; name: string }[]> {
  if (!wo.isPrivate) return orgMentionPeople(orgId);
  const involved = [wo.assignedTo, ...(wo.groupMemberIds ?? []), wo.createdBy, ...wo.ccUserIds, ...(await propertyCaretaker(orgId, wo.propertyId))].filter(
    (x): x is string => !!x
  );
  const rows = await prisma.user.findMany({
    where: {
      orgId,
      isActive: true,
      OR: [{ id: { in: involved } }, { roles: { some: { role: { code: "CEO" } } } }],
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return rows.filter((r) => r.name.trim());
}

/** คนที่ถูก @ในข้อความ (`@ชื่อ`) — ชื่อยาวก่อน กัน "@สมชาย" ไปโดน "สม" */
export function mentionedIn(content: string, people: { id: string; name: string }[]): string[] {
  const out: string[] = [];
  let rest = content;
  for (const p of [...people].sort((a, b) => b.name.length - a.name.length)) {
    const tag = `@${p.name}`;
    if (!rest.includes(tag)) continue;
    out.push(p.id);
    rest = rest.split(tag).join(" ");
  }
  return out;
}
