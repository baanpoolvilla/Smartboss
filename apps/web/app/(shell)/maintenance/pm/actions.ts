"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission, audit } from "@smartboss/auth";
import { prisma } from "@smartboss/database";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import {
  createPmSchedule,
  closeAutoWorkOrdersOfPm,
  completePmSchedule,
  deletePmSchedule,
  schedulePmNextVisit,
  updatePmSchedule,
} from "@/modules/maintenance/data/pm";
import { getAsset } from "@/modules/maintenance/data/assets";
import { roundsPerYearOptions } from "@/modules/maintenance/lib/pm-schedule";
import { deleteNotificationsByReference } from "@/modules/maintenance/data/notify";
import { isPastDay } from "@/modules/maintenance/lib/no-past-date";

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
  assignedTo: z.string().optional(),
});

/**
 * สร้าง PM — เลือกอุปกรณ์ได้หลายชิ้นพร้อมกัน (1 อุปกรณ์ = 1 แผน)
 * ตรงกับ _showCreatePmDialog + createPmSchedulesBatch ของเดิม
 */
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
    ccUserIds,
    createdBy: session.userId,
  };

  if (assetIds.length > 0) {
    // 1 แผนต่อ 1 อุปกรณ์ — บ้านยึดตามอุปกรณ์ที่เลือก
    for (const assetId of assetIds) {
      const asset = await getAsset(orgId, assetId);
      if (!asset) continue;
      await createPmSchedule(orgId, {
        ...base,
        propertyId: asset.propertyId,
        assetId,
      });
    }
  } else {
    await createPmSchedule(orgId, {
      ...base,
      propertyId: d.propertyId,
      assetId: d.assetId || null,
    });
  }

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
  const dueChanged =
    !!nextDueDate && (originalNextDueDate === null || nextDueDate !== String(originalNextDueDate).trim());
  // เลื่อนวันกำหนดไปอยู่ในอดีตไม่ได้ (วันเดิมที่เลยไปแล้วส่งกลับมาเหมือนเดิมได้ — dueChanged = false)
  if (dueChanged && isPastDay(nextDueDate)) throw new Error("วันกำหนดถัดไปย้อนหลังไม่ได้");
  const description = String(formData.get("description") ?? "").trim();
  const assignedTo = String(formData.get("assignedTo") ?? "").trim();
  const before = await prisma.pmSchedule.findFirst({
    where: { orgId, id },
    select: { nextDueDate: true, frequency: true, assignedTo: true },
  });

  await updatePmSchedule(orgId, id, {
    ...(title ? { title } : {}),
    ...(frequency ? { frequency } : {}),
    ...(dueChanged
      ? { nextDueDate: parseDate(nextDueDate), anchorDate: parseDate(nextDueDate) }
      : {}),
    // ช่องนี้อยู่ในฟอร์มเสมอ ค่าว่าง = ตั้งใจถอนมอบหมาย ไม่ใช่ "ไม่ได้ส่งมา"
    assignedTo: assignedTo || null,
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

  revalidatePath("/maintenance/pm");
}

export async function completePmAction(formData: FormData) {
  const orgId = await requirePmManage();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await completePmSchedule(orgId, id);
  await closeAutoWorkOrdersOfPm(orgId, id, "done");
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
  revalidatePath("/maintenance/pm");
}

export async function deletePmAction(formData: FormData) {
  const orgId = await requirePmManage();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await closeAutoWorkOrdersOfPm(orgId, id, "cancelled");
  await deletePmSchedule(orgId, id);
  revalidatePath("/maintenance/work-orders");
  // referenceId ของแจ้งเตือน "pm" ยังคือ pm.id เดิม (ดู cron.ts's
  // notifyDuePmSchedules) แม้ลิงก์จะพาไปหน้ารายการรวมเสมอ (maintenanceHrefFor
  // ไม่ได้ใช้ referenceId ของ "pm") ไม่ลบก็ไม่ถึงกับลิงก์พัง แต่ข้อความจะค้าง
  // พูดถึงแผนที่ไม่มีอยู่แล้ว — เก็บกวาดไปด้วยกันเลย (ดู
  // deleteNotificationsByReference's doc)
  await deleteNotificationsByReference(id, "pm");
  revalidatePath("/maintenance/pm");
}
