"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import {
  createWorkOrder,
  getWorkOrder,
  updateWorkOrder,
  updateWorkOrderStatus,
  deleteWorkOrder,
  addWorkOrderComment,
} from "@/modules/maintenance/data/work-orders";
import {
  notifyUser,
  notifyUsers,
  managersAndCaretaker,
} from "@/modules/maintenance/data/notify";
import { getProperty } from "@/modules/maintenance/data/properties";
import { putFile, putFiles } from "@/modules/maintenance/lib/storage";
import { createUploadLink } from "@/modules/maintenance/data/external-upload";
import {
  completePmSchedule,
  completePmSchedulesByIds,
  completePmSchedulesForAsset,
} from "@/modules/maintenance/data/pm";

const createSchema = z.object({
  title: z.string().trim().min(1, "กรุณากรอกหัวข้องาน").max(200),
  propertyIds: z.array(z.string()).min(1, "เลือกอย่างน้อย 1 บ้าน"),
  assignedTo: z.string().optional(),
  ccUserIds: z.array(z.string()).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  description: z.string().trim().max(2000).optional(),
  assetId: z.string().optional(),
  pmScheduleId: z.string().optional(),
});

export async function createWorkOrderAction(formData: FormData) {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.workorderManage)) {
    throw new Error("ไม่มีสิทธิ์สร้างใบงาน");
  }
  const propertyIds = formData.getAll("propertyIds").map(String).filter(Boolean);
  const ccUserIds = formData.getAll("ccUserIds").map(String).filter(Boolean);
  const pmScheduleIds = formData.getAll("pmScheduleIds").map(String).filter(Boolean);
  const parsed = createSchema.safeParse({
    title: formData.get("title"),
    propertyIds,
    assignedTo: (formData.get("assignedTo") as string) || undefined,
    ccUserIds,
    priority: (formData.get("priority") as string) || "medium",
    description: (formData.get("description") as string) || undefined,
    assetId: (formData.get("assetId") as string) || undefined,
    pmScheduleId: (formData.get("pmScheduleId") as string) || undefined,
  });
  if (!parsed.success) return;
  const d = parsed.data;

  const assignedTo = d.assignedTo || null;
  const cc = (d.ccUserIds ?? []).filter((id) => id !== assignedTo);
  const [primary, ...additional] = d.propertyIds;

  const photoFiles = formData.getAll("photos").filter((f): f is File => f instanceof File);
  const photoUrls = await putFiles("maintenance/work-orders", photoFiles);

  const wo = await createWorkOrder(s.orgId, {
    propertyId: primary!,
    additionalPropertyIds: additional,
    title: d.title,
    description: d.description ?? null,
    priority: d.priority,
    assignedTo,
    createdBy: s.userId,
    ccUserIds: cc,
    assetId: d.assetId || null,
    pmScheduleId: d.pmScheduleId || null,
    pmScheduleIds,
    photoUrls,
    // ติ๊ก "ไม่มีค่าใช้จ่าย" ⇒ requiresExpense = false
    // ⚠ ใบงานที่เกิดจาก PM ใช้ค่าจากแผน PM แทน (ดู modules/maintenance/data/cron.ts)
    requiresExpense: formData.get("noExpense") !== "1",
  });

  // แจ้งเตือนผู้รับผิดชอบ + CC (in-app + LINE)
  const notifyTargets = new Set<string>([...(assignedTo ? [assignedTo] : []), ...cc]);
  for (const uid of notifyTargets) {
    await notifyUser(s.orgId, uid, {
      title: `📋 ได้รับมอบหมายงานใหม่: ${d.title}`,
      body: d.description ?? undefined,
      type: "work_order",
      referenceId: wo.id,
      line: `📢 งานใหม่: ${d.title}\nเข้าดูรายละเอียดในระบบ Smartboss`,
    });
  }

  revalidatePath("/maintenance/work-orders");
  redirect("/maintenance/work-orders");
}

export async function updateStatusAction(formData: FormData) {
  const s = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !status) return;

  const wo = await getWorkOrder(s.orgId, id);
  if (!wo) return;

  const canManage = hasPermission(s, MAINT_PERMS.workorderManage);
  const isOwnJob = wo.assignedTo === s.userId || wo.createdBy === s.userId;
  const canCompleteOwn =
    hasPermission(s, MAINT_PERMS.workorderComplete) && isOwnJob;
  if (!canManage && !canCompleteOwn) {
    throw new Error("ไม่มีสิทธิ์เปลี่ยนสถานะใบงานนี้");
  }

  await updateWorkOrderStatus(s.orgId, id, status);
  // ปิดงาน = เดิน PM ที่ผูกไว้ไปรอบถัดไป (batch → single → fallback ตามอุปกรณ์)
  if (status === "completed") await advanceLinkedPm(s.orgId, wo);
  await notifyStatusChanged(s.orgId, wo, status);

  revalidatePath(`/maintenance/work-orders/${id}`);
  revalidatePath("/maintenance/work-orders");
}

const STATUS_TEXT: Record<string, { emoji: string; label: string }> = {
  open: { emoji: "🆕", label: "เปิด" },
  in_progress: { emoji: "🔧", label: "กำลังดำเนินการ" },
  completed: { emoji: "✅", label: "เสร็จแล้ว" },
  cancelled: { emoji: "❌", label: "ยกเลิก" },
};

/** แจ้งผู้ดูแลบ้าน + ผู้จัดการ เมื่อสถานะใบงานเปลี่ยน (port จาก notifyWorkOrderStatusChanged) */
async function notifyStatusChanged(
  orgId: string,
  wo: { id: string; title: string; propertyId: string },
  status: string
) {
  const st = STATUS_TEXT[status] ?? { emoji: "📋", label: status };
  const property = await getProperty(orgId, wo.propertyId);
  const propertyName = property?.name ?? "-";
  await notifyUsers(orgId, await managersAndCaretaker(orgId, wo.propertyId), {
    title: `${st.emoji} ใบงานอัปเดตสถานะ: ${wo.title}`,
    body: `บ้าน: ${propertyName} • สถานะ: ${st.label}`,
    type: "work_order",
    referenceId: wo.id,
    line:
      `${st.emoji} ใบงานอัปเดตสถานะ\n` +
      `📝 ${wo.title}\n` +
      `🏠 บ้าน: ${propertyName}\n` +
      `📊 สถานะ: ${st.label}`,
  });
}

/** เดิน PM ที่ผูกกับใบงานไปรอบถัดไป — ลำดับเดียวกับของเดิม */
async function advanceLinkedPm(
  orgId: string,
  wo: { pmScheduleIds: string[]; pmScheduleId: string | null; assetId: string | null }
) {
  if (wo.pmScheduleIds.length > 0) {
    await completePmSchedulesByIds(orgId, wo.pmScheduleIds);
  } else if (wo.pmScheduleId) {
    await completePmSchedule(orgId, wo.pmScheduleId);
  } else if (wo.assetId) {
    await completePmSchedulesForAsset(orgId, wo.assetId);
  }
}

/**
 * ยืนยันงานเสร็จ: บังคับประมาณการค่าใช้จ่าย + รูปหลังแก้ไข
 * (port จาก _showCompletionDialog + _completeWithPhotos)
 */
export async function completeWorkOrderAction(formData: FormData) {
  const s = await requireOrg();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const wo = await getWorkOrder(s.orgId, id);
  if (!wo) return;

  const canManage = hasPermission(s, MAINT_PERMS.workorderManage);
  const isOwnJob = wo.assignedTo === s.userId || wo.createdBy === s.userId;
  const canCompleteOwn =
    hasPermission(s, MAINT_PERMS.workorderComplete) && isOwnJob;
  if (!canManage && !canCompleteOwn) {
    throw new Error("ไม่มีสิทธิ์ปิดใบงานนี้");
  }

  // ประมาณการค่าใช้จ่าย → completion_notes (รูปแบบข้อความเดียวกับของเดิม)
  const names = formData.getAll("itemName").map(String);
  const prices = formData.getAll("itemPrice").map(String);
  const lines = names
    .map((name, i) => ({ name: name.trim(), price: (prices[i] ?? "").trim() }))
    .filter((x) => x.name !== "")
    .map((x) => `• ${x.name}${x.price ? ` - ฿${x.price}` : ""}`);
  const notes = lines.length > 0 ? `ประมาณการค่าใช้จ่าย:\n${lines.join("\n")}` : "";

  const files = formData
    .getAll("afterPhotos")
    .filter((f): f is File => f instanceof File);
  const afterPhotoUrls = await putFiles("maintenance/work-orders/after", files);

  await updateWorkOrder(s.orgId, id, {
    ...(afterPhotoUrls.length > 0
      ? { afterPhotoUrls: [...wo.afterPhotoUrls, ...afterPhotoUrls] }
      : {}),
    ...(notes ? { completionNotes: notes } : {}),
  });
  await updateWorkOrderStatus(s.orgId, id, "completed");
  await advanceLinkedPm(s.orgId, wo);
  await notifyStatusChanged(s.orgId, wo, "completed");

  revalidatePath(`/maintenance/work-orders/${id}`);
  revalidatePath("/maintenance/work-orders");
}

export async function addCommentAction(workOrderId: string, formData: FormData) {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.workorderView)) return;
  const content = String(formData.get("content") ?? "").trim();
  const file = formData.get("image");
  const imageUrl =
    file instanceof File && file.size > 0
      ? await putFile("maintenance/comments", file)
      : null;
  if (!content && !imageUrl) return;
  // คอมเมนต์ที่มีแต่รูปเก็บ content เป็น 📷 เหมือนของเดิม (หน้าจอซ่อนข้อความนี้)
  await addWorkOrderComment(
    s.orgId,
    workOrderId,
    s.userId,
    content || "📷",
    imageUrl
  );

  // แจ้งผู้เกี่ยวข้องเมื่อมีความคิดเห็นใหม่ (ยกเว้นคนที่พิมพ์เอง)
  const wo = await getWorkOrder(s.orgId, workOrderId);
  if (wo) {
    const targets = new Set<string>([
      ...(wo.assignedTo ? [wo.assignedTo] : []),
      ...(wo.createdBy ? [wo.createdBy] : []),
      ...wo.ccUserIds,
    ]);
    targets.delete(s.userId);
    await notifyUsers(s.orgId, [...targets], {
      title: `💬 ความคิดเห็นใหม่: ${wo.title}`,
      body: content || "ส่งรูปภาพ",
      type: "work_order",
      referenceId: workOrderId,
      line: `💬 ความคิดเห็นใหม่\n📝 ${wo.title}\n${content || "📷 ส่งรูปภาพ"}`,
    });
  }

  revalidatePath(`/maintenance/work-orders/${workOrderId}`);
}

export async function updateCompletionNotesAction(
  workOrderId: string,
  formData: FormData
) {
  const s = await requireOrg();
  const wo = await getWorkOrder(s.orgId, workOrderId);
  if (!wo) return;
  const canManage = hasPermission(s, MAINT_PERMS.workorderManage);
  const isOwnJob = wo.assignedTo === s.userId || wo.createdBy === s.userId;
  if (!canManage && !isOwnJob) return;
  const notes = String(formData.get("completionNotes") ?? "").trim();
  await updateWorkOrder(s.orgId, workOrderId, { completionNotes: notes || null });
  revalidatePath(`/maintenance/work-orders/${workOrderId}`);
}

export async function generateUploadLinkAction(formData: FormData) {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.workorderManage)) {
    throw new Error("ไม่มีสิทธิ์");
  }
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await createUploadLink(s.orgId, id);
  revalidatePath(`/maintenance/work-orders/${id}`);
}

/** ลบใบงาน — Super Admin เท่านั้น (ตรงกับ isSuperAdmin ของเดิม) */
export async function deleteWorkOrderAction(formData: FormData) {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.admin)) {
    throw new Error("ไม่มีสิทธิ์ลบใบงาน");
  }
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteWorkOrder(s.orgId, id);
  revalidatePath("/maintenance/work-orders");
  redirect("/maintenance/work-orders");
}
