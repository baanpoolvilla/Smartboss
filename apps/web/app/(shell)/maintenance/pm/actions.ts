"use server";

import { z } from "zod";
import { readChecklistTemplate } from "@/modules/maintenance/lib/work-order-checklist";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission, audit, canViewAll } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import {
  createPmSchedule,
  closeAutoWorkOrdersOfPm,
  completePmSchedule,
  deletePmSchedule,
  schedulePmNextVisit,
  updatePmSchedule,
  getPmSchedule,
} from "@/modules/maintenance/data/pm";
import { getProperty } from "@/modules/maintenance/data/properties";
import { logActivity, type ActivityKind } from "@/modules/maintenance/data/activity";
import { getAsset } from "@/modules/maintenance/data/assets";
import { roundsPerYearOptions } from "@/modules/maintenance/lib/pm-schedule";
import { deleteNotificationsByReference } from "@/modules/maintenance/data/notify";
import { isPastDay } from "@/modules/maintenance/lib/no-past-date";
import { loadRoundOrg, openEarlyRound, openRoundsNow, openRoundsOfPm, pmIsRoundMode, roundsFromDate } from "@/modules/maintenance/data/pm-rounds";
import { DEFAULT_PM_LEAD_DAYS, ROUND_DESC_RE, roundDescLine, roundDueAt } from "@/modules/maintenance/lib/pm-rounds";
import { canEditDueDate } from "@/modules/maintenance/lib/due-request-access";
import { canSeeWorkOrder, workOrderAccess } from "@/modules/maintenance/data/work-order-access";
import { getWorkOrder } from "@/modules/maintenance/data/work-orders";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";
import { editDueDateAction } from "@/app/(shell)/maintenance/work-orders/due-request-actions";

function parseDate(s: string): Date {
  return new Date(s + "T00:00:00.000Z");
}

async function requirePmManage(): Promise<string> {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.pmManage)) {
    throw new Error("ไม่มีสิทธิ์จัดการ PM");
  }
  return s.orgId;
}

/** บันทึกการใช้งาน (เมนู Log การใช้งาน) ของแผน PM — ไม่ throw */
async function pmLog(
  orgId: string,
  pm: { id: string | null; title: string; propertyId?: string | null },
  action: ActivityKind,
  summary: string,
  detail?: Record<string, unknown>
) {
  const session = await requireOrg();
  const house = pm.propertyId ? (await getProperty(orgId, pm.propertyId))?.name : null;
  await logActivity(orgId, {
    userId: session.userId,
    entity: "pm",
    entityId: pm.id,
    entityCode: pm.title,
    action,
    summary: `${summary} "${pm.title}"${house ? ` บ้าน ${house}` : ""}`,
    detail,
  });
}

const fmtDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "-");

const createSchema = z.object({
  propertyId: z.string().min(1, "เลือกบ้าน"),
  assetId: z.string().optional(),
  title: z.string().trim().min(1, "กรอกชื่องาน PM").max(200),
  description: z.string().trim().max(1000).optional(),
  mode: z.enum(["continuous", "yearlyRounds", "limitedCount"]),
  frequency: z.string().default("monthly"),
  nextDueDate: z.string().min(1, "เลือกวันกำหนด"),
  roundsPerYear: z.string().optional(),
  totalRounds: z.string().optional(),
  // ทุกแผนต้องมีผู้รับผิดชอบ (ผู้ใช้ 2/11/2569) — ใบรอบไปหาคนนี้ และคนนี้คือคนที่โดนหักถ้าเลยกำหนด
  assignedTo: z.string().min(1, "เลือกผู้รับผิดชอบ"),
});

/**
 * สร้าง PM — เลือกอุปกรณ์ได้หลายชิ้นพร้อมกัน (1 อุปกรณ์ = 1 แผน)
 * ตรงกับ _showCreatePmDialog + createPmSchedulesBatch ของเดิม
 */
/**
 * ทีมของแผน (เดี่ยว/กลุ่ม + วิธีปิดงาน) และแม่แบบเช็กลิสต์จากฟอร์ม — ใบทุกรอบได้ค่าเหล่านี้ (lib/pm-team.ts)
 * ฟอร์มที่ไม่ได้ส่งช่องมา = ไม่แตะของเดิม
 */
async function teamFromForm(orgId: string, formData: FormData, assignedTo: string | null) {
  const out: { groupMemberIds?: string[]; completionRule?: string | null; checklist?: { text: string; ownerId: string | null }[] | null } = {};
  if (formData.has("woMode")) {
    const picked = formData.get("woMode") === "group"
      ? [...new Set(formData.getAll("groupMemberIds").map(String).filter((x) => x && x !== assignedTo))]
      : [];
    const ok = picked.length
      ? (await prisma.user.findMany({ where: { orgId, isActive: true, id: { in: picked } }, select: { id: true } })).map((u) => u.id)
      : [];
    out.groupMemberIds = picked.filter((x) => ok.includes(x));
    const rule = String(formData.get("completionRule") ?? "all");
    out.completionRule = out.groupMemberIds.length > 0 ? (["all", "any", "shared"].includes(rule) ? rule : "all") : null;
  }
  if (formData.has("checklist")) {
    let raw: unknown = null;
    try {
      raw = JSON.parse(String(formData.get("checklist") || "null"));
    } catch {
      raw = null;
    }
    const items = readChecklistTemplate(raw);
    out.checklist = items.length > 0 ? items : null;
  }
  return out;
}

export async function createPmAction(formData: FormData) {
  const orgId = await requirePmManage();
  const assetIds = formData.getAll("assetIds").map(String).filter(Boolean);
  const parsed = createSchema.safeParse({
    propertyId: formData.get("propertyId"),
    assetId: (formData.get("assetId") as string) || undefined,
    title: formData.get("title"),
    description: (formData.get("description") as string) || undefined,
    mode: formData.get("mode"),
    frequency: (formData.get("frequency") as string) || "monthly",
    nextDueDate: formData.get("nextDueDate"),
    roundsPerYear: (formData.get("roundsPerYear") as string) || undefined,
    totalRounds: (formData.get("totalRounds") as string) || undefined,
    assignedTo: (formData.get("assignedTo") as string) || undefined,
  });
  if (!parsed.success) return;
  const d = parsed.data;

  let roundsPerYear: number | null = null;
  let totalRounds: number | null = null;
  const frequency = d.mode === "limitedCount" ? "monthly" : d.frequency;

  if (d.mode === "yearlyRounds") {
    // รับเฉพาะค่าที่อยู่ในลิสต์จริง — ค่าที่ไม่อยู่ในลิสต์แปลว่าฟอร์มกับเซิร์ฟเวอร์
    // คิดไม่ตรงกัน (หรือมีคนยิงมาเอง) ตกเป็นแบบต่อเนื่องซึ่งเป็นค่าที่ปลอดภัยกว่า
    const allowed = roundsPerYearOptions(d.frequency);
    const r = Number(d.roundsPerYear);
    roundsPerYear = allowed.includes(r) ? r : null;
  } else if (d.mode === "limitedCount") {
    const t = Number(d.totalRounds);
    totalRounds = Number.isFinite(t) && t >= 2 ? t : 6;
  }

  if (isPastDay(d.nextDueDate)) throw new Error("วันกำหนดรอบแรกย้อนหลังไม่ได้");
  const due = parseDate(d.nextDueDate);
  const session = await requireOrg();
  const ccUserIds = formData.getAll("ccUserIds").map(String).filter(Boolean);

  const base = {
    title: d.title,
    description: d.description ?? null,
    // ใบงานที่ระบบสร้างตามรอบจะรับค่านี้ไปด้วย (ดู modules/maintenance/data/cron.ts)
    requiresExpense: formData.get("noExpense") !== "1",
    frequency,
    nextDueDate: due,
    anchorDate: due,
    roundsPerYear,
    totalRounds,
    assignedTo: d.assignedTo || null,
    ...(await teamFromForm(orgId, formData, d.assignedTo || null)),
    ccUserIds,
    createdBy: session.userId,
  };

  const createdIds: string[] = [];
  if (assetIds.length > 0) {
    // 1 แผนต่อ 1 อุปกรณ์ — บ้านยึดตามอุปกรณ์ที่เลือก
    for (const assetId of assetIds) {
      const asset = await getAsset(orgId, assetId);
      if (!asset) continue;
      const created = await createPmSchedule(orgId, {
        ...base,
        propertyId: asset.propertyId,
        assetId,
      });
      createdIds.push(created.id);
      await pmLog(orgId, { id: null, title: `${d.title} · ${asset.name}`, propertyId: asset.propertyId }, "create", "สร้างแผน PM", {
        frequency, nextDueDate: d.nextDueDate, mode: d.mode, assignedTo: d.assignedTo || null,
      });
    }
  } else {
    const created = await createPmSchedule(orgId, {
      ...base,
      propertyId: d.propertyId,
      assetId: d.assetId || null,
    });
    createdIds.push(created.id);
    await pmLog(orgId, { id: null, title: d.title, propertyId: d.propertyId }, "create", "สร้างแผน PM", {
      frequency, nextDueDate: d.nextDueDate, mode: d.mode, assignedTo: d.assignedTo || null,
    });
  }
  await openRoundsNow(orgId, createdIds);

  revalidatePath("/maintenance/pm");
  redirect("/maintenance/pm");
}

/** แก้ไข PM (ชื่อ / ความถี่ / วันกำหนด / รายละเอียด) */
export async function updatePmAction(formData: FormData) {
  const orgId = await requirePmManage();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const title = String(formData.get("title") ?? "").trim();
  const frequency = String(formData.get("frequency") ?? "").trim();
  const nextDueDate = String(formData.get("nextDueDate") ?? "").trim();
  // ฟอร์มส่งวันกำหนดมาทุกครั้ง แม้คนแก้แค่ผู้รับผิดชอบ — ถ้าเปิดหน้าไว้ก่อนมีคนปิดรอบ วันเก่า
  // บนจอจะถูกบันทึกทับวันที่ระบบเพิ่งเลื่อนให้ ⇒ PM ถึงกำหนดอีกรอบ เช้าวันถัดไประบบเปิดใบงาน
  // ซ้ำ ("รอบ 14 วันแต่มาก่อน") จึงเปลี่ยนวันเฉพาะเมื่อช่องนี้ถูกแก้ต่างจากที่เห็นตอนเปิดฟอร์ม
  const originalNextDueDate = formData.get("originalNextDueDate");
  let dueChanged =
    !!nextDueDate && (originalNextDueDate === null || nextDueDate !== String(originalNextDueDate).trim());
  // เลื่อนวันกำหนดไปอยู่ในอดีตไม่ได้ (วันเดิมที่เลยไปแล้วส่งกลับมาเหมือนเดิมได้ — dueChanged = false)
  if (dueChanged && isPastDay(nextDueDate)) throw new Error("วันกำหนดถัดไปย้อนหลังไม่ได้");
  const description = String(formData.get("description") ?? "").trim();
  const assignedTo = String(formData.get("assignedTo") ?? "").trim();
  // ถอนมอบหมายให้ว่างไม่ได้แล้ว — ทุกแผนต้องมีผู้รับผิดชอบ (ผู้ใช้ 2/11/2569)
  if (!assignedTo) throw new Error("เลือกผู้รับผิดชอบของแผน PM");
  const before = await prisma.pmSchedule.findFirst({
    where: { orgId, id },
    select: { nextDueDate: true, frequency: true, roundsPerYear: true, assignedTo: true, title: true, propertyId: true, createdBy: true },
  });

  // ใบเปิดอยู่: แก้วันที่แล้วใบเลื่อนตาม (ผู้ใช้ 4/11/2569) สิทธิ์เดียวกับปุ่มแก้กำหนดส่ง — คนทำงานต้องขอเลื่อนในใบงาน
  // ไม่งั้นแก้แผนเลี่ยงการอนุมัติและการหักคะแนนได้ ("กันคนเหลี่ยม")
  const actor = await requireOrg();
  const openRounds = dueChanged && before ? await openRoundsOfPm(orgId, id) : [];
  if (openRounds.length > 0 && !canEditDueDate({ userId: actor.userId, viewAll: canViewAll(actor) || hasPermission(actor, MAINT_PERMS.pmMoveRounds) }, { createdBy: before?.createdBy ?? null })) {
    dueChanged = false;
  }
  // คนแก้ต้องเห็นใบที่จะเลื่อนครบทุกใบ ไม่งั้นวันในแผนเปลี่ยนแต่ใบไม่ตาม เกิดใบซ้ำในรอบเดียวกัน
  if (dueChanged && openRounds.length > 0) {
    const access = await workOrderAccess(actor);
    const orders = await Promise.all(openRounds.map((w) => getWorkOrder(orgId, w.id)));
    if (orders.some((w) => !w || !canSeeWorkOrder(access, w))) dueChanged = false;
  }
  const moveRounds = dueChanged && openRounds.length > 0;

  await updatePmSchedule(orgId, id, {
    ...(title ? { title } : {}),
    ...(frequency ? { frequency } : {}),
    ...(dueChanged
      ? { nextDueDate: parseDate(nextDueDate), anchorDate: parseDate(nextDueDate) }
      : {}),
    assignedTo,
    // ทีม + เช็กลิสต์: มีผลกับใบรอบถัดไป ใบที่เปิดอยู่แก้ในใบเอง (ปุ่ม "แก้" ข้างผู้รับผิดชอบ)
    ...(await teamFromForm(orgId, formData, assignedTo)),
    // มีผลกับใบงานที่ระบบสร้างหลังจากนี้เท่านั้น — ใบที่เปิดค้างอยู่เก็บค่าของตัวเองไว้แล้ว
    requiresExpense: formData.get("noExpense") !== "1",
    description: description || null,
  });

  // เก็บว่าใครเปลี่ยนวันกำหนด/ความถี่/ผู้รับผิดชอบ จากอะไรเป็นอะไร — เดิมไม่มีร่องรอยเลย
  // PM ถูกเลื่อนวันแล้วระบบเปิดใบงานใหม่ ไล่ย้อนไม่ได้ว่าใครตั้ง (ดู /admin/audit)
  const session = await requireOrg();
  await audit({
    userId: session.userId,
    action: "PM_UPDATED",
    targetId: id,
    detail: {
      title,
      nextDueDate: dueChanged
        ? { from: before?.nextDueDate.toISOString().slice(0, 10) ?? null, to: nextDueDate }
        : undefined,
      frequency: frequency && frequency !== before?.frequency ? { from: before?.frequency ?? null, to: frequency } : undefined,
      assignedTo:
        (assignedTo || null) !== (before?.assignedTo ?? null)
          ? { from: before?.assignedTo ?? null, to: assignedTo || null }
          : undefined,
    },
  });
  await pmLog(orgId, { id, title: title || before?.title || "-", propertyId: before?.propertyId }, "update", "แก้ไขแผน PM", {
    nextDueDate: dueChanged ? { from: fmtDay(before?.nextDueDate), to: nextDueDate } : undefined,
    frequency: frequency && frequency !== before?.frequency ? { from: before?.frequency ?? null, to: frequency } : undefined,
    assignedTo: (assignedTo || null) !== (before?.assignedTo ?? null) ? { from: before?.assignedTo ?? null, to: assignedTo || null } : undefined,
    title: title && before && title !== before.title ? { from: before.title, to: title } : undefined,
  });
  if (moveRounds) {
    // กติกา 10/11/2569: กำหนดส่งของใบรอบ = วันของรอบ + เวลาทำ (ไม่ใช่วันของรอบ)
    const windowDays = (await loadRoundOrg(orgId))?.pmLeadDays ?? DEFAULT_PM_LEAD_DAYS;
    const plan = roundsFromDate(
      { frequency: frequency || before!.frequency, roundsPerYear: before!.roundsPerYear },
      parseDate(nextDueDate),
      openRounds.length,
    );
    for (const [i, wo] of openRounds.entries()) {
      const round = plan.rounds[i]!;
      // แก้กำหนดส่งผ่านตัวเดียวกับปุ่มในใบงาน — มีบันทึกในใบ แจ้งผู้รับผิดชอบ และเคลียร์คำขอเลื่อนที่ค้าง
      const due = roundDueAt(round, windowDays);
      const r = await editDueDateAction(wo.id, new Date(due.getTime() + 7 * 3600e3).toISOString().slice(0, 10), "ตามวันที่ในแผน PM");
      if (r.error) throw new Error(r.error);
      await prisma.workOrder.update({
        where: { id: wo.id },
        data: {
          pmRoundDate: round,
          description: wo.description?.replace(ROUND_DESC_RE, roundDescLine(fmtThaiDate(round), fmtThaiDate(due))) ?? wo.description,
        },
      });
    }
    await prisma.pmSchedule.update({ where: { id }, data: { nextDueDate: plan.nextDueDate, anchorDate: plan.anchorDate } });
    revalidatePath("/maintenance/work-orders");
  }
  if (dueChanged || (frequency && frequency !== before?.frequency)) await openRoundsNow(orgId, [id]);

  revalidatePath("/maintenance/pm");
  // แก้จากหน้าอุปกรณ์ด้วย (assets/[id]) — ให้หน้านั้นเห็นค่าใหม่ทันที
  revalidatePath("/maintenance/assets/[id]", "page");
}

export async function completePmAction(formData: FormData) {
  const orgId = await requirePmManage();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const pm = await getPmSchedule(orgId, id);
  // PM แบบนับรอบ: "ปิดรอบ" = ปิดใบรอบที่ค้างเก่าสุด (รอบอื่นยังเป็นงานค้างของมันเอง)
  const oldestRound = pm && (await pmIsRoundMode(orgId, pm))
    ? await prisma.workOrder.findFirst({
        where: { orgId, pmScheduleId: id, pmRoundDate: { not: null }, status: { in: ["open", "in_progress"] } },
        orderBy: { pmRoundDate: "asc" },
        select: { id: true, pmRoundDate: true },
      })
    : null;
  if (oldestRound) {
    await prisma.workOrder.updateMany({
      where: { orgId, id: oldestRound.id, status: { in: ["open", "in_progress"] } },
      data: { status: "completed", completedAt: new Date(), completionNotes: "ปิดรอบที่หน้าแผน PM", requiresExpense: false },
    });
  }
  await completePmSchedule(orgId, id);
  await closeAutoWorkOrdersOfPm(orgId, id, "done");
  if (pm) await pmLog(orgId, pm, "status", `ปิดรอบ PM (กำหนด ${fmtDay(oldestRound?.pmRoundDate ?? pm.nextDueDate)})`);
  const session = await requireOrg();
  await audit({ userId: session.userId, action: "PM_ROUND_CLOSED", targetId: id });
  revalidatePath("/maintenance/pm");
  revalidatePath("/maintenance/work-orders");
}

export async function scheduleNextAction(formData: FormData) {
  const orgId = await requirePmManage();
  const id = String(formData.get("id") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!id || !date) return;
  if (isPastDay(date)) throw new Error("วันนัดครั้งถัดไปย้อนหลังไม่ได้");
  await schedulePmNextVisit(orgId, id, parseDate(date));
  const pm = await getPmSchedule(orgId, id);
  if (pm) await pmLog(orgId, pm, "update", `นัดครั้งถัดไป ${date}`);
  revalidatePath("/maintenance/pm");
}

export async function deletePmAction(formData: FormData) {
  const orgId = await requirePmManage();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const pm = await getPmSchedule(orgId, id);
  // ใบที่ถูกยกเลิกไปกับแผน แจ้งเตือนต้องหายด้วย ไม่งั้นกดแล้วไปเจอใบที่ไม่มีงานแล้ว
  const cancelledWos = await prisma.workOrder.findMany({
    where: { orgId, pmScheduleId: id, autoCreated: true, status: { in: ["open", "in_progress"] } },
    select: { id: true, overdueScore: true },
  });
  // ใบที่โดนหักแล้ว: จดว่าเก็บคะแนน ไม่งั้นงานหักคะแนนเห็นใบถูกยกเลิกแล้วคืนให้เอง
  // ถ้าไม่ควรโดนให้ขอแก้ไขคะแนน (ผู้ใช้ 5/11/2569) · ใบที่ CEO ยกเว้นไว้แล้วคงเดิม
  const dockedRefs = cancelledWos.length
    ? await prisma.performanceEvent.findMany({
        where: {
          orgId,
          source: "maintenance",
          category: { in: ["workorder_overdue", "pm_missed"] },
          OR: [{ refId: { startsWith: `${id}:` } }, ...cancelledWos.flatMap((w) => [{ refId: w.id }, { refId: { startsWith: `${w.id}:` } }])],
        },
        select: { refId: true },
      })
    : [];
  const keepIds = cancelledWos
    .filter((w) => w.overdueScore === null && dockedRefs.some((d) => d.refId === w.id || d.refId?.startsWith(`${w.id}:`) || d.refId?.split(":")[2] === w.id))
    .map((w) => w.id);
  if (keepIds.length > 0) await prisma.workOrder.updateMany({ where: { orgId, id: { in: keepIds } }, data: { overdueScore: "kept" } });
  await closeAutoWorkOrdersOfPm(orgId, id, "cancelled");
  await Promise.all(cancelledWos.map((w) => deleteNotificationsByReference(w.id, "work_order")));
  await deletePmSchedule(orgId, id);
  if (pm) await pmLog(orgId, pm, "delete", "ลบแผน PM");
  revalidatePath("/maintenance/work-orders");
  // referenceId ของแจ้งเตือน "pm" ยังคือ pm.id เดิม (ดู cron.ts's
  // notifyDuePmSchedules) แม้ลิงก์จะพาไปหน้ารายการรวมเสมอ (maintenanceHrefFor
  // ไม่ได้ใช้ referenceId ของ "pm") ไม่ลบก็ไม่ถึงกับลิงก์พัง แต่ข้อความจะค้าง
  // พูดถึงแผนที่ไม่มีอยู่แล้ว — เก็บกวาดไปด้วยกันเลย (ดู
  // deleteNotificationsByReference's doc)
  await deleteNotificationsByReference(id, "pm");
  revalidatePath("/maintenance/pm");
}

/**
 * ทำรอบล่วงหน้า — คนตั้ง PM เลือกรอบในอนาคตมาเปิดใบตอนนี้ (ผู้ใช้ 10/11/2569 "ต้องเป็นคนตั้ง PM")
 * ทำเสร็จ = รอบนั้นจบ ถึงวันของรอบระบบไม่เปิดซ้ำ
 */
export async function earlyRoundAction(formData: FormData): Promise<{ error?: string; id?: string }> {
  const session = await requireOrg();
  const pmId = String(formData.get("pmId") ?? "");
  const round = String(formData.get("round") ?? "");
  if (!pmId || !/^\d{4}-\d{2}-\d{2}$/.test(round)) return { error: "เลือกรอบก่อน" };
  const r = await openEarlyRound(session.orgId, pmId, round, session.userId);
  if ("error" in r) return { error: r.error };
  revalidatePath("/maintenance/pm");
  revalidatePath("/maintenance/work-orders");
  // ไปหน้าใบงานที่เพิ่งเปิดเลย — router.push ฝั่งหน้าเว็บโดนการรีเฟรชหลัง revalidate ทับ (เจอตอนทดสอบ)
  redirect(`/maintenance/work-orders/${r.id}`);
}
