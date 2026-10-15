"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import {
  createAsset,
  updateAsset,
  deleteAsset,
  getAsset,
} from "@/modules/maintenance/data/assets";
import { getProperty } from "@/modules/maintenance/data/properties";
import { logActivity, type ActivityKind } from "@/modules/maintenance/data/activity";
import { putFile } from "@/modules/maintenance/lib/storage";

const schema = z.object({
  name: z.string().trim().min(1, "กรุณากรอกชื่ออุปกรณ์").max(200),
  category: z.string().trim().max(100).optional(),
  brand: z.string().trim().max(100).optional(),
  model: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(1000).optional(),
  installDate: z.string().trim().optional(),
  warrantyExpiry: z.string().trim().optional(),
});

async function requireAssetManage(): Promise<{ orgId: string; userId: string }> {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.assetManage)) {
    throw new Error("ไม่มีสิทธิ์จัดการอุปกรณ์");
  }
  return { orgId: s.orgId, userId: s.userId };
}

/** บันทึกการใช้งาน: "<ทำอะไร> "<อุปกรณ์>" บ้าน <ชื่อบ้าน>" */
async function assetLog(
  who: { orgId: string; userId: string },
  id: string | null,
  name: string,
  propertyId: string | null,
  action: ActivityKind,
  summary: string,
  detail?: Record<string, unknown>
) {
  const house = propertyId ? (await getProperty(who.orgId, propertyId))?.name : null;
  await logActivity(who.orgId, {
    userId: who.userId,
    entity: "asset",
    entityId: id,
    entityCode: name,
    action,
    summary: `${summary} "${name}"${house ? ` บ้าน ${house}` : ""}`,
    detail,
  });
}

function toDate(v?: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** รูปอุปกรณ์ (ไม่บังคับ) — คืน null เมื่อไม่ได้แนบ */
async function readImage(formData: FormData, orgId: string): Promise<string | null> {
  const f = formData.get("image");
  if (f instanceof File && f.size > 0) return putFile(`${orgId}/maintenance/assets`, f);
  return null;
}

function parseForm(formData: FormData) {
  return schema.safeParse({
    name: formData.get("name"),
    category: (formData.get("category") as string) || undefined,
    brand: (formData.get("brand") as string) || undefined,
    model: (formData.get("model") as string) || undefined,
    notes: (formData.get("notes") as string) || undefined,
    installDate: (formData.get("installDate") as string) || undefined,
    warrantyExpiry: (formData.get("warrantyExpiry") as string) || undefined,
  });
}

export async function createAssetAction(propertyId: string, formData: FormData) {
  const who = await requireAssetManage();
  const { orgId } = who;
  const parsed = parseForm(formData);
  if (!parsed.success) return;
  const d = parsed.data;
  await createAsset(orgId, {
    propertyId,
    name: d.name,
    category: d.category ?? null,
    brand: d.brand ?? null,
    model: d.model ?? null,
    notes: d.notes ?? null,
    installDate: toDate(d.installDate),
    warrantyExpiry: toDate(d.warrantyExpiry),
    imageUrl: await readImage(formData, orgId),
  });
  await assetLog(who, null, d.name, propertyId, "create", "เพิ่มอุปกรณ์", d);
  revalidatePath(`/maintenance/properties/${propertyId}`);
}

export async function updateAssetAction(id: string, formData: FormData) {
  const who = await requireAssetManage();
  const { orgId } = who;
  const parsed = parseForm(formData);
  if (!parsed.success) return;
  const d = parsed.data;
  const before = await getAsset(orgId, id);
  const imageUrl = await readImage(formData, orgId);
  await updateAsset(orgId, id, {
    name: d.name,
    category: d.category ?? null,
    brand: d.brand ?? null,
    model: d.model ?? null,
    notes: d.notes ?? null,
    installDate: toDate(d.installDate),
    warrantyExpiry: toDate(d.warrantyExpiry),
    ...(imageUrl ? { imageUrl } : {}), // ไม่แนบรูปใหม่ = คงรูปเดิม
  });
  await assetLog(who, id, d.name, before?.propertyId ?? null, "update", "แก้ไขอุปกรณ์", {
    before: before ? { name: before.name, category: before.category, brand: before.brand, model: before.model, notes: before.notes } : null,
    after: d,
    newImage: !!imageUrl,
  });
  revalidatePath(`/maintenance/assets/${id}`);
}

export async function deleteAssetAction(formData: FormData) {
  const who = await requireAssetManage();
  const { orgId } = who;
  const id = String(formData.get("id") ?? "");
  const back = String(formData.get("back") ?? "/maintenance/assets");
  if (!id) return;
  const before = await getAsset(orgId, id);
  await deleteAsset(orgId, id);
  if (before) await assetLog(who, id, before.name, before.propertyId, "delete", "ลบอุปกรณ์");
  revalidatePath("/maintenance/assets");
  redirect(back);
}
