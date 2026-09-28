import "server-only";
import { prisma } from "@smartboss/database";
import {
  nextDueAfterCompletion,
  toDateOnly,
} from "@/modules/maintenance/lib/pm-schedule";

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
  /** false = แผนนี้ไม่มีค่าใช้จ่าย — ใบงานที่สร้างตามรอบจะรับค่านี้ไปด้วย */
  requiresExpense?: boolean;
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
      requiresExpense: data.requiresExpense ?? true,
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

  // continuous / yearlyRounds: เลื่อนวันกำหนดถัดไป
  // กติกาการนับ (ปิดช้า = นับจากวันที่ทำจริง / ปิดก่อนกำหนด = นับจากวันกำหนด)
  // อยู่ใน nextDueAfterCompletion พร้อมเหตุผลของแต่ละข้อ
  const { nextDue, anchor } = nextDueAfterCompletion(pm, now);
  await prisma.pmSchedule.update({
    where: { id: pm.id },
    data: {
      lastCompletedDate: toDateOnly(now),
      nextDueDate: toDateOnly(nextDue),
      anchorDate: toDateOnly(anchor),
    },
  });
}

/**
 * ข้ามรอบ PM นี้ (ไม่นับว่าทำเสร็จ) — เรียกเมื่อใบงานที่ผูก PM ถูกยกเลิกหรือลบ
 *
 * เดิมมีแค่ "ปิดงาน" ที่เดิน PM ไปรอบถัดไป ยกเลิก/ลบใบงานไม่แตะ PM ⇒ PM ยังค้างที่วันเดิม
 * เช้าวันถัดมา cron (generateWorkOrdersForDuePms) เห็นว่าไม่มีใบงานเปิดอยู่ ก็สร้างใบงาน
 * อัตโนมัติใบเดิมขึ้นมาใหม่ ยกเลิกอีกก็มาอีกทุกวัน ("ดึงข้อมูลเก่ามาแสดงซ้ำ ๆ พวกใบงาน PM
 * อัตโนมัติ") — ข้ามรอบ = เลื่อนไปรอบถัดไปที่ยังไม่ถึง (ไม่บันทึก lastCompletedDate)
 *
 * แบบนับครั้ง (limitedCount): ไม่นับรอบ แต่กลับไป "รอนัดวัน" ให้คนตั้งวันใหม่เอง
 */
export async function skipPmSchedule(orgId: string, id: string) {
  const pm = await prisma.pmSchedule.findFirst({ where: { orgId, id } });
  if (!pm || !pm.isActive) return;

  if (pm.totalRounds != null) {
    await prisma.pmSchedule.update({ where: { id: pm.id }, data: { awaitingSchedule: true } });
    return;
  }

  // เดินไปทีละรอบจากวันกำหนดเดิม จนได้รอบที่ยังไม่ผ่าน (วันนี้หรืออนาคต)
  const today = toDateOnly(new Date());
  let cursor = { ...pm };
  let next = nextDueAfterCompletion(cursor, cursor.nextDueDate);
  for (let guard = 0; next.nextDue < today && guard < 400; guard++) {
    cursor = { ...cursor, nextDueDate: next.nextDue, anchorDate: next.anchor };
    next = nextDueAfterCompletion(cursor, cursor.nextDueDate);
  }
  await prisma.pmSchedule.update({
    where: { id: pm.id },
    data: { nextDueDate: toDateOnly(next.nextDue), anchorDate: toDateOnly(next.anchor) },
  });
}

export async function skipPmSchedulesByIds(orgId: string, ids: string[]) {
  for (const id of ids) await skipPmSchedule(orgId, id);
}

/** ปิดหลาย PM พร้อมกัน (ใบงานรวมหลาย PM — port จาก completePmSchedulesByIds) */
export async function completePmSchedulesByIds(orgId: string, ids: string[]) {
  for (const id of ids) await completePmSchedule(orgId, id);
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
