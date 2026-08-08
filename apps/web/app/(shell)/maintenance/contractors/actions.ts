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
} from "@/modules/maintenance/data/contractors";

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

async function requireContractorManage(): Promise<string> {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.contractorManage)) {
    throw new Error("ไม่มีสิทธิ์จัดการผู้รับเหมา");
  }
  return s.orgId;
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
  const orgId = await requireContractorManage();
  const parsed = parse(formData);
  if (!parsed.success) return;
  await createContractor(orgId, toInput(parsed.data));
  revalidatePath("/maintenance/contractors");
}

export async function updateContractorAction(id: string, formData: FormData) {
  const orgId = await requireContractorManage();
  const parsed = parse(formData);
  if (!parsed.success) return;
  await updateContractor(orgId, id, toInput(parsed.data));
  revalidatePath(`/maintenance/contractors/${id}`);
}

export async function deleteContractorAction(formData: FormData) {
  const orgId = await requireContractorManage();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteContractor(orgId, id);
  revalidatePath("/maintenance/contractors");
  redirect("/maintenance/contractors");
}

export async function addHistoryAction(contractorId: string, formData: FormData) {
  const orgId = await requireContractorManage();
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
  revalidatePath(`/maintenance/contractors/${contractorId}`);
}
