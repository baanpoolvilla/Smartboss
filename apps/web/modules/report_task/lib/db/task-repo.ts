import "server-only";
import { prisma } from "@smartboss/database";

import { nextTaskCode } from "@/lib/document-code";
import type { Task } from "../../types";

/**
 * งานในบอร์ด Kanban — เก็บเป็นตารางจริง หนึ่งแถวต่อหนึ่งงาน
 *
 * เดิมทั้งบริษัทอยู่ในก้อน JSON ก้อนเดียว (`report_task.stores` คีย์ "tasks")
 * ⇒ แก้ชื่องานตัวเดียวก็เขียนทับทั้งก้อน และฝั่งเซิร์ฟเวอร์ query อะไรไม่ได้เลย
 *
 * ── ทำไมสัญญากับ client ยังเป็น "ส่งมาทั้งชุด" ──
 * UI เป็นของ repo ต้นทาง (easyboss-workspace) ที่ตกลงกันว่าห้ามแก้ที่นี่
 * มันส่งงานทั้งคอลเลกชันมาทุกครั้งอยู่แล้ว ที่นี่จึงรับทั้งชุดแล้วแปลงเป็น
 * insert/update/delete รายแถวให้ — ประโยชน์ของตารางได้ครบโดยไม่ต้องแตะ UI
 *
 * `data` เก็บตัวงานทั้งก้อนเป็นแหล่งความจริง ส่วนคอลัมน์อื่นเป็นสำเนาที่คัดออกมา
 * ให้ query ได้ — เขียนจากฟังก์ชันเดียวในไฟล์นี้เสมอ จึงไม่มีทางไม่ตรงกัน
 */

/** client ภายใน transaction ของ Prisma */
type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** คอลัมน์ที่คัดจากตัวงานเพื่อให้ query ได้ — จุดเดียวที่กำหนดการคัด */
function columnsOf(task: Task) {
  return {
    title: task.title ?? "",
    status: task.status,
    priority: task.priority,
    taskMode: task.taskMode,
    assignedById: task.assignedById ?? "",
    assigneeIds: task.assigneeIds ?? [],
    parentId: task.parentId ?? null,
    startDate: task.startDate ?? "",
    dueDate: task.dueDate ?? "",
    completedAt: task.completedAt ?? null,
    data: task as unknown as object,
  };
}

export interface TaskCollection {
  tasks: Task[];
  version: number;
}

/** อ่านงานทั้งหมดของบริษัท พร้อมเลขรุ่นของคอลเลกชัน */
export async function readTasks(orgId: string): Promise<TaskCollection> {
  const [rows, meta] = await Promise.all([
    prisma.reportTask.findMany({
      where: { orgId },
      // เรียงตามวันสร้างให้ผลลัพธ์คงที่ — client จัดเรียงเองอีกทีตามคอลัมน์ที่เลือก
      orderBy: { createdAt: "asc" },
      select: { data: true },
    }),
    prisma.reportTaskCollection.findUnique({ where: { orgId } }),
  ]);

  return {
    tasks: rows.map((r) => r.data as unknown as Task),
    version: meta?.version ?? 0,
  };
}

export type WriteResult =
  | { ok: true; version: number; created: number; updated: number; deleted: number }
  | { ok: false; currentVersion: number };

/**
 * เขียนงานทั้งชุด — แปลงเป็น insert/update/delete รายแถวใน transaction เดียว
 *
 * `expectedVersion` = เลขรุ่นที่ client เห็นตอนโหลด ถ้าไม่ตรงแปลว่ามีคนอื่น
 * เขียนแทรกไปแล้ว ⇒ ปฏิเสธ (409) ให้ client โหลดใหม่ ไม่งั้นสองแท็บทับกันเงียบ ๆ
 * ส่ง null มาได้เมื่อ client ยอมรับว่าจะเขียนทับ (เช่นตอนกู้ข้อมูล)
 */
export async function writeTasks(
  orgId: string,
  tasks: Task[],
  expectedVersion: number | null,
  userId: string | null
): Promise<WriteResult> {
  return prisma.$transaction(async (tx) => {
    const meta = await tx.reportTaskCollection.findUnique({ where: { orgId } });
    const current = meta?.version ?? 0;
    if (expectedVersion !== null && expectedVersion !== current) {
      return { ok: false as const, currentVersion: current };
    }

    // งานที่มีอยู่แล้ว — เก็บ code ไว้ให้คงเดิม ไม่ออกเลขใหม่ทุกครั้งที่แก้
    const existing = await tx.reportTask.findMany({
      where: { orgId },
      select: { id: true, code: true },
    });
    const codeById = new Map(existing.map((r) => [r.id, r.code]));
    const incomingIds = new Set(tasks.map((t) => t.id));

    let created = 0;
    let updated = 0;

    for (const task of tasks) {
      const cols = columnsOf(task);
      const known = codeById.get(task.id);
      if (known) {
        await tx.reportTask.update({
          where: { orgId_id: { orgId, id: task.id } },
          data: cols,
        });
        updated += 1;
      } else {
        // จองเลขในทรานแซกชันเดียวกับการสร้าง — แยกกันแล้วถ้าล้มทีหลัง
        // เลขจะถูกกินไปเปล่า ๆ เกิดช่องว่างที่คนอ่านนึกว่างานหาย
        await tx.reportTask.create({
          data: { orgId, id: task.id, code: await nextTaskCode(tx, orgId), ...cols },
        });
        created += 1;
      }
    }

    const removed = existing.filter((r) => !incomingIds.has(r.id)).map((r) => r.id);
    if (removed.length > 0) {
      await tx.reportTask.deleteMany({ where: { orgId, id: { in: removed } } });
    }

    const next = current + 1;
    await tx.reportTaskCollection.upsert({
      where: { orgId },
      update: { version: next, updatedBy: userId },
      create: { orgId, version: next, updatedBy: userId },
    });

    return {
      ok: true as const,
      version: next,
      created,
      updated,
      deleted: removed.length,
    };
  });
}

/** ล้างงานทั้งหมดของบริษัท — ใช้ตอนรีเซ็ตข้อมูลเท่านั้น */
export async function clearTasks(orgId: string): Promise<void> {
  await prisma.$transaction(async (tx: PrismaTx) => {
    await tx.reportTask.deleteMany({ where: { orgId } });
    await tx.reportTaskCollection.upsert({
      where: { orgId },
      update: { version: { increment: 1 } },
      create: { orgId, version: 1 },
    });
  });
}
