"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import {
  createContractor,
  updateContractor,
  deleteContractor,
  createContractorHistory,
  getContractor,
} from "@/modules/maintenance/data/contractors";
import { logActivity, type ActivityKind } from "@/modules/maintenance/data/activity";

const schema = z.object({
  name: z.string().trim().min(1, "กรอกชื่อ").max(200),
  phone: z.string().trim().max(50).optional(),
  email: z.string().trim().max(200).optional(),
  specialty: z.string().trim().max(200).optional(),
  companyName: z.string().trim().max(200).optional(),
  zone: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  price: z.string().optional(),
  rating: z.string().optional(),
  notes: z.string().trim().max(1000).optional(),
});

async function requireContractorManage(): Promise<{ orgId: string; userId: string }> {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.contractorManage)) {
    throw new Error("ไม่มีสิทธิ์จัดการผู้รับเหมา");
  }
  return { orgId: s.orgId, userId: s.userId };
}

function contractorLog(
  who: { orgId: string; userId: string },
  id: string | null,
  name: string,
  action: ActivityKind,
  summary: string,
  detail?: Record<string, unknown>
) {
  return logActivity(who.orgId, {
    userId: who.userId,
    entity: "contractor",
    entityId: id,
    entityCode: name,
    action,
    summary: `${summary} "${name}"`,
    detail,
  });
}

function parse(formData: FormData) {
  return schema.safeParse({
    name: formData.get("name"),
    phone: (formData.get("phone") as string) || undefined,
    email: (formData.get("email") as string) || undefined,
    specialty: (formData.get("specialty") as string) || undefined,
    companyName: (formData.get("companyName") as string) || undefined,
    zone: (formData.get("zone") as string) || undefined,
    category: (formData.get("category") as string) || undefined,
    price: (formData.get("price") as string) || undefined,
    rating: (formData.get("rating") as string) || undefined,
    notes: (formData.get("notes") as string) || undefined,
  });
}

function toInput(d: z.infer<typeof schema>) {
  const price = d.price ? Number(d.price) : null;
  const rating = d.rating ? Number(d.rating) : null;
  return {
    name: d.name,
    phone: d.phone ?? null,
    email: d.email ?? null,
    specialty: d.specialty ?? null,
    companyName: d.companyName ?? null,
    zone: d.zone ?? null,
    category: d.category ?? null,
    price: price != null && Number.isFinite(price) ? price : null,
    rating: rating != null && Number.isFinite(rating) ? rating : null,
    notes: d.notes ?? null,
  };
}

export async function createContractorAction(formData: FormData) {
  const who = await requireContractorManage();
  const { orgId } = who;
  const parsed = parse(formData);
  if (!parsed.success) return;
  await createContractor(orgId, toInput(parsed.data));
  await contractorLog(who, null, parsed.data.name, "create", "เพิ่ม Contact", toInput(parsed.data));
  revalidatePath("/maintenance/contractors");
}

export async function updateContractorAction(id: string, formData: FormData) {
  const who = await requireContractorManage();
  const { orgId } = who;
  const parsed = parse(formData);
  if (!parsed.success) return;
  const before = await getContractor(orgId, id);
  await updateContractor(orgId, id, toInput(parsed.data));
  await contractorLog(who, id, parsed.data.name, "update", "แก้ไข Contact", {
    before: before
      ? { name: before.name, phone: before.phone, email: before.email, specialty: before.specialty, companyName: before.companyName, zone: before.zone, category: before.category, notes: before.notes }
      : null,
    after: toInput(parsed.data),
  });
  revalidatePath(`/maintenance/contractors/${id}`);
}

export async function deleteContractorAction(formData: FormData) {
  const who = await requireContractorManage();
  const { orgId } = who;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const before = await getContractor(orgId, id);
  await deleteContractor(orgId, id);
  if (before) await contractorLog(who, id, before.name, "delete", "ลบ Contact");
  revalidatePath("/maintenance/contractors");
  redirect("/maintenance/contractors");
}

export async function addHistoryAction(contractorId: string, formData: FormData) {
  const who = await requireContractorManage();
  const { orgId } = who;
  const description = String(formData.get("description") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const dateRaw = String(formData.get("workDate") ?? "").trim();
  const ratingRaw = String(formData.get("rating") ?? "").trim();
  const amount = amountRaw ? Number(amountRaw) : null;
  const rating = ratingRaw ? Number(ratingRaw) : null;
  await createContractorHistory(orgId, {
    contractorId,
    description: description || null,
    amount: amount != null && Number.isFinite(amount) ? amount : null,
    workDate: dateRaw ? new Date(dateRaw + "T00:00:00.000Z") : null,
    rating: rating != null && Number.isFinite(rating) ? rating : null,
  });
  const c = await getContractor(orgId, contractorId);
  await contractorLog(who, contractorId, c?.name ?? "-", "create", `เพิ่มประวัติงาน${description ? ` "${description.slice(0, 60)}"` : ""}${amount ? ` ฿${amount.toLocaleString()}` : ""} ของ`, { description, amount, workDate: dateRaw || null, rating });
  revalidatePath(`/maintenance/contractors/${contractorId}`);
}
