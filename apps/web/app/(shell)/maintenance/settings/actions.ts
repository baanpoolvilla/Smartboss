"use server";

import { revalidatePath } from "next/cache";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { upsertLineConfig } from "@/modules/maintenance/data/notify";

/**
 * การจัดการผู้ใช้/บทบาท ย้ายไปหลังบ้านกลางที่ /admin/users แล้ว
 * หน้านี้เหลือเฉพาะการตั้งค่าที่เป็นของโมดูลแจ้งซ่อมบำรุงจริง ๆ (LINE OA ของบริษัท)
 */
async function requireAdmin(): Promise<string> {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.admin)) {
    throw new Error("ไม่มีสิทธิ์");
  }
  return s.orgId;
}

export async function saveLineConfigAction(formData: FormData) {
  const orgId = await requireAdmin();
  const token = String(formData.get("token") ?? "").trim() || null;
  const enabled = formData.get("enabled") === "1";
  await upsertLineConfig(orgId, token, enabled);
  revalidatePath("/maintenance/settings");
}
