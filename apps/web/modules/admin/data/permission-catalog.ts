import "server-only";
import { prisma } from "@smartboss/database";

/**
 * แคตตาล็อกสิทธิ์ทั้งหมด จัดกลุ่มตามโมดูล (moduleId = null → กลุ่ม core)
 * ใช้ร่วมกันโดย Role / Department / Position — ทั้งสามกำหนดสิทธิ์ได้จาก
 * แคตตาล็อกเดียวกัน ไม่มีระบบ permission code แยกของตัวเอง
 */
export async function listPermissionCatalog() {
  const perms = await prisma.permission.findMany({
    orderBy: { code: "asc" },
    include: { module: { select: { code: true, name: true, color: true } } },
  });

  const groups = new Map<
    string,
    { key: string; name: string; color: string; items: { id: string; code: string }[] }
  >();

  for (const p of perms) {
    const key = p.module?.code ?? "core";
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: p.module?.name ?? "ระบบหลัก (หลังบ้าน)",
        color: p.module?.color ?? "#1B2537",
        items: [],
      });
    }
    groups.get(key)!.items.push({ id: p.id, code: p.code });
  }

  // ระบบหลักขึ้นก่อนเสมอ ที่เหลือเรียงตามชื่อ
  return Array.from(groups.values()).sort((a, b) => {
    if (a.key === "core") return -1;
    if (b.key === "core") return 1;
    return a.name.localeCompare(b.name);
  });
}

export type PermissionGroup = Awaited<ReturnType<typeof listPermissionCatalog>>[number];
