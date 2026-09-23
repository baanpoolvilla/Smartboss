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
  updateWorkOrderComment,
  deleteWorkOrderComment,
} from "@/modules/maintenance/data/work-orders";
import {
  notifyUser,
  notifyUsers,
  propertyCaretaker,
} from "@/modules/maintenance/data/notify";
import { getProperty } from "@/modules/maintenance/data/properties";
import {
  workOrderAccess,
  canSeeWorkOrder,
} from "@/modules/maintenance/data/work-order-access";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";
import { putFile, putFiles, deleteFiles } from "@/modules/maintenance/lib/storage";
import { createUploadLink } from "@/modules/maintenance/data/external-upload";
import {
  completePmSchedule,
  completePmSchedulesByIds,
} from "@/modules/maintenance/data/pm";

/**
 * วันครบกำหนดจาก input[type=date] → สิ้นวันตามเวลาไทย (23:59:59.999+07:00)
 *
 * ไม่ใช่เที่ยงคืน UTC แบบ parseDate ของฝั่ง PM เพราะคอลัมน์นี้เป็น DateTime จริง
 * ที่ cron เอาไปเทียบ `<` ตรง ๆ เพื่อหางานเลยกำหนด (data/cron.ts) — ถ้าเก็บเป็น
 * เที่ยงคืน UTC งานจะถูกนับว่าเลยกำหนดตั้งแต่ 7 โมงเช้า *ของวันครบกำหนดเอง*
 * ทั้งที่ยังเหลือทั้งวันให้ทำ แล้วผู้รับผิดชอบโดนหักคะแนนผลงานฟรี ๆ
 * ส่วนการแสดงผลได้วันเดียวกันทั้งสองแบบ (16:59Z ยังเป็นวันเดิมในเขตเวลา UTC)
 */
function parseDueDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(`${v}T23:59:59.999+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const createSchema = z.object({
  title: z.string().trim().min(1, "กรุณากรอกหัวข้องาน").max(200),
  propertyIds: z.array(z.string()).min(1, "เลือกอย่างน้อย 1 บ้าน"),
  assignedTo: z.string().optional(),
  ccUserIds: z.array(z.string()).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  dueDate: z.string().optional(),
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
    dueDate: (formData.get("dueDate") as string) || undefined,
    description: (formData.get("description") as string) || undefined,
    assetId: (formData.get("assetId") as string) || undefined,
    pmScheduleId: (formData.get("pmScheduleId") as string) || undefined,
  });
  if (!parsed.success) return;
  const d = parsed.data;

  const assignedTo = d.assignedTo || null;
  const cc = (d.ccUserIds ?? []).filter((id) => id !== assignedTo);
  const [primary, ...additional] = d.propertyIds;

  const dueDate = parseDueDate(d.dueDate);

  const photoFiles = formData.getAll("photos").filter((f): f is File => f instanceof File);
  const photoUrls = await putFiles(`${s.orgId}/maintenance/work-orders`, photoFiles);

  const wo = await createWorkOrder(s.orgId, {
    propertyId: primary!,
    additionalPropertyIds: additional,
    title: d.title,
    description: d.description ?? null,
    priority: d.priority,
    dueDate,
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
      // วันครบกำหนดอยู่ในแจ้งเตือนด้วย — คนรับงานเห็นแค่ข้อความที่เด้งเข้า LINE
      // ก่อนจะเปิดระบบ ถ้าไม่บอกตรงนี้ก็ไม่มีทางรู้ว่ามีเวลาถึงเมื่อไหร่
      body:
        [dueDate ? `ครบกำหนด ${fmtThaiDate(dueDate)}` : null, d.description ?? null]
          .filter(Boolean)
          .join("\n") || undefined,
      type: "work_order",
      referenceId: wo.id,
      line: `📢 งานใหม่: ${d.title}\n${dueDate ? `📅 ครบกำหนด ${fmtThaiDate(dueDate)}\n` : ""}เข้าดูรายละเอียดในระบบ Smartboss`,
    });
  }

  revalidatePath("/maintenance/work-orders");

  // ติ๊ก "เปิด PR ต่อเลย" ⇒ ไปต่อหน้าเปิด PR ที่ผูกใบงานนี้ให้เลย ไม่ต้องย้อน
  // เข้าใบงานไปกดเอง — เช็คสิทธิ์ซ้ำที่นี่ เพราะ checkbox ถูกยิงตรงมาได้
  if (
    formData.get("openPr") === "1" &&
    hasPermission(s, MAINT_PERMS.poCreate)
  ) {
    redirect(`/maintenance/purchase-orders/new?workOrderId=${wo.id}`);
  }
  redirect("/maintenance/work-orders");
}

export async function updateStatusAction(formData: FormData) {
  const s = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !status) return;

  const wo = await getWorkOrder(s.orgId, id);
  if (!wo) return;

  // เห็นใบนี้ไม่ได้ ก็แตะไม่ได้ — สิทธิ์ workorder.manage บอกแค่ว่า "จัดการ
  // ใบงานเป็น" ไม่ได้แปลว่าเป็นเจ้าของทุกใบในบริษัท (ดู data/work-order-access.ts)
  if (!canSeeWorkOrder(await workOrderAccess(s), wo)) {
    throw new Error("ไม่มีสิทธิ์เปลี่ยนสถานะใบงานนี้");
  }
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
  await notifyStatusChanged(s.orgId, wo, status, s.userId);

  revalidatePath(`/maintenance/work-orders/${id}`);
  revalidatePath("/maintenance/work-orders");
}

const STATUS_TEXT: Record<string, { emoji: string; label: string }> = {
  open: { emoji: "🆕", label: "เปิด" },
  in_progress: { emoji: "🔧", label: "กำลังดำเนินการ" },
  completed: { emoji: "✅", label: "เสร็จแล้ว" },
  cancelled: { emoji: "❌", label: "ยกเลิก" },
};

/** แจ้งผู้เกี่ยวข้องกับใบงานนี้จริง (ผู้รับมอบหมาย/ผู้สร้าง/cc/ผู้ดูแลบ้าน) เมื่อ
 * สถานะเปลี่ยน — ไม่ยิงหาผู้จัดการทั้งบริษัทเหมือนเดิมอีกต่อไป (ดู notify.ts's
 * propertyCaretaker) ยกเว้นคนที่เพิ่งกดเปลี่ยนสถานะเอง ไม่ต้องแจ้งตัวเอง */
async function notifyStatusChanged(
  orgId: string,
  wo: { id: string; title: string; propertyId: string; assignedTo: string | null; createdBy: string | null; ccUserIds: string[] },
  status: string,
  actorId: string
) {
  const st = STATUS_TEXT[status] ?? { emoji: "📋", label: status };
  const property = await getProperty(orgId, wo.propertyId);
  const propertyName = property?.name ?? "-";
  const targets = new Set<string>([
    ...(wo.assignedTo ? [wo.assignedTo] : []),
    ...(wo.createdBy ? [wo.createdBy] : []),
    ...wo.ccUserIds,
    ...(await propertyCaretaker(orgId, wo.propertyId)),
  ]);
  targets.delete(actorId);
  await notifyUsers(orgId, [...targets], {
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

/**
 * เดิน PM ที่ "ผูกกับใบงานนี้จริง ๆ" ไปรอบถัดไป
 *
 * ⚠ เดิมมี fallback ชั้นสุดท้าย: ใบงานที่ไม่ได้ผูก PM เลยแต่ระบุอุปกรณ์ไว้
 * จะไปปิดรอบ **ทุกแผน PM ของอุปกรณ์นั้น** ซึ่งเดาผิดมากกว่าถูก — งานซ่อม
 * ธรรมดา (แอร์ไม่เย็น เปลี่ยนอะไหล่) ที่บังเอิญเลือกอุปกรณ์ไว้ พอปิดงานปุ๊บ
 * PM ล้างแอร์ตามรอบก็ถูกนับว่าทำเสร็จไปด้วยทั้งที่ไม่มีใครล้าง แล้ววันกำหนด
 * ถูกเลื่อนออกไปอีกรอบเต็ม ๆ โดยไม่มีร่องรอยว่าใครเลื่อน
 *
 * ใบงานที่มาจาก PM ทุกทางมี id ติดมาเสมออยู่แล้ว (cron ใส่ pmScheduleId,
 * ปฏิทินส่งมาทาง query string, ใบรวมหลาย PM ใส่ pmScheduleIds) ⇒ ไม่มีเคสที่
 * ต้องเดาจากอุปกรณ์ · ปิดรอบ PM เองยังทำได้ที่หน้า /maintenance/pm ตามเดิม
 */
async function advanceLinkedPm(
  orgId: string,
  wo: { pmScheduleIds: string[]; pmScheduleId: string | null }
) {
  if (wo.pmScheduleIds.length > 0) {
    await completePmSchedulesByIds(orgId, wo.pmScheduleIds);
  } else if (wo.pmScheduleId) {
    await completePmSchedule(orgId, wo.pmScheduleId);
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

  if (!canSeeWorkOrder(await workOrderAccess(s), wo)) {
    throw new Error("ไม่มีสิทธิ์ปิดใบงานนี้");
  }
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
  const afterPhotoUrls = await putFiles(`${s.orgId}/maintenance/work-orders/after`, files);

  await updateWorkOrder(s.orgId, id, {
    ...(afterPhotoUrls.length > 0
      ? { afterPhotoUrls: [...wo.afterPhotoUrls, ...afterPhotoUrls] }
      : {}),
    ...(notes ? { completionNotes: notes } : {}),
  });
  await updateWorkOrderStatus(s.orgId, id, "completed");
  await advanceLinkedPm(s.orgId, wo);
  await notifyStatusChanged(s.orgId, wo, "completed", s.userId);

  revalidatePath(`/maintenance/work-orders/${id}`);
  revalidatePath("/maintenance/work-orders");
}

export async function addCommentAction(workOrderId: string, formData: FormData) {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.workorderView)) return;
  // อ่านใบงาน (และเช็คว่าเห็นใบนี้ได้จริง) **ก่อน** เขียนคอมเมนต์ — ของเดิม
  // เขียนก่อนแล้วค่อยโหลดใบงานเพื่อส่งแจ้งเตือน ⇒ ใครก็ตามที่รู้ id ยิงคอมเมนต์
  // ใส่ใบงานที่ตัวเองเปิดดูไม่ได้ได้เลย
  const wo = await getWorkOrder(s.orgId, workOrderId);
  if (!wo) return;
  if (!canSeeWorkOrder(await workOrderAccess(s), wo)) return;
  const content = String(formData.get("content") ?? "").trim();
  const file = formData.get("image");
  const imageUrl =
    file instanceof File && file.size > 0
      ? await putFile(`${s.orgId}/maintenance/comments`, file)
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
  {
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

/** แก้ข้อความคอมเมนต์ของตัวเอง (ดู updateWorkOrderComment ว่าทำไมเฉพาะเจ้าของ) */
export async function editCommentAction(
  workOrderId: string,
  formData: FormData
) {
  const s = await requireOrg();
  const commentId = String(formData.get("commentId") ?? "");
  const content = String(formData.get("content") ?? "").trim();
  if (!commentId || !content) return;

  const wo = await getWorkOrder(s.orgId, workOrderId);
  if (!wo || !canSeeWorkOrder(await workOrderAccess(s), wo)) return;

  await updateWorkOrderComment(s.orgId, commentId, s.userId, content);
  revalidatePath(`/maintenance/work-orders/${workOrderId}`);
}

/** ลบคอมเมนต์ — เจ้าของ หรือคนที่จัดการใบงานได้ · รูปที่แนบถูกลบจาก storage ด้วย */
export async function deleteCommentAction(
  workOrderId: string,
  formData: FormData
) {
  const s = await requireOrg();
  const commentId = String(formData.get("commentId") ?? "");
  if (!commentId) return;

  const wo = await getWorkOrder(s.orgId, workOrderId);
  if (!wo || !canSeeWorkOrder(await workOrderAccess(s), wo)) return;

  const images = await deleteWorkOrderComment(
    s.orgId,
    commentId,
    s.userId,
    hasPermission(s, MAINT_PERMS.workorderManage)
  );
  if (images.length > 0) await deleteFiles(images);

  revalidatePath(`/maintenance/work-orders/${workOrderId}`);
}

export async function updateCompletionNotesAction(
  workOrderId: string,
  formData: FormData
) {
  const s = await requireOrg();
  const wo = await getWorkOrder(s.orgId, workOrderId);
  if (!wo) return;
  if (!canSeeWorkOrder(await workOrderAccess(s), wo)) return;
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
  const wo = await getWorkOrder(s.orgId, id);
  if (!wo || !canSeeWorkOrder(await workOrderAccess(s), wo)) {
    throw new Error("ไม่มีสิทธิ์");
  }
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
