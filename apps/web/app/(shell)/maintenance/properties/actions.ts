"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import {
  createProperty,
  updateProperty,
  deleteProperty,
  setPropertyCategory,
} from "@/modules/maintenance/data/properties";
import {
  createCategory,
  renameCategory,
  deleteCategory,
  moveCategory,
} from "@/modules/maintenance/data/categories";

const schema = z.object({
  name: z.string().trim().min(1, "กรุณากรอกชื่อบ้าน").max(200),
  caretakerId: z.string().trim().optional(),
  address: z.string().trim().max(500).optional(),
  ownerName: z.string().trim().max(200).optional(),
  ownerContact: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
  categoryId: z.string().trim().optional(),
});

async function requirePropManage(): Promise<string> {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.propertyManage)) {
    throw new Error("ไม่มีสิทธิ์จัดการบ้าน");
  }
  return s.orgId;
}

function parseForm(formData: FormData) {
  return schema.safeParse({
    name: formData.get("name"),
    caretakerId: (formData.get("caretakerId") as string) || undefined,
    address: (formData.get("address") as string) || undefined,
    ownerName: (formData.get("ownerName") as string) || undefined,
    ownerContact: (formData.get("ownerContact") as string) || undefined,
    notes: (formData.get("notes") as string) || undefined,
    categoryId: (formData.get("categoryId") as string) || undefined,
  });
}

export async function createPropertyAction(formData: FormData) {
  const orgId = await requirePropManage();
  const parsed = parseForm(formData);
  if (!parsed.success) return;
  const d = parsed.data;
  await createProperty(orgId, {
    name: d.name,
    caretakerId: d.caretakerId || null,
    address: d.address ?? null,
    ownerName: d.ownerName ?? null,
    ownerContact: d.ownerContact ?? null,
    notes: d.notes ?? null,
    categoryId: d.categoryId || null,
  });
  revalidatePath("/maintenance/properties");
  redirect("/maintenance/properties");
}

export async function updatePropertyAction(id: string, formData: FormData) {
  const orgId = await requirePropManage();
  const parsed = parseForm(formData);
  if (!parsed.success) return;
  const d = parsed.data;
  await updateProperty(orgId, id, {
    name: d.name,
    caretakerId: d.caretakerId || null,
    address: d.address ?? null,
    ownerName: d.ownerName ?? null,
    ownerContact: d.ownerContact ?? null,
    notes: d.notes ?? null,
    categoryId: d.categoryId || null,
  });
  revalidatePath("/maintenance/properties");
  redirect(`/maintenance/properties/${id}`);
}

export async function deletePropertyAction(formData: FormData) {
  const orgId = await requirePropManage();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteProperty(orgId, id);
  revalidatePath("/maintenance/properties");
  redirect("/maintenance/properties");
}

// ═══════════════ หมวดหมู่บ้าน ═══════════════
//
// หน้าที่จัดกลุ่มบ้านมีหลายหน้า (บอร์ดใบงาน · ปฏิทิน PM · แดชบอร์ด · ค่าใช้จ่าย)
// แก้หมวดทีเดียวต้องรีเฟรชให้ครบ ไม่งั้นชื่อหมวดจะไม่ตรงกันระหว่างหน้า
function revalidateCategoryPages() {
  revalidatePath("/maintenance/properties");
  revalidatePath("/maintenance/work-orders");
  revalidatePath("/maintenance/pm");
  revalidatePath("/maintenance/expenses");
  revalidatePath("/maintenance");
}

export async function createCategoryAction(formData: FormData) {
  const orgId = await requirePropManage();
  const name = String(formData.get("displayName") ?? "").trim().slice(0, 100);
  if (!name) return;
  await createCategory(orgId, name);
  revalidateCategoryPages();
}

export async function renameCategoryAction(formData: FormData) {
  const orgId = await requirePropManage();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("displayName") ?? "").trim().slice(0, 100);
  if (!id || !name) return;
  await renameCategory(orgId, id, name);
  revalidateCategoryPages();
}

/** ลบหมวด — บ้านในหมวดไม่หายตาม แค่กลับไปกอง "ยังไม่จัดหมวด" (FK เป็น SET NULL) */
export async function deleteCategoryAction(formData: FormData) {
  const orgId = await requirePropManage();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteCategory(orgId, id);
  revalidateCategoryPages();
}

export async function moveCategoryAction(formData: FormData) {
  const orgId = await requirePropManage();
  const id = String(formData.get("id") ?? "");
  const dir = formData.get("dir") === "up" ? "up" : "down";
  if (!id) return;
  await moveCategory(orgId, id, dir);
  revalidateCategoryPages();
}

/** ย้ายบ้านเข้าหมวด จากหน้ารายชื่อบ้านโดยตรง (ไม่ต้องเข้าหน้าแก้ไข) */
export async function setPropertyCategoryAction(formData: FormData) {
  const orgId = await requirePropManage();
  const id = String(formData.get("propertyId") ?? "");
  const categoryId = String(formData.get("categoryId") ?? "") || null;
  if (!id) return;
  await setPropertyCategory(orgId, id, categoryId);
  revalidateCategoryPages();
}
