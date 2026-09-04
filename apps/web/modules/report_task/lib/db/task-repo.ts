import "server-only";
import { prisma } from "@smartboss/database";

import { nextTaskCode } from "@/lib/document-code";
import { recordPerformanceEvents, type PerformanceEventInput } from "@/lib/performance";
import { defaultStickers } from "../../data/stickers";
import { readStore } from "./org-store";
import { listDirectory } from "./employee-directory";
import type { Sticker, Task, TaskReaction } from "../../types";

/**
 * งานในบอร์ด Kanban — เก็บเป็นตารางจริง หนึ่งแถวต่อหนึ่งงาน
 *
 * เดิมทั้งบริษัทอยู่ในก้อน JSON ก้อนเดียว (`report_task.stores` คีย์ "tasks")
 * ⇒ แก้ชื่องานตัวเดียวก็เขียนทับทั้งก้อน และฝั่งเซิร์ฟเวอร์ query อะไรไม่ได้เลย
 *
 * ── ทำไมสัญญากับ client ยังเป็น "ส่งมาทั้งชุด" ──
 * ฝั่ง client (zustand + TaskSync) ส่งงานทั้งคอลเลกชันมาทุกครั้ง ที่นี่จึงรับทั้งชุด
 * แล้วแปลงเป็น insert/update/delete รายแถวให้ — ได้ประโยชน์ของตารางโดยไม่ต้องรื้อ UI
 *
 * ถ้าวันหนึ่งอยากให้ประหยัดกว่านี้ (ส่งเฉพาะงานที่เปลี่ยน) ต้องแก้ทั้ง TaskSync
 * ฝั่ง client และ route นี้พร้อมกัน — ตอนนี้ทำได้แล้วเพราะ UI อยู่ใน repo เดียวกัน
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

/**
 * แปลงสติกเกอร์ที่เพิ่งติดใหม่บนงานให้เป็นคะแนนผลงานกลาง (core.performance_events)
 *
 * เดิมสติกเกอร์หักคะแนนแค่ในหน้ารายงานของโมดูลนี้เอง (lib/reports.ts) — ไม่เคย
 * เขียนลง core.performance_events เลย ⇒ หัวหน้ากด "หัวร้อน" ไปแล้วไม่มีผลกับ
 * เกรดรวมของพนักงานที่หน้า HR/admin เห็นกันเลย ทั้งที่ "หักคะแนนโดยหัวหน้า"
 * เป็นหนึ่งในหมวดของระบบเกรดกลางอยู่แล้ว (ดู PERFORMANCE_CATEGORIES.task_manual_dock)
 *
 * ให้คะแนนทุกคนที่เป็น assignee ของงานนั้นเท่ากัน ไม่แยกว่าใครทำผิด — งาน
 * มอบหมายร่วมกันหลายคนอยู่แล้วเป็นส่วนน้อย และ lib/reports.ts ก็นับแบบนี้
 * มาตั้งแต่ต้น (สติกเกอร์หนึ่งอันมีผลกับ "งาน" ไม่ได้เจาะจงคนในกลุ่ม)
 *
 * refId ผูกทั้ง reaction id และ userId เข้าด้วยกัน — unique constraint ของ
 * ตาราง (orgId, source, category, refType, refId) ไม่มี userId อยู่ในนั้น
 * ถ้าใช้ reaction id เฉยๆ คนที่สองในกลุ่มจะโดน skipDuplicates ทิ้งไปเงียบๆ
 */
async function recordStickerEvents(
  orgId: string,
  changes: { task: Task; newReactions: TaskReaction[] }[],
): Promise<void> {
  if (changes.length === 0) return;

  const custom = await readStore<Sticker[]>(orgId, "stickers");
  const stickers = custom.data ?? defaultStickers;
  const pointsById = new Map(stickers.map((s) => [s.id, s.points] as const));
  const labelById = new Map(stickers.map((s) => [s.id, `${s.emoji} ${s.label}`] as const));

  const events: PerformanceEventInput[] = [];
  for (const { task, newReactions } of changes) {
    for (const reaction of newReactions) {
      const points = pointsById.get(reaction.stickerId);
      if (points === undefined || points === 0) continue; // สติกเกอร์ที่ตั้งไว้ 0 แต้ม (เช่น "ด่วนมาก") ไม่มีผลกับเกรด
      const label = labelById.get(reaction.stickerId) ?? reaction.stickerId;
      const occurredAt = new Date(reaction.createdAt);

      for (const assigneeId of task.assigneeIds) {
        events.push({
          orgId,
          userId: assigneeId,
          source: "report_task",
          category: "task_manual_dock",
          occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
          points,
          refType: "task_reaction",
          refId: `${reaction.id}:${assigneeId}`,
          note: `${label} · ${task.title}`,
          createdBy: reaction.byUserId,
        });
      }
    }
  }

  if (events.length > 0) await recordPerformanceEvents(events);
}

/** เลขรุ่นของคอลเลกชันอย่างเดียว ไม่แตะตาราง reportTask เลย (R1) — สำหรับ poll
 * ที่แค่อยากรู้ "มีอะไรเปลี่ยนไหม" ก่อนค่อยดึงทั้งก้อนจริงถ้าเปลี่ยน แทนที่จะ
 * SELECT งานทั้งบริษัท (รวม comments/checklist/revisions/attachment) ทุก
 * ครั้งที่ poll ซึ่งหนักบน VM เดียวเมื่อมีหลายแท็บเปิดพร้อมกัน */
export async function readTasksVersion(orgId: string): Promise<number> {
  const meta = await prisma.reportTaskCollection.findUnique({ where: { orgId } });
  return meta?.version ?? 0;
}

/** อ่านงานทั้งหมดของบริษัท พร้อมเลขรุ่นของคอลเลกชัน */
export async function readTasks(orgId: string): Promise<TaskCollection> {
  const [rows, meta] = await Promise.all([
    prisma.reportTask.findMany({
      where: { orgId },
      // เรียงตามวันสร้างให้ผลลัพธ์คงที่ — client จัดเรียงเองอีกทีตามคอลัมน์ที่เลือก
      orderBy: { createdAt: "asc" },
      select: { data: true, code: true },
    }),
    prisma.reportTaskCollection.findUnique({ where: { orgId } }),
  ]);

  // code มาจากคอลัมน์จริง ไม่ใช่ก้อน data — merge เข้าไปให้ client เห็นเสมอ แม้
  // ก้อน data เดิม (บันทึกไว้ก่อนมีฟีเจอร์นี้) จะไม่มี field นี้อยู่
  return {
    tasks: rows.map((r) => ({ ...(r.data as unknown as Task), code: r.code })),
    version: meta?.version ?? 0,
  };
}

export type WriteResult =
  | { ok: true; version: number; created: number; updated: number; deleted: number; codes: Record<string, string> }
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
  const stickerChanges: { task: Task; newReactions: TaskReaction[] }[] = [];

  // R4 — gating the sticker picker in the UI stops a normal click, but Task
  // writes the whole collection in one PUT: a client that just edits the
  // request body could hand-craft a reaction for anyone. Fetched lazily (at
  // most once per call) since most saves touch no reactions at all — no
  // reason to query the directory on every single-field task edit.
  let ownerIdsPromise: Promise<Set<string>> | null = null;
  function ownerIds(): Promise<Set<string>> {
    if (!ownerIdsPromise) {
      ownerIdsPromise = listDirectory(orgId).then((users) => new Set(users.filter((u) => u.isOwner).map((u) => u.id)));
    }
    return ownerIdsPromise;
  }

  const result = await prisma.$transaction(async (tx) => {
    const meta = await tx.reportTaskCollection.findUnique({ where: { orgId } });
    const current = meta?.version ?? 0;
    if (expectedVersion !== null && expectedVersion !== current) {
      return { ok: false as const, currentVersion: current };
    }

    // งานที่มีอยู่แล้ว — เก็บ code ไว้ให้คงเดิม ไม่ออกเลขใหม่ทุกครั้งที่แก้
    // ก้อน data เดิมก็ต้องอ่านมาด้วย เพื่อเทียบว่ามีสติกเกอร์ที่เพิ่งติดใหม่ไหม
    const existing = await tx.reportTask.findMany({
      where: { orgId },
      select: { id: true, code: true, data: true },
    });
    const codeById = new Map(existing.map((r) => [r.id, r.code]));
    const priorById = new Map(existing.map((r) => [r.id, r.data as unknown as Task]));
    const incomingIds = new Set(tasks.map((t) => t.id));

    let created = 0;
    let updated = 0;
    // Returned to the client so a just-created task shows its code
    // immediately, without waiting for the next full reload (TaskSync's
    // write-through never re-fetches on a plain success — see task-sync.tsx).
    const codes: Record<string, string> = {};

    for (let task of tasks) {
      // เทียบกับก้อนเดิมด้วย reaction id — อันที่ไม่เคยเห็นมาก่อนคือสติกเกอร์
      // ที่เพิ่งติดในคำขอนี้ (ทั้งงานเก่าที่แก้ และงานใหม่ที่ยังไม่เคยมีแถวเดิม)
      const priorReactionIds = new Set((priorById.get(task.id)?.reactions ?? []).map((r) => r.id));
      let newReactions = (task.reactions ?? []).filter((r) => !priorReactionIds.has(r.id));

      // R4 — ปฏิเสธเฉพาะ reaction ใหม่ที่คนติดไม่ใช่เจ้าของ (คง reaction เดิม
      // + ฟิลด์อื่นของงานไว้ทั้งหมด ไม่ทำทั้ง request พัง)
      if (newReactions.length > 0) {
        const owners = await ownerIds();
        const rejected = newReactions.filter((r) => !owners.has(r.byUserId));
        if (rejected.length > 0) {
          const rejectedIds = new Set(rejected.map((r) => r.id));
          task = { ...task, reactions: (task.reactions ?? []).filter((r) => !rejectedIds.has(r.id)) };
          newReactions = newReactions.filter((r) => !rejectedIds.has(r.id));
        }
      }
      if (newReactions.length > 0) stickerChanges.push({ task, newReactions });

      const cols = columnsOf(task);
      const known = codeById.get(task.id);

      if (known) {
        await tx.reportTask.update({
          where: { orgId_id: { orgId, id: task.id } },
          data: cols,
        });
        codes[task.id] = known;
        updated += 1;
      } else {
        // จองเลขในทรานแซกชันเดียวกับการสร้าง — แยกกันแล้วถ้าล้มทีหลัง
        // เลขจะถูกกินไปเปล่า ๆ เกิดช่องว่างที่คนอ่านนึกว่างานหาย
        const code = await nextTaskCode(tx, orgId);
        await tx.reportTask.create({
          data: { orgId, id: task.id, code, ...cols },
        });
        codes[task.id] = code;
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
      codes,
    };
  });

  // ทำหลัง transaction ของ report_task จบแล้ว — core.performance_events เป็นคนละ
  // schema เขียนผ่าน prisma client ตัวหลัก ไม่ใช่ tx ของธุรกรรมนี้ ผูกกันไม่ได้
  // จริง ๆ อยู่แล้ว (เหมือน cron.ts ที่หักคะแนน PM/ใบงานเป็นขั้นแยกต่างหาก)
  if (result.ok) await recordStickerEvents(orgId, stickerChanges);

  return result;
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
