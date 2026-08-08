import "server-only";
import { prisma } from "@smartboss/database";
import { nextDueSlot, toDateOnly } from "@/modules/maintenance/lib/pm-schedule";

export interface PmInput {
  propertyId: string;
  assetId?: string | null;
  title: string;
  description?: string | null;
  frequency: string;
  nextDueDate: Date;
  anchorDate?: Date | null;
  roundsPerYear?: number | null;
  totalRounds?: number | null;
  assignedTo?: string | null;
  ccUserIds?: string[];
  createdBy?: string | null;
}

export function createPmSchedule(orgId: string, data: PmInput) {
  return prisma.pmSchedule.create({
    data: {
      orgId,
      propertyId: data.propertyId,
      assetId: data.assetId ?? null,
      title: data.title,
      description: data.description ?? null,
      frequency: data.frequency,
      nextDueDate: toDateOnly(data.nextDueDate),
      anchorDate: toDateOnly(data.anchorDate ?? data.nextDueDate),
      roundsPerYear: data.roundsPerYear ?? null,
      totalRounds: data.totalRounds ?? null,
      assignedTo: data.assignedTo ?? null,
      ccUserIds: data.ccUserIds ?? [],
      createdBy: data.createdBy ?? null,
    },
  });
}

export async function updatePmSchedule(
  orgId: string,
  id: string,
  data: Partial<PmInput>
) {
  await prisma.pmSchedule.updateMany({ where: { orgId, id }, data });
}

export async function deletePmSchedule(orgId: string, id: string) {
  await prisma.pmSchedule.deleteMany({ where: { orgId, id } });
}

/**
 * PM เสร็จ 1 รอบ → เลื่อน/นับ/ปิด ตามโหมด (port จาก completePmScheduleById)
 */
export async function completePmSchedule(orgId: string, id: string) {
  const pm = await prisma.pmSchedule.findFirst({ where: { orgId, id } });
  if (!pm) return;
  const now = new Date();

  // limitedCount: นับครั้ง → รอนัดวันถัดไป / ครบแล้วปิด
  if (pm.totalRounds != null) {
    const done = (pm.roundsDone ?? 0) + 1;
    const finished = done >= pm.totalRounds;
    await prisma.pmSchedule.update({
      where: { id: pm.id },
      data: {
        lastCompletedDate: toDateOnly(now),
        roundsDone: done,
        awaitingSchedule: !finished,
        isActive: !finished,
      },
    });
    return;
  }

  // continuous / yearlyRounds: เลื่อนวันกำหนดถัดไป (ยึด anchor)
  const anchor = pm.anchorDate ?? pm.nextDueDate;
  const nextDue = nextDueSlot(anchor, pm.frequency, pm.roundsPerYear, now);
  await prisma.pmSchedule.update({
    where: { id: pm.id },
    data: { lastCompletedDate: toDateOnly(now), nextDueDate: toDateOnly(nextDue) },
  });
}

/** ปิดหลาย PM พร้อมกัน (ใบงานรวมหลาย PM — port จาก completePmSchedulesByIds) */
export async function completePmSchedulesByIds(orgId: string, ids: string[]) {
  for (const id of ids) await completePmSchedule(orgId, id);
}

/** ปิดทุก PM ของอุปกรณ์ (fallback เมื่อใบงานไม่ได้ผูก PM ตรง ๆ) */
export async function completePmSchedulesForAsset(orgId: string, assetId: string) {
  const rows = await prisma.pmSchedule.findMany({
    where: { orgId, assetId, isActive: true },
    select: { id: true },
  });
  for (const r of rows) await completePmSchedule(orgId, r.id);
}

/** PM แรกของอุปกรณ์ — ใช้เติม pmScheduleId ให้ฟอร์มค่าใช้จ่ายอัตโนมัติ */
export async function getPmScheduleIdForAsset(
  orgId: string,
  assetId: string
): Promise<string | null> {
  const pm = await prisma.pmSchedule.findFirst({
    where: { orgId, assetId, isActive: true },
    select: { id: true },
    orderBy: { nextDueDate: "asc" },
  });
  return pm?.id ?? null;
}

/** นัดวันครั้งถัดไปของ PM แบบจำกัดจำนวนครั้ง (ปลด awaiting) */
export async function schedulePmNextVisit(
  orgId: string,
  id: string,
  date: Date
) {
  await prisma.pmSchedule.updateMany({
    where: { orgId, id },
    data: { nextDueDate: toDateOnly(date), awaitingSchedule: false },
  });
}

export function listPmSchedules(
  orgId: string,
  filter: { propertyId?: string; assetId?: string } = {}
) {
  return prisma.pmSchedule.findMany({
    where: {
      orgId,
      isActive: true,
      ...(filter.propertyId ? { propertyId: filter.propertyId } : {}),
      ...(filter.assetId ? { assetId: filter.assetId } : {}),
    },
    orderBy: { nextDueDate: "asc" },
  });
}

/** PM schedules ของอุปกรณ์ (ใช้แสดงในหน้า asset detail) — M4 จะขยายส่วนจัดการเต็ม */
export function listPmForAsset(orgId: string, assetId: string) {
  return prisma.pmSchedule.findMany({
    where: { orgId, assetId, isActive: true },
    orderBy: { nextDueDate: "asc" },
  });
}

export function listPmForProperty(orgId: string, propertyId: string) {
  return prisma.pmSchedule.findMany({
    where: { orgId, propertyId, isActive: true },
    orderBy: { nextDueDate: "asc" },
  });
}

export function getPmSchedule(orgId: string, id: string) {
  return prisma.pmSchedule.findFirst({ where: { orgId, id } });
}

/** PM ที่ยังใช้งาน (สำหรับ dropdown ในฟอร์มค่าใช้จ่าย) */
export function listActivePmSchedules(orgId: string) {
  return prisma.pmSchedule.findMany({
    where: { orgId, isActive: true },
    orderBy: { nextDueDate: "asc" },
  });
}
