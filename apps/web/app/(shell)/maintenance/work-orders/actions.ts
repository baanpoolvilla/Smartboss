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
  removeWorkOrderCommentLogged,
  moveWorkOrderProperties,
} from "@/modules/maintenance/data/work-orders";
import {
  notifyUser,
  notifyUsers,
  notifyActorName,
  propertyCaretaker,
  deleteNotificationsByReference,
  resolveActionNotifications,
} from "@/modules/maintenance/data/notify";
import { getProperty } from "@/modules/maintenance/data/properties";
import { getAsset } from "@/modules/maintenance/data/assets";
import { userNameMap } from "@/modules/maintenance/data/users";
import { mentionedIn, workOrderMentionPeople } from "@/modules/maintenance/data/wo-mentions";
import { WO_MENTION_MARK } from "@/modules/notifications/prefs";
import { logActivity, type ActivityKind } from "@/modules/maintenance/data/activity";

/** บันทึกการใช้งาน (เมนู Log การใช้งาน) ของใบงานนี้ — ไม่ throw */
function woLog(
  s: { orgId: string; userId: string },
  wo: { id: string; code: string | null; title: string },
  action: ActivityKind,
  summary: string,
  detail?: Record<string, unknown>
) {
  return logActivity(s.orgId, {
    userId: s.userId,
    entity: "work_order",
    entityId: wo.id,
    entityCode: wo.code,
    action,
    summary: `${summary} ${wo.code ?? ""} "${wo.title}"`.replace(/\s+/g, " ").trim(),
    detail,
  });
}

const clip = (t: string, n = 120) => (t.length > n ? `${t.slice(0, n)}…` : t);
import {
  workOrderAccess,
  canSeeWorkOrder,
} from "@/modules/maintenance/data/work-order-access";
import { fmtThaiDate, fmtThaiDateTime } from "@/modules/maintenance/lib/format";
import { putFiles, deleteFiles } from "@/modules/maintenance/lib/storage";
import { isPastDay } from "@/modules/maintenance/lib/no-past-date";
import { createUploadLink } from "@/modules/maintenance/data/external-upload";
import { createExpensesForProperties, listExpenses } from "@/modules/maintenance/data/expenses";
import {
  closeAutoWorkOrdersOfPm,
  completePmSchedule,
  completePmSchedulesByIds,
  skipPmSchedule,
  skipPmSchedulesByIds,
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
/** รูปต่อความคิดเห็นสูงสุด (ตรงกับ CommentComposer) */
const MAX_COMMENT_IMAGES = 10;

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

  if (d.dueDate && isPastDay(d.dueDate)) {
    throw new Error("วันครบกำหนดย้อนหลังไม่ได้ — ตั้งเป็นวันนี้หรือหลังจากนี้");
  }
  const dueDate = parseDueDate(d.dueDate);

  const photoFiles = formData.getAll("photos").filter((f): f is File => f instanceof File);
  const photoUrls = await putFiles(`${s.orgId}/maintenance/work-orders`, photoFiles);

  const { workOrder: wo, duplicate } = await createWorkOrder(s.orgId, {
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

  // กดบันทึกซ้ำ / PM รอบนี้มีใบงานเปิดอยู่แล้ว ⇒ ไม่สร้างใหม่ พาไปใบที่มีอยู่
  // รูปที่เพิ่งอัปโหลดมากับคำขอซ้ำนี้ไม่มีใบไหนใช้ — ลบทิ้ง ไม่ให้ค้างใน storage
  if (duplicate) {
    if (photoUrls.length > 0) await deleteFiles(photoUrls).catch(() => 0);
    redirect(`/maintenance/work-orders/${wo.id}`);
  }

  // เปิดใบงานให้ PM ที่ระบบเปิดใบอัตโนมัติไว้แล้ว (หน้าปฏิทินซ่อนปุ่มนี้ แต่หน้าที่เปิดค้าง
  // ไว้ก่อน cron สร้างใบตอนเช้ายังกดได้) ⇒ ใบที่คนเปิดเองแทนใบอัตโนมัติ ไม่ให้ซ้อนกันสองใบ
  await closeAutoWorkOrdersOfPm(
    s.orgId,
    linkedPmIds({ pmScheduleId: d.pmScheduleId || null, pmScheduleIds }),
    "replaced",
    wo.id,
  );

  await woLog(s, wo, "create", "สร้างใบงาน", { propertyIds: d.propertyIds, assignedTo, cc, priority: d.priority, photos: photoUrls.length });

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

  // changed = คำขอนี้เป็นคนเปลี่ยนสถานะจริง — กดซ้ำ/กดพร้อมกันได้ false (ดู updateWorkOrderStatus)
  const changed = await updateWorkOrderStatus(s.orgId, id, status);
  // ปิดงาน = เดิน PM ที่ผูกไว้ไปรอบถัดไป (batch → single → fallback ตามอุปกรณ์)
  // ใบที่ปิดไปแล้วถูกกดปิดซ้ำ ต้องไม่เดิน PM ซ้ำ ไม่งั้นรอบกระโดดข้ามไปอีกช่วง
  //
  // ⚠ completedAt ติดใบงานไว้ตั้งแต่ปิดครั้งแรก (เปิดกลับไม่ล้าง) ⇒ ใบที่เคยปิดแล้ว = รอบ PM
  // ของมันถูกเดินไปแล้ว: เปิดกลับมาแก้แล้วปิดอีก ห้ามเดินซ้ำ (รอบกระโดดข้ามหนึ่งช่วง)
  // และเปลี่ยนเป็น "ยกเลิก" ห้ามข้ามรอบซ้ำ (รอบถัดไปที่ยังไม่ได้ทำจะหายไปเฉย ๆ)
  const pmAlreadyAdvanced = wo.completedAt !== null;
  if (changed && status === "completed" && !pmAlreadyAdvanced) await advanceLinkedPm(s.orgId, wo);
  // ยกเลิกใบงานจาก PM = ข้ามรอบนั้น ไม่งั้น cron สร้างใบเดิมขึ้นมาใหม่ทุกเช้า (ดู skipPmSchedule)
  if (changed && status === "cancelled" && !pmAlreadyAdvanced) await skipLinkedPm(s.orgId, wo);
  if (changed) await notifyStatusChanged(s.orgId, wo, status, s.userId);
  if (changed) {
    const from = STATUS_TEXT[wo.status]?.label ?? wo.status;
    const to = STATUS_TEXT[status]?.label ?? status;
    await woLog(s, wo, "status", `เปลี่ยนสถานะ ${from} → ${to}`, { from: wo.status, to: status });
  }

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
  // ปิดงาน/ยกเลิกแล้ว ⇒ "ได้รับมอบหมาย" / "ขอเลื่อน…รออนุมัติ" ของใบนี้ไม่มีอะไรให้ทำแล้ว ไม่ต้องค้างที่ใคร
  if (status === "completed" || status === "cancelled") {
    await resolveActionNotifications(wo.id, "work_order", ["ได้รับมอบหมายงานใหม่", "ขอเลื่อนกำหนดส่งใบงาน รออนุมัติ"]);
  }
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
  wo: { id: string; pmScheduleIds: string[]; pmScheduleId: string | null }
) {
  if (wo.pmScheduleIds.length > 0) {
    await completePmSchedulesByIds(orgId, wo.pmScheduleIds);
  } else if (wo.pmScheduleId) {
    await completePmSchedule(orgId, wo.pmScheduleId);
  }
  // ใบอัตโนมัติอีกใบของ PM เดียวกันที่ยังเปิดค้าง (ใบซ้อน) = รอบเดียวกันที่เพิ่งทำเสร็จ
  // ถ้าปล่อยไว้ มันโผล่เหมือนรอบใหม่ทั้งที่ยังไม่ถึงรอบ แล้วพอปิด PM ก็เดินซ้ำอีกช่วง
  await closeAutoWorkOrdersOfPm(orgId, linkedPmIds(wo), "done", wo.id);
}

function linkedPmIds(wo: { pmScheduleIds: string[]; pmScheduleId: string | null }): string[] {
  return [...new Set([...(wo.pmScheduleId ? [wo.pmScheduleId] : []), ...wo.pmScheduleIds])];
}

/** ใบงานจาก PM ถูกยกเลิก/ลบ → ข้ามรอบ PM ที่ผูกไว้ (ไม่นับว่าทำ) — ดู skipPmSchedule */
async function skipLinkedPm(
  orgId: string,
  wo: { pmScheduleIds: string[]; pmScheduleId: string | null }
) {
  if (wo.pmScheduleIds.length > 0) {
    await skipPmSchedulesByIds(orgId, wo.pmScheduleIds);
  } else if (wo.pmScheduleId) {
    await skipPmSchedule(orgId, wo.pmScheduleId);
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
  const changed = await updateWorkOrderStatus(s.orgId, id, "completed");
  if (changed) {
    // เคยปิดแล้วถูกเปิดกลับ = รอบ PM เดินไปแล้วตอนปิดครั้งแรก (ดู updateStatusAction)
    if (wo.completedAt === null) await advanceLinkedPm(s.orgId, wo);
    await notifyStatusChanged(s.orgId, wo, "completed", s.userId);
  }

  const recorded = await recordEstimateAsExpense(
    s.orgId,
    wo,
    names.map((name, i) => ({ name: name.trim(), price: (prices[i] ?? "").trim() })),
    s.userId
  );
  await woLog(
    s,
    wo,
    "status",
    `ยืนยันงานเสร็จ${afterPhotoUrls.length > 0 ? ` (รูปหลังแก้ไข ${afterPhotoUrls.length} รูป)` : ""}${recorded ? " + ลงค่าใช้จ่ายจากประมาณการ" : ""}`,
    { notes: notes || null, afterPhotos: afterPhotoUrls.length, expenseRecorded: recorded }
  );

  revalidatePath(`/maintenance/work-orders/${id}`);
  revalidatePath("/maintenance/work-orders");
  if (recorded) revalidatePath("/maintenance/expenses");
}

/** "1,500" / "฿ 1,500.50" → 1500.5 · ว่าง/อ่านไม่ได้ = NaN (เหมือน parseAmount ของหน้าค่าใช้จ่าย) */
function parseBaht(raw: string): number {
  const clean = raw.replace(/[\s,฿]/g, "");
  return clean === "" ? NaN : Number(clean);
}

/**
 * ประมาณการค่าใช้จ่ายตอนปิดงาน → รายการค่าใช้จ่ายจริงของใบงานทันที
 *
 * เดิมยอดที่ช่างกรอกตอนปิดงานเป็นแค่ข้อความใน completion_notes ต้องมีคนไปลงค่าใช้จ่ายซ้ำอีกรอบ
 * ที่หน้าค่าใช้จ่าย — แทบไม่มีใครทำ ใบงานค้าง "ยังไม่บันทึกค่าใช้จ่าย" เป็นหลักร้อยใบ ทั้งที่ช่าง
 * "ลงบิลไปแล้ว" (ยอดอยู่ในหมายเหตุจบงาน) ⇒ ("ยอดประมาณการที่ช่างกรอกตอนปิดงาน ให้กลายเป็นรายการ
 * ค่าใช้จ่ายจริงทันที ใบจะไม่ค้างอีก") ผู้จัดการแก้/ลบทีหลังได้ที่หน้าค่าใช้จ่ายถ้ายอดจริงต่าง
 *
 *   มีราคา > 0       → 1 รายการค่าใช้จ่ายต่อบรรทัด (ชื่อบรรทัด = คำอธิบาย)
 *   ใส่ 0 ทุกบรรทัด  → "ไม่มีค่าใช้จ่าย" 1 รายการ (ช่างยืนยันเองว่าไม่มี)
 *   ไม่ใส่ราคาเลย    → ไม่สร้าง — ยังค้างให้ผู้จัดการลงยอดจริงเหมือนเดิม
 *
 * ข้ามถ้าใบนี้ไม่ต้องกรอกค่าใช้จ่าย หรือมีค่าใช้จ่ายผูกอยู่แล้ว (เช่นซื้อของผ่าน PR/PO ของใบนี้ —
 * ยอดประมาณการมักรวมของชิ้นเดียวกัน ลงซ้ำแล้วต้นทุนเบิ้ล) · ใบหลายบ้าน = ทุกบ้านยอดเต็ม เหมือนฟอร์ม
 * ค่าใช้จ่าย (createExpensesForProperties) · ใบจาก PM ผูก PM ด้วยให้ต้นทุน PM ครบ
 */
async function recordEstimateAsExpense(
  orgId: string,
  wo: NonNullable<Awaited<ReturnType<typeof getWorkOrder>>>,
  items: { name: string; price: string }[],
  userId: string
): Promise<boolean> {
  if (!wo.requiresExpense) return false;
  const priced = items
    .filter((x) => x.name !== "" && x.price !== "")
    .map((x) => ({ name: x.name, amount: parseBaht(x.price) }))
    .filter((x) => Number.isFinite(x.amount) && x.amount >= 0);
  if (priced.length === 0) return false;
  if ((await listExpenses(orgId, { workOrderId: wo.id })).length > 0) return false;

  const pmScheduleId = wo.pmScheduleId ?? wo.pmScheduleIds[0] ?? null;
  const base = {
    workOrderId: wo.id,
    pmScheduleId,
    costType: pmScheduleId ? "pm" : "work_order",
    paidBy: "company",
    category: "other",
    createdBy: userId,
  };
  const propertyIds = [wo.propertyId, ...wo.additionalPropertyIds];
  const paid = priced.filter((x) => x.amount > 0);
  if (paid.length === 0) {
    await createExpensesForProperties(orgId, propertyIds, {
      ...base,
      amount: 0,
      description: "ไม่มีค่าใช้จ่าย (ช่างระบุตอนปิดงาน)",
      isNoExpense: true,
    });
    return true;
  }
  for (const x of paid) {
    await createExpensesForProperties(orgId, propertyIds, {
      ...base,
      amount: x.amount,
      description: `${x.name} (จากประมาณการตอนปิดงาน)`,
    });
  }
  return true;
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
  // หลายรูปต่อความคิดเห็น ("images") — "image" = ฟอร์มรุ่นเก่าที่ยังเปิดค้างอยู่ (รูปเดียว)
  const files = [...formData.getAll("images"), ...formData.getAll("image")]
    .filter((f): f is File => f instanceof File && f.size > 0)
    .slice(0, MAX_COMMENT_IMAGES);
  const imageUrls = files.length > 0 ? await putFiles(`${s.orgId}/maintenance/comments`, files) : [];
  if (!content && imageUrls.length === 0) return;
  // คอมเมนต์ที่มีแต่รูปเก็บ content เป็น 📷 เหมือนของเดิม (หน้าจอซ่อนข้อความนี้)
  await addWorkOrderComment(
    s.orgId,
    workOrderId,
    s.userId,
    content || "📷",
    null,
    { imageUrls }
  );
  const photoText = imageUrls.length > 1 ? `ส่งรูปภาพ ${imageUrls.length} รูป` : "ส่งรูปภาพ";
  await woLog(
    s,
    wo,
    "comment",
    `แสดงความคิดเห็น${content ? ` "${clip(content, 60)}"` : ""}${imageUrls.length > 0 ? ` (รูป ${imageUrls.length} รูป)` : ""} ใน`,
    { content, images: imageUrls.length }
  );

  // แจ้งผู้เกี่ยวข้องเมื่อมีความคิดเห็นใหม่ (ยกเว้นคนที่พิมพ์เอง)
  {
    const targets = new Set<string>([
      ...(wo.assignedTo ? [wo.assignedTo] : []),
      ...(wo.createdBy ? [wo.createdBy] : []),
      ...wo.ccUserIds,
    ]);
    targets.delete(s.userId);
    // คนที่ถูก @ (คนในใบงาน + CEO) ได้แจ้งเตือน "แท็กคุณในใบงาน" แยก แม้ไม่ได้อยู่ในใบงาน — ไม่ได้แถวคอมเมนต์ธรรมดาซ้ำ
    const mentioned = content
      ? mentionedIn(content, await workOrderMentionPeople(s.orgId, wo)).filter((id) => id !== s.userId)
      : [];
    if (mentioned.length > 0) {
      const actor = (await notifyActorName(s.userId)) ?? "มีคน";
      await notifyUsers(s.orgId, mentioned, {
        title: `📣 ${actor} ${WO_MENTION_MARK}: ${wo.title}`,
        body: content,
        type: "work_order",
        referenceId: workOrderId,
        line: `📣 ${actor} ${WO_MENTION_MARK}\n📝 ${wo.title}\n${content}`,
      });
      for (const id of mentioned) targets.delete(id);
    }
    await notifyUsers(s.orgId, [...targets], {
      title: `💬 ความคิดเห็นใหม่: ${wo.title}`,
      body: content || photoText,
      type: "work_order",
      referenceId: workOrderId,
      line: `💬 ความคิดเห็นใหม่\n📝 ${wo.title}\n${content || `📷 ${photoText}`}`,
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

  if (await updateWorkOrderComment(s.orgId, commentId, s.userId, content)) {
    await woLog(s, wo, "comment", `แก้ความคิดเห็นเป็น "${clip(content, 60)}" ใน`, { commentId, content });
  }
  revalidatePath(`/maintenance/work-orders/${workOrderId}`);
}

/**
 * ลบคอมเมนต์ทั้งอัน หรือรูปเดียวในคอมเมนต์ (`imageUrl` ในฟอร์ม) — เจ้าของ หรือคนที่จัดการใบงานได้
 * ทุกการลบมีบันทึก (แถว log ในความคิดเห็น: ใครลบ ของใคร เมื่อไหร่) · รูปที่ลบเก็บไว้ ไม่ลบจาก storage
 * ให้คนจัดการใบงานเปิดดูย้อนหลังได้จากบันทึกนั้น
 */
export async function deleteCommentAction(
  workOrderId: string,
  formData: FormData
) {
  const s = await requireOrg();
  const commentId = String(formData.get("commentId") ?? "");
  const imageUrl = String(formData.get("imageUrl") ?? "") || undefined;
  if (!commentId) return;

  const wo = await getWorkOrder(s.orgId, workOrderId);
  if (!wo || !canSeeWorkOrder(await workOrderAccess(s), wo)) return;

  let logLine = "";
  const removed = await removeWorkOrderCommentLogged(
    s.orgId,
    commentId,
    s.userId,
    hasPermission(s, MAINT_PERMS.workorderManage),
    async (row, removed, whole) => {
      const author = row.userId ? ((await userNameMap(s.orgId, [row.userId]))[row.userId] ?? "ผู้ใช้") : "ผู้ใช้";
      const of = `ของ ${author} (${fmtThaiDateTime(row.createdAt)})`;
      if (imageUrl && !whole) return (logLine = `ลบรูป 1 รูป จากความคิดเห็น${of}`);
      const text = row.content === "📷" ? "" : `: "${row.content.length > 80 ? `${row.content.slice(0, 80)}…` : row.content}"`;
      const pics = removed.length > 0 ? ` พร้อมรูป ${removed.length} รูป` : "";
      return (logLine = `ลบความคิดเห็น${of}${text}${pics}`);
    },
    imageUrl
  );
  if (removed) await woLog(s, wo, "delete", `${logLine} ใน`, { commentId, imageUrl: imageUrl ?? null });

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
  await woLog(s, wo, "update", "แก้หมายเหตุจบงาน", { from: wo.completionNotes, to: notes || null });
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
  await woLog(s, wo, "other", "สร้างลิงก์ให้ช่างภายนอกส่งรูป");
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
  // ลบใบงานที่ยังเปิดอยู่จาก PM = ข้ามรอบนั้นด้วย (เหตุผลเดียวกับยกเลิก)
  const wo = await getWorkOrder(s.orgId, id);
  if (wo && (wo.status === "open" || wo.status === "in_progress") && wo.completedAt === null) await skipLinkedPm(s.orgId, wo);
  await deleteWorkOrder(s.orgId, id);
  if (wo) await woLog(s, wo, "delete", "ลบใบงาน", { status: wo.status, propertyId: wo.propertyId });
  // เก็บกวาดแจ้งเตือนของใบงานนี้ด้วย ไม่งั้นกระดิ่งค้างชี้ไปใบงานที่ไม่มีแล้ว
  // (ดู deleteNotificationsByReference's doc — บั๊กคลาสเดียวกับที่ report_task
  // เจอกับ removeTaskNotifications)
  await deleteNotificationsByReference(id, "work_order");
  revalidatePath("/maintenance/work-orders");
  redirect("/maintenance/work-orders");
}

/**
 * แก้บ้านของใบงาน (เลือกบ้านผิดตอนเปิดใบ) — ไม่ต้องสร้างใบใหม่
 * ใครแก้ได้: สิทธิ์จัดการใบงาน หรือคนเปิดใบนี้ · ไม่ให้แก้เมื่อ
 *   - ใบมาจากแผน PM (บ้านผูกกับแผน แก้ที่ใบจะหลุดจากแผน)
 *   - มีค่าใช้จ่ายลงไว้แล้ว (ค่าใช้จ่ายแยกรายบ้าน ผูกบ้านเดิมไปแล้ว)
 * PR/PO, คืนของ, ประวัติผู้รับเหมาของใบนี้ย้ายตาม (moveWorkOrderProperties) · อุปกรณ์ที่ผูกไว้ไม่อยู่ในบ้านใหม่ = เอาออก · บันทึกเป็นความคิดเห็นว่าเปลี่ยนจากบ้านไหนเป็นบ้านไหน
 */
export async function updateWorkOrderPropertiesAction(
  workOrderId: string,
  formData: FormData
): Promise<{ error?: string }> {
  const s = await requireOrg();
  const wo = await getWorkOrder(s.orgId, workOrderId);
  if (!wo || !canSeeWorkOrder(await workOrderAccess(s), wo)) return { error: "ไม่พบใบงาน" };
  if (!hasPermission(s, MAINT_PERMS.workorderManage) && wo.createdBy !== s.userId) {
    return { error: "ไม่มีสิทธิ์แก้บ้านของใบงานนี้" };
  }
  if (wo.autoCreated || wo.pmScheduleId || wo.pmScheduleIds.length > 0) {
    return { error: "ใบงานจากแผน PM แก้บ้านไม่ได้ — แก้ที่แผน PM แทน" };
  }
  if ((await listExpenses(s.orgId, { workOrderId })).length > 0) {
    return { error: "ใบงานนี้ลงค่าใช้จ่ายแล้ว — ลบค่าใช้จ่ายก่อนจึงจะแก้บ้านได้" };
  }
  const ids = [...new Set(formData.getAll("propertyIds").map(String).filter(Boolean))];
  if (ids.length === 0) return { error: "เลือกอย่างน้อย 1 บ้าน" };
  const props = await Promise.all(ids.map((id) => getProperty(s.orgId, id)));
  if (props.some((p) => !p)) return { error: "ไม่พบบ้านที่เลือก" };

  const before = [wo.propertyId, ...wo.additionalPropertyIds];
  if (before.length === ids.length && before.every((id, i) => id === ids[i])) return {};
  let assetId = wo.assetId;
  if (assetId) {
    const asset = await getAsset(s.orgId, assetId);
    if (!asset || !ids.includes(asset.propertyId)) assetId = null;
  }
  await moveWorkOrderProperties(s.orgId, workOrderId, ids, assetId);

  const nameOf = async (id: string) => (await getProperty(s.orgId, id))?.name ?? "-";
  const fromNames = (await Promise.all(before.map(nameOf))).join(", ");
  const toNames = props.map((p) => p!.name).join(", ");
  await addWorkOrderComment(s.orgId, workOrderId, s.userId, `เปลี่ยนบ้าน: ${fromNames} → ${toNames}`, null, { kind: "log" });
  await woLog(s, wo, "update", `เปลี่ยนบ้าน ${fromNames} → ${toNames} ของ`, { from: before, to: ids });

  revalidatePath(`/maintenance/work-orders/${workOrderId}`);
  revalidatePath("/maintenance/work-orders");
  revalidatePath("/maintenance/purchase-orders");
  return {};
}
