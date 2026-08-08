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
} from "@/modules/maintenance/data/properties";
import { upsertCategory } from "@/modules/maintenance/data/categories";

const schema = z.object({
  name: z.string().trim().min(1, "กรุณากรอกชื่อบ้าน").max(200),
  caretakerId: z.string().trim().optional(),
  address: z.string().trim().max(500).optional(),
  ownerName: z.string().trim().max(200).optional(),
  ownerContact: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
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

export async function upsertCategoryAction(formData: FormData) {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.propertyManage)) return;
  const prefix = String(formData.get("prefix") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!prefix || !displayName) return;
  await upsertCategory(s.orgId, prefix, displayName);
  revalidatePath("/maintenance/properties");
}
