"use server";

import { revalidatePath } from "next/cache";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { upsertLineConfig } from "@/modules/maintenance/data/notify";
import { logActivity } from "@/modules/maintenance/data/activity";

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
  // ไม่เก็บ token ลงบันทึก (เป็นความลับ) — บอกแค่ว่าเปลี่ยนหรือไม่
  await logActivity(orgId, {
    userId: (await requireOrg()).userId,
    entity: "settings",
    action: "update",
    summary: `ตั้งค่า LINE: ${enabled ? "เปิด" : "ปิด"}การส่ง${token ? " (บันทึก token)" : ""}`,
    detail: { enabled, tokenSet: !!token },
  });
  revalidatePath("/maintenance/settings");
}
