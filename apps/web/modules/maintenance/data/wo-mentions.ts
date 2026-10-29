import "server-only";
import { prisma } from "@smartboss/database";

import { propertyCaretaker } from "@/modules/maintenance/data/notify";

/**
 * ใคร @ ได้ในคอมเมนต์ใบงานซ่อม — คนในใบงาน (ผู้รับมอบหมาย/ผู้เปิด/cc/ผู้ดูแลบ้าน) + CEO ทุกคน
 * แบบเดียวกับแท็กในงาน (task-detail-sheet.tsx mentionPeople: CEO แท็กได้ทุกงานแม้ไม่ได้อยู่ในงาน)
 * ผู้ใช้ขอ 29/10/2569: ใบงานที่ CEO ไม่เกี่ยวไม่แจ้ง "ยกเว้นจะ @ ceo"
 */
export async function workOrderMentionPeople(
  orgId: string,
  wo: { assignedTo: string | null; createdBy: string | null; ccUserIds: string[]; propertyId: string | null }
): Promise<{ id: string; name: string }[]> {
  const involved = [wo.assignedTo, wo.createdBy, ...wo.ccUserIds, ...(await propertyCaretaker(orgId, wo.propertyId))].filter(
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
