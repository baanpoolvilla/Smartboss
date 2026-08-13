"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import {
  createPmSchedule,
  completePmSchedule,
  deletePmSchedule,
  schedulePmNextVisit,
  updatePmSchedule,
} from "@/modules/maintenance/data/pm";
import { getAsset } from "@/modules/maintenance/data/assets";
import { roundsPerYearOptions } from "@/modules/maintenance/lib/pm-schedule";

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
  const description = String(formData.get("description") ?? "").trim();
  const assignedTo = String(formData.get("assignedTo") ?? "").trim();

  await updatePmSchedule(orgId, id, {
    ...(title ? { title } : {}),
    ...(frequency ? { frequency } : {}),
    ...(nextDueDate
      ? { nextDueDate: parseDate(nextDueDate), anchorDate: parseDate(nextDueDate) }
      : {}),
    // ช่องนี้อยู่ในฟอร์มเสมอ ค่าว่าง = ตั้งใจถอนมอบหมาย ไม่ใช่ "ไม่ได้ส่งมา"
    assignedTo: assignedTo || null,
    // มีผลกับใบงานที่ระบบสร้างหลังจากนี้เท่านั้น — ใบที่เปิดค้างอยู่เก็บค่าของตัวเองไว้แล้ว
    requiresExpense: formData.get("noExpense") !== "1",
    description: description || null,
  });

  revalidatePath("/maintenance/pm");
}

export async function completePmAction(formData: FormData) {
  const orgId = await requirePmManage();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await completePmSchedule(orgId, id);
  revalidatePath("/maintenance/pm");
}

export async function scheduleNextAction(formData: FormData) {
  const orgId = await requirePmManage();
  const id = String(formData.get("id") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!id || !date) return;
  await schedulePmNextVisit(orgId, id, parseDate(date));
  revalidatePath("/maintenance/pm");
}

export async function deletePmAction(formData: FormData) {
  const orgId = await requirePmManage();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deletePmSchedule(orgId, id);
  revalidatePath("/maintenance/pm");
}
