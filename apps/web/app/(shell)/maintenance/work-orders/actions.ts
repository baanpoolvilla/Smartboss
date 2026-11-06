"use server";

import { roundDockRefId } from "@/modules/maintenance/lib/pm-rounds";
import { createHash, randomUUID } from "node:crypto";
import { checklistAllowsClose, checklistFromTemplate, itemsOf, readChecklist, readChecklistTemplate, remainingCount } from "@/modules/maintenance/lib/work-order-checklist";
import { z } from "zod";
import { prisma } from "@smartboss/database";
import type { Prisma } from "@smartboss/database";
import { loadExpenseTracking } from "@/modules/maintenance/data/expense-tracking";
import { buildBoardRows } from "@/modules/maintenance/data/work-order-board-rows";
import { listWorkOrders, workOrderIdsWithExpenses } from "@/modules/maintenance/data/work-orders";
import type { BoardOrder } from "@/modules/maintenance/components/work-order-board";
import { trackingActive } from "@/modules/maintenance/lib/expense-deadline";
import { receiptDataFromForm } from "@/modules/maintenance/lib/receipt-read";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { isWorkOrderSourceLink } from "@/modules/maintenance/lib/report-prefill";
import { postWorkOrderCard } from "@/modules/chat/data/task-cards";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { canDeleteWorkOrderWithPerm } from "@/modules/maintenance/lib/work-order-delete";
import { isWorkOrderMember, pendingMemberIds, waitingOnMembers, workOrderMemberIds } from "@/modules/maintenance/lib/work-order-members";
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
  withoutUninvolvedCeos,
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
import { putFile, putFiles, deleteFiles } from "@/modules/maintenance/lib/storage";
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

  // ใบส่วนตัว (ติ๊ก "ส่วนตัว" แบบหน้าสร้างงาน) — กันลืมของตัวเอง: ผู้รับผิดชอบคือคนเปิด ไม่มี CC
  // ไม่มีค่าใช้จ่ายให้ทวง ไม่แจ้งใคร ไม่ลงแชท · เห็นแค่คนเปิดกับ CEO · ไม่หักคะแนน ไม่นับสถิติ
  const isPrivate = formData.get("isPrivate") === "1";
  const assignedTo = isPrivate ? s.userId : d.assignedTo || null;
  // ทุกใบต้องมีผู้รับผิดชอบ (ผู้ใช้ 2/11/2569) — ฟอร์มบังคับเลือกแล้ว ตรงนี้กันคำขอที่ยิงตรงมา
  if (!assignedTo) throw new Error("เลือกผู้รับผิดชอบก่อนสร้างใบแจ้งซ่อม");
  // ใบกลุ่ม: ใบส่วนตัวและใบจากแผน PM เป็นกลุ่มไม่ได้ · รับเฉพาะคนในบริษัทที่ยังใช้งาน
  const pickedMembers = formData.getAll("groupMemberIds").map(String).filter((id) => id && id !== assignedTo);
  // ใบจาก PM เป็นกลุ่มได้แล้ว (แผนแบบกลุ่ม 5/11/2569) · ใบส่วนตัวยังเป็นกลุ่มไม่ได้
  const groupAllowed = !isPrivate && formData.get("woMode") === "group";
  const groupMemberIds = groupAllowed && pickedMembers.length > 0
    ? (await prisma.user.findMany({ where: { orgId: s.orgId, isActive: true, id: { in: [...new Set(pickedMembers)] } }, select: { id: true } })).map((u) => u.id)
    : [];
  const pickedRule = String(formData.get("completionRule") ?? "all");
  const completionRule = groupMemberIds.length > 0 ? (["all", "any", "shared"].includes(pickedRule) ? pickedRule : "all") : null;
  // กำหนดส่งแยกรายคน: รับเฉพาะคนในกลุ่ม วันที่ถูกรูปแบบและไม่ย้อนหลัง
  const memberDueDates: Record<string, string> = {};
  if (groupMemberIds.length > 0) {
    let raw: unknown = null;
    try {
      raw = JSON.parse(String(formData.get("memberDueDates") ?? "null"));
    } catch {
      raw = null;
    }
    for (const [id, day] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
      if (id !== assignedTo && !groupMemberIds.includes(id)) continue;
      if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      if (isPastDay(day)) throw new Error("กำหนดส่งรายคนย้อนหลังไม่ได้");
      memberDueDates[id] = day;
    }
  }
  const cc = isPrivate ? [] : (d.ccUserIds ?? []).filter((id) => id !== assignedTo && !groupMemberIds.includes(id));
  // เช็กลิสต์ (ไม่บังคับ) — เจ้าของข้อปรับให้ตรงกับทีมจริง (lib/work-order-checklist.ts)
  let rawChecklist: unknown = null;
  try {
    rawChecklist = JSON.parse(String(formData.get("checklist") || "null"));
  } catch {
    rawChecklist = null;
  }
  const checklist = checklistFromTemplate(
    readChecklistTemplate(rawChecklist),
    { assignedTo, groupMemberIds, completionRule },
    () => randomUUID(),
  );
  const [primary, ...additional] = d.propertyIds;

  if (d.dueDate && isPastDay(d.dueDate)) {
    throw new Error("วันครบกำหนดย้อนหลังไม่ได้ — ตั้งเป็นวันนี้หรือหลังจากนี้");
  }
  const dueDate = parseDueDate(d.dueDate);

  const photoFiles = formData.getAll("photos").filter((f): f is File => f instanceof File);
  const photoUrls = await putFiles(`${s.orgId}/maintenance/work-orders`, photoFiles);
  const sourceLabel = String(formData.get("sourceLabel") ?? "");
  const sourceLink = String(formData.get("sourceLink") ?? "");

  const { workOrder: wo, duplicate } = await createWorkOrder(s.orgId, {
    propertyId: primary!,
    additionalPropertyIds: additional,
    title: d.title,
    description: d.description ?? null,
    priority: d.priority,
    dueDate,
    assignedTo,
    groupMemberIds,
    completionRule,
    memberDueDates,
    checklist,
    createdBy: s.userId,
    ccUserIds: cc,
    assetId: d.assetId || null,
    pmScheduleId: d.pmScheduleId || null,
    pmScheduleIds,
    photoUrls,
    // ติ๊ก "ไม่มีค่าใช้จ่าย" ⇒ requiresExpense = false
    // ⚠ ใบงานที่เกิดจาก PM ใช้ค่าจากแผน PM แทน (ดู modules/maintenance/data/cron.ts)
    requiresExpense: !isPrivate && formData.get("noExpense") !== "1",
    isPrivate,
    ...(sourceLink && isWorkOrderSourceLink(sourceLink) ? { sourceLink, sourceLabel: sourceLabel.slice(0, 200) || null } : {}),
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

  await woLog(s, wo, "create", "สร้างใบงาน", { propertyIds: d.propertyIds, assignedTo, groupMemberIds, cc, priority: d.priority, photos: photoUrls.length });

  // แจ้งเตือนผู้รับผิดชอบ + CC (in-app + LINE) · ใบส่วนตัวไม่แจ้งใคร (คนเปิดเป็นคนรับเอง)
  const notifyTargets = new Set<string>(isPrivate ? [] : [...(assignedTo ? [assignedTo] : []), ...groupMemberIds, ...cc]);
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

  // การ์ดในแชทส่วนตัว คนสร้าง ↔ ผู้รับผิดชอบ แบบเดียวกับงาน (CC ไม่ได้การ์ด — ได้แค่แจ้งเตือนด้านบน)
  for (const assigneeId of [...(assignedTo ? [assignedTo] : []), ...groupMemberIds]) {
    await postWorkOrderCard(s.orgId, { assignerId: s.userId, assigneeId, workOrderId: wo.id, title: d.title, dueDate });
  }

  revalidatePath("/maintenance/work-orders");

  // ติ๊ก "เปิด PR ต่อเลย" ⇒ ไปต่อหน้าเปิด PR ที่ผูกใบงานนี้ให้เลย ไม่ต้องย้อน
  // เข้าใบงานไปกดเอง — เช็คสิทธิ์ซ้ำที่นี่ เพราะ checkbox ถูกยิงตรงมาได้
  if (
    !isPrivate &&
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
  const isOwnJob = isWorkOrderMember(wo, s.userId) || wo.createdBy === s.userId;
  const canCompleteOwn =
    hasPermission(s, MAINT_PERMS.workorderComplete) && isOwnJob;
  if (!canManage && !canCompleteOwn) {
    throw new Error("ไม่มีสิทธิ์เปลี่ยนสถานะใบงานนี้");
  }

  // changed = คำขอนี้เป็นคนเปลี่ยนสถานะจริง — กดซ้ำ/กดพร้อมกันได้ false (ดู updateWorkOrderStatus)
  // ใบกลุ่มแบบครบทุกคน: ปิดได้เมื่อทุกคนทำส่วนตัวเองเสร็จ · ผู้จัดการใบงานปิดแทนได้
  if (status === "completed" && !canManage && waitingOnMembers(wo, s.userId).length > 0) {
    throw new Error("ยังปิดไม่ได้ รอสมาชิกในกลุ่มทำส่วนของตัวเองให้เสร็จก่อน");
  }
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
  wo: { id: string; title: string; propertyId: string; assignedTo: string | null; groupMemberIds?: string[]; createdBy: string | null; ccUserIds: string[]; pmRoundDate?: Date | null; isPrivate?: boolean },
  status: string,
  actorId: string
) {
  // ใบส่วนตัว — ไม่มีใครต้องรู้ (ผู้ดูแลบ้านก็ไม่เห็นใบนี้)
  if (wo.isPrivate) return;
  // ปิดงาน/ยกเลิกแล้ว ⇒ "ได้รับมอบหมาย" / "ขอเลื่อน…รออนุมัติ" ของใบนี้ไม่มีอะไรให้ทำแล้ว ไม่ต้องค้างที่ใคร
  if (status === "completed" || status === "cancelled") {
    await resolveActionNotifications(wo.id, "work_order", ["ได้รับมอบหมายงานใหม่", "ขอเลื่อนกำหนดส่งใบงาน รออนุมัติ"]);
  }
  // ใบรอบ PM: กด "รับงาน" = รับเรื่องแล้ว ⇒ แจ้งเตือนให้รับงานไม่ต้องค้าง (ใบอื่นคงไว้ตามเดิม)
  if (status === "in_progress" && wo.pmRoundDate) {
    await resolveActionNotifications(wo.id, "work_order", ["ได้รับมอบหมายงานใหม่"]);
  }
  const st = STATUS_TEXT[status] ?? { emoji: "📋", label: status };
  const property = await getProperty(orgId, wo.propertyId);
  const propertyName = property?.name ?? "-";
  const targets = new Set<string>([
    ...workOrderMemberIds(wo),
    ...(wo.createdBy ? [wo.createdBy] : []),
    ...wo.ccUserIds,
    ...(await propertyCaretaker(orgId, wo.propertyId)),
  ]);
  targets.delete(actorId);
  await notifyUsers(orgId, await withoutUninvolvedCeos(orgId, targets, wo), {
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
/** ใบกลุ่มแบบครบทุกคน: กดเสร็จส่วนของตัวเอง กดอีกครั้งเพื่อยกเลิก · คนสุดท้ายปิดงานจริงด้วยปุ่มปิดงาน */
export async function toggleMyGroupPartAction(formData: FormData) {
  const s = await requireOrg();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const wo = await getWorkOrder(s.orgId, id);
  if (!wo || !canSeeWorkOrder(await workOrderAccess(s), wo)) return;
  if (!isWorkOrderMember(wo, s.userId) || wo.groupMemberIds.length === 0 || (wo.completionRule ?? "all") !== "all") return;
  if (wo.status !== "open" && wo.status !== "in_progress") return;
  if (!hasPermission(s, MAINT_PERMS.workorderComplete) && !hasPermission(s, MAINT_PERMS.workorderManage)) return;
  // คนที่มีข้อในเช็กลิสต์: เสร็จเมื่อติ๊กครบเอง ไม่ใช้ปุ่มนี้
  if (itemsOf(readChecklist(wo.checklist), s.userId, wo).length > 0) return;
  const done = !wo.completedMemberIds.includes(s.userId);
  const next = done ? [...wo.completedMemberIds, s.userId] : wo.completedMemberIds.filter((x) => x !== s.userId);
  await prisma.workOrder.update({ where: { id: wo.id }, data: { completedMemberIds: next } });
  await addWorkOrderComment(s.orgId, wo.id, s.userId, done ? "ทำส่วนของตัวเองเสร็จแล้ว" : "ยกเลิกเสร็จส่วนของตัวเอง", null, { kind: "log" });
  await woLog(s, wo, "update", done ? "เสร็จส่วนของตัวเอง" : "ยกเลิกเสร็จส่วนของตัวเอง");
  // เหลือคนเดียวที่ยังไม่เสร็จ ⇒ บอกคนนั้นให้ปิดงาน
  const left = pendingMemberIds({ ...wo, completedMemberIds: next });
  if (done && left.length === 1 && left[0] !== s.userId) {
    await notifyUser(s.orgId, left[0]!, {
      title: `✅ ทุกคนเสร็จแล้ว เหลือคุณคนเดียว: ${wo.title}`,
      body: `${wo.code} · ทำส่วนของคุณให้เสร็จแล้วกดปิดงาน`,
      type: "work_order",
      referenceId: wo.id,
    });
  }
  revalidatePath(`/maintenance/work-orders/${id}`);
  revalidatePath("/maintenance/work-orders");
}

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
  const isOwnJob = isWorkOrderMember(wo, s.userId) || wo.createdBy === s.userId;
  const canCompleteOwn =
    hasPermission(s, MAINT_PERMS.workorderComplete) && isOwnJob;
  if (!canManage && !canCompleteOwn) {
    throw new Error("ไม่มีสิทธิ์ปิดใบงานนี้");
  }
  if (!canManage && waitingOnMembers(wo, s.userId).length > 0) {
    throw new Error("ยังปิดไม่ได้ รอสมาชิกในกลุ่มทำส่วนของตัวเองให้เสร็จก่อน");
  }
  // เช็กลิสต์ต้องครบตามวิธีปิดงานก่อน (เหมือนงาน) · ผู้จัดการปิดแทนได้เหมือนรอกลุ่ม
  const checkItems = readChecklist(wo.checklist);
  if (!canManage && !checklistAllowsClose(wo, checkItems)) {
    throw new Error(`ยังปิดไม่ได้ เช็กลิสต์ยังไม่ครบ ${remainingCount(checkItems)} ข้อ`);
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

  // เปิดใช้กำหนดบันทึกแล้ว: ช่างแจ้ง ผู้บันทึกลงยอด (ผู้ใช้ 3/11/2569) — เก็บที่กรอกไว้รอตรวจ ยังไม่ลงยอด
  // ติ๊กไม่มีค่าใช้จ่าย/ใส่ 0 จบเลย ไม่เป็นงานของผู้บันทึก (เห็นในคอลัมน์เสร็จ แก้ได้)
  const tracked = wo.requiresExpense && !wo.isPrivate && trackingActive(await loadExpenseTracking(s.orgId));
  const quickNone = formData.get("noExpense") === "1";
  const estimate = names.map((name, i) => ({ name: name.trim(), price: (prices[i] ?? "").trim() }));
  const allZero = estimate.some((x) => x.name !== "" && x.price !== "") && estimate.filter((x) => x.price !== "").every((x) => parseBaht(x.price) === 0);
  if (tracked && !quickNone && !allZero) {
    const receipt = formData.get("expenseReceipt");
    // รับเฉพาะรูป — ฟอร์มกรองแล้ว แต่คำขอยิงตรงได้ ไฟล์อื่นจะถูกเปิดจากโดเมนเรา
    const hasReceipt = receipt instanceof File && receipt.size > 0 && receipt.type.startsWith("image/");
    const first = estimate.find((x) => x.name !== "" || x.price !== "");
    const firstPrice = first ? parseBaht(first.price) : NaN;
    await updateWorkOrder(s.orgId, id, {
      expenseDraft: {
        name: (first?.name ?? "").slice(0, 300),
        // ราคาอ่านไม่ออก/ติดลบ/เกินหลัก = ไม่รู้ราคา ให้ผู้บันทึกลงเอง
        price: first && first.price !== "" && Number.isFinite(firstPrice) && firstPrice >= 0 && firstPrice <= MAX_EXPENSE ? String(firstPrice) : "",
        noReceipt: formData.get("noReceipt") === "1",
        receiptUrl: hasReceipt ? await putFile(`${s.orgId}/maintenance/receipts`, receipt) : null,
        receiptSha256: hasReceipt ? createHash("sha256").update(Buffer.from(await receipt.arrayBuffer())).digest("hex") : null,
        ai: parseReceiptAi(formData.get("receiptAi")),
        by: s.userId,
        at: new Date().toISOString(),
      },
    });
  }
  const recorded =
    tracked && !quickNone && !allZero
      ? false
      : await recordEstimateAsExpense(s.orgId, wo, quickNone ? [{ name: "ไม่มีค่าใช้จ่าย", price: "0" }] : estimate, s.userId);
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

/** เพดานคอลัมน์ amount Decimal(12,2) */
const MAX_EXPENSE = 9_999_999_999.99;

/** ค่าที่ AI อ่านจากฟอร์ม — ใช้เทียบย้อนหลังเท่านั้น ไม่ได้ใช้คำนวณ */
function parseReceiptAi(v: FormDataEntryValue | null): Prisma.InputJsonValue | null {
  if (typeof v !== "string" || !v || v.length > 2000) return null;
  try {
    return receiptDataFromForm(v) as unknown as Prisma.InputJsonValue;
  } catch {
    return null;
  }
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

  // ใบส่วนตัว: มีแค่คนเปิดที่ต้องรู้ (เช่น CEO เข้ามาเขียน) — ไม่แจ้ง/แท็กคนอื่น เขาเปิดใบนี้ไม่ได้
  if (wo.isPrivate) {
    if (wo.createdBy && wo.createdBy !== s.userId) {
      await notifyUser(s.orgId, wo.createdBy, {
        title: `💬 ความคิดเห็นใหม่ในใบงานส่วนตัว: ${wo.title}`,
        body: content ? clip(content, 120) : undefined,
        type: "work_order",
        referenceId: wo.id,
      });
    }
  }
  // แจ้งผู้เกี่ยวข้องเมื่อมีความคิดเห็นใหม่ (ยกเว้นคนที่พิมพ์เอง)
  else {
    const targets = new Set<string>([
      ...workOrderMemberIds(wo),
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
    await notifyUsers(s.orgId, await withoutUninvolvedCeos(s.orgId, targets, wo), {
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
  const isOwnJob = isWorkOrderMember(wo, s.userId) || wo.createdBy === s.userId;
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
  const isAdmin = hasPermission(s, MAINT_PERMS.admin);
  if (!isAdmin && !hasPermission(s, MAINT_PERMS.workorderDelete)) {
    throw new Error("ไม่มีสิทธิ์ลบใบงาน");
  }
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // สิทธิ์ลบแยก: ใบเลยกำหนดลบไม่ได้ ไม่งั้นลบเลี่ยงการหักคะแนนได้ ("กันคนเหลี่ยม" ผู้ใช้ 4/11/2569)
  if (!isAdmin) {
    const target = await getWorkOrder(s.orgId, id);
    if (target && !canDeleteWorkOrderWithPerm(target)) throw new Error("ลบได้เฉพาะใบที่ยังไม่ปิดและยังไม่เลยกำหนด");
  }
  // ใบที่โดนหักคะแนนแล้ว: ต้องมีเหตุผล · คืนคะแนนทันทีและบอกคนที่โดนหัก (ผู้ใช้ 6/11/2569 "ต้องมีบอกเค้าสิ")
  // เดิมงานหักคะแนนคืนให้เองรอบถัดไปโดยไม่บอกเหตุผล
  const woForDocks = await getWorkOrder(s.orgId, id);
  const dockRows = woForDocks
    ? await prisma.performanceEvent.findMany({
        where: {
          orgId: s.orgId,
          source: "maintenance",
          category: { in: ["workorder_overdue", "pm_missed"] },
          OR: [
            { refId: id },
            { refId: { startsWith: `${id}:` } },
            ...(woForDocks.pmRoundDate && woForDocks.pmScheduleId
              ? [{ refId: { startsWith: roundDockRefId(woForDocks.pmScheduleId, woForDocks.pmRoundDate, id) } }]
              : []),
          ],
        },
        select: { id: true, userId: true, category: true, refId: true, refType: true, points: true, note: true },
      })
    : [];
  const undoneKeys = new Set(dockRows.filter((e) => e.refType?.endsWith("_undo")).map((e) => `${e.category}|${e.refId}`));
  const liveDocks = dockRows.filter((e) => !e.refType?.endsWith("_undo") && !undoneKeys.has(`${e.category}|${e.refId}`));
  const deleteReason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  if (liveDocks.length > 0 && deleteReason.length < 2) throw new Error("ใบนี้โดนหักคะแนนแล้ว ใส่เหตุผลที่ลบก่อน");
  // ลบใบงานที่ยังเปิดอยู่จาก PM = ข้ามรอบนั้นด้วย (เหตุผลเดียวกับยกเลิก)
  const wo = await getWorkOrder(s.orgId, id);
  if (wo && (wo.status === "open" || wo.status === "in_progress") && wo.completedAt === null) await skipLinkedPm(s.orgId, wo);
  await deleteWorkOrder(s.orgId, id);
  if (wo) await woLog(s, wo, "delete", "ลบใบงาน", { status: wo.status, propertyId: wo.propertyId, ...(deleteReason ? { reason: deleteReason } : {}), ...(liveDocks.length ? { refundedDocks: liveDocks.length } : {}) });
  if (wo && dockRows.length > 0) {
    // ลบทั้งการหักและคู่คืนคะแนน (ถ้ามี) เหมือนงานหักคะแนนทำตอนต้นเรื่องหาย — ไม่งั้นคืนซ้ำ
    await prisma.performanceEvent.deleteMany({ where: { orgId: s.orgId, id: { in: dockRows.map((e) => e.id) } } });
    const who = (await notifyActorName(s.userId)) ?? "ผู้ดูแล";
    const byUser = new Map<string, number>();
    for (const e of liveDocks) byUser.set(e.userId, (byUser.get(e.userId) ?? 0) + Math.abs(Number(e.points)));
    for (const [userId, pts] of byUser) {
      await notifyUser(s.orgId, userId, {
        title: `คืนคะแนน +${pts} · ใบงานถูกลบ: ${wo.title}`,
        body: `${wo.code ?? ""} ถูกลบโดย ${who} · เหตุผล: ${deleteReason}`.trim(),
        type: "work_order",
        referenceId: null,
      });
    }
  }
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

/** การ์ดคอลัมน์เสร็จแล้ว โหลดตอนกดแสดงเพิ่มเติม — ตรวจสิทธิ์เห็นใบเหมือนตอนเปิดหน้า */
export async function loadDoneWorkOrderCardsAction(ids: string[]): Promise<BoardOrder[]> {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.workorderView)) return [];
  const want = z.array(z.string()).max(100).parse(ids);
  if (want.length === 0) return [];
  const orgId = session.orgId;
  const access = await workOrderAccess(session);
  const [orders, expenseSet, tracking] = await Promise.all([
    listWorkOrders(orgId, { ids: want, access }),
    workOrderIdsWithExpenses(orgId),
    loadExpenseTracking(orgId),
  ]);
  return buildBoardRows(orgId, orders, expenseSet, tracking);
}
