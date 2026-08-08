"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { EXAMPLE_PERMISSIONS } from "@/modules/example/manifest";
import {
  createExampleItem,
  deleteExampleItem,
  toggleExampleItem,
} from "@/modules/example/data";

const createSchema = z.object({
  title: z.string().trim().min(1, "กรุณากรอกชื่อ").max(120),
  note: z.string().trim().max(500).optional(),
});

/** ตรวจว่า login + มีบริษัท + มีสิทธิ์จัดการ แล้วคืน orgId */
async function requireManage(): Promise<string> {
  const session = await requireOrg();
  if (!hasPermission(session, EXAMPLE_PERMISSIONS.manage)) {
    throw new Error("ไม่มีสิทธิ์จัดการรายการนี้");
  }
  return session.orgId;
}

export async function createItemAction(formData: FormData) {
  const orgId = await requireManage();
  const parsed = createSchema.safeParse({
    title: formData.get("title"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return;
  await createExampleItem(orgId, parsed.data);
  revalidatePath("/example");
}

export async function deleteItemAction(formData: FormData) {
  const orgId = await requireManage();
  const id = String(formData.get("id") ?? "");
  if (id) {
    await deleteExampleItem(orgId, id);
    revalidatePath("/example");
  }
}

export async function toggleItemAction(formData: FormData) {
  const orgId = await requireManage();
  const id = String(formData.get("id") ?? "");
  if (id) {
    await toggleExampleItem(orgId, id);
    revalidatePath("/example");
  }
}
