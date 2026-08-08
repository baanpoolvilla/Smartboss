import "server-only";
import { prisma } from "@smartboss/database";

/** map prefix -> ชื่อหมวดที่ตั้งเอง */
export async function getCategoryNames(
  orgId: string
): Promise<Record<string, string>> {
  const rows = await prisma.propertyCategory.findMany({ where: { orgId } });
  return Object.fromEntries(rows.map((r) => [r.prefix, r.displayName]));
}

export async function upsertCategory(
  orgId: string,
  prefix: string,
  displayName: string
) {
  const key = prefix.toUpperCase();
  await prisma.propertyCategory.upsert({
    where: { orgId_prefix: { orgId, prefix: key } },
    update: { displayName },
    create: { orgId, prefix: key, displayName },
  });
}
