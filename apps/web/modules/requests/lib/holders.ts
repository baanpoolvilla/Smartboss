import "server-only";
import { cache } from "react";
import { prisma } from "@smartboss/database";

import { withRequestsTenant } from "./db";

/**
 * คนถือเงินสดย่อย — รายชื่อที่ HR/CEO ติ๊กที่หน้าเงินสดย่อย (requests.petty_holders) ไม่ใช่สิทธิ์ของบทบาท
 * ติ๊กแล้วได้ครบ: การ์ดของตัวเอง + เมนูเงินสดย่อย + ทะเบียนช่าง/ร้านภายนอก + จ่ายใบเบิกจากเงินสดย่อยของตัวเอง
 * (ผู้ใช้ 31/10/2569 "ติ๊กอันนี้แบบจบ")
 */
export const pettyHolderIds = cache(async (orgId: string): Promise<string[]> => {
  const rows = await withRequestsTenant(orgId, (tx) =>
    tx.moneyPettyHolder.findMany({ where: { orgId, removedAt: null }, select: { userId: true } }),
  ).catch((error: unknown) => {
    console.error("[requests] petty holders failed", error);
    return [];
  });
  return rows.map((r) => r.userId);
});

/** คนถือเงินที่ยังใช้งานอยู่ เรียงตามชื่อ */
export async function listPettyHolders(orgId: string): Promise<{ id: string; name: string }[]> {
  const ids = await pettyHolderIds(orgId);
  if (ids.length === 0) return [];
  return prisma.user.findMany({ where: { orgId, id: { in: ids }, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

export async function isPettyHolder(orgId: string, userId: string): Promise<boolean> {
  return (await pettyHolderIds(orgId)).includes(userId);
}
