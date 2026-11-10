"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@smartboss/database";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { upsertLineConfig, usersWithPermission } from "@/modules/maintenance/data/notify";
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

/** กำหนดบันทึกค่าใช้จ่าย (lib/expense-deadline.ts) — ไม่ใส่วันเริ่มใช้ = ปิด */
export async function saveExpenseTrackingAction(formData: FormData) {
  const orgId = await requireAdmin();
  const fromRaw = String(formData.get("from") ?? "").trim();
  if (fromRaw && !/^\d{4}-\d{2}-\d{2}$/.test(fromRaw)) throw new Error("วันเริ่มใช้ไม่ถูกต้อง");
  const days = Number(formData.get("days"));
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error("จำนวนวันต้องอยู่ระหว่าง 1–90");
  const allowed = new Set(await usersWithPermission(orgId, MAINT_PERMS.expenseManage));
  const recorderIds = formData.getAll("recorderIds").map(String).filter((id) => allowed.has(id));
  if (fromRaw && recorderIds.length === 0) throw new Error("เลือกผู้บันทึกค่าใช้จ่ายอย่างน้อย 1 คนก่อนเปิดใช้");
  const data = {
    expenseTrackFrom: fromRaw ? new Date(`${fromRaw}T00:00:00.000Z`) : null,
    expenseTrackDays: days,
    expenseRecorderIds: recorderIds,
  };
  await prisma.performanceSetting.upsert({ where: { orgId }, create: { orgId, ...data }, update: data });
  await logActivity(orgId, {
    userId: (await requireOrg()).userId,
    entity: "settings",
    action: "update",
    summary: fromRaw ? `ตั้งกำหนดบันทึกค่าใช้จ่าย เริ่ม ${fromRaw} · ${days} วัน · ผู้บันทึก ${recorderIds.length} คน` : "ปิดกำหนดบันทึกค่าใช้จ่าย",
  });
  revalidatePath("/maintenance/settings");
  revalidatePath("/maintenance/work-orders");
}

/** ตรวจใบงานก่อนบันทึกค่าใช้จ่าย (lib/work-order-review.ts) — ค่าตั้งต้นเปิด */
export async function saveWoReviewAction(formData: FormData) {
  const orgId = await requireAdmin();
  const enabled = formData.get("enabled") === "1";
  await prisma.performanceSetting.upsert({ where: { orgId }, create: { orgId, woReviewEnabled: enabled }, update: { woReviewEnabled: enabled } });
  await logActivity(orgId, {
    userId: (await requireOrg()).userId,
    entity: "settings",
    action: "update",
    summary: `${enabled ? "เปิด" : "ปิด"}การตรวจใบงานก่อนบันทึกค่าใช้จ่าย`,
  });
  revalidatePath("/maintenance/settings");
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
