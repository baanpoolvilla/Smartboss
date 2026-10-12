import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@smartboss/database";
import { recordPerformanceEvents } from "@/lib/performance";
import { createStoreIfAbsent, readStore, writeStore } from "./org-store";
import { listDirectory } from "./employee-directory";
import { defaultStickers } from "../../data/stickers";
import type { Sticker } from "../../types";
import type { WorkOrderReaction } from "../maintenance-board";

/**
 * สติกเกอร์บนการ์ดใบงานซ่อมในบอร์ดงาน ("แค่ให้มาแสดงและหักคะแนนใส่สติกเกอร์ได้ จะทำอะไรให้กดไปใน
 * แจ้งซ่อมเหมือนเดิม") — ชุดสติกเกอร์เดียวกับงาน คะแนนเข้า **ผู้รับผิดชอบใบงาน** คนเดียว
 *
 * เก็บเป็นก้อนเดียวใน report_task.stores คีย์ WO_REACTIONS_KEY — ไม่ต้องมีตารางใหม่/migration
 * คีย์นี้ **ไม่อยู่ใน whitelist** ของ /api/report-task/store (store-registry.ts) โดยตั้งใจ
 * แก้ได้เฉพาะผ่าน addWorkOrderReaction/removeWorkOrderReaction ที่ตรวจสิทธิ์เอง
 * (แบบเดียวกับ report-penalty-requests) ไม่งั้นใครก็ PUT ปลอมสติกเกอร์ได้
 *
 * คะแนนลง core.performance_events แบบเดียวกับสติกเกอร์บนงาน/โพสต์ (task-repo.ts,
 * report-feed-performance.ts): category "task_manual_dock" ("หักคะแนนโดยหัวหน้า"),
 * refType "work_order_reaction" ไม่ชนกับของงาน · ยกเลิก = event หักล้าง ("…_undo") ลงวันเดิม
 */
export const WO_REACTIONS_KEY = "work-order-reactions";

interface WoReactionStore {
  reactions: WorkOrderReaction[];
}

export async function listWorkOrderReactions(orgId: string): Promise<WorkOrderReaction[]> {
  const { data } = await readStore<WoReactionStore>(orgId, WO_REACTIONS_KEY);
  return data?.reactions ?? [];
}

/** แก้ก้อนแบบกันเขียนทับกัน — คนสองคนกดพร้อมกัน อีกคนอ่านใหม่แล้วลองซ้ำ */
async function mutate(
  orgId: string,
  userId: string,
  fn: (list: WorkOrderReaction[]) => WorkOrderReaction[]
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, version } = await readStore<WoReactionStore>(orgId, WO_REACTIONS_KEY);
    const next = fn(data?.reactions ?? []);
    const res =
      version === 0
        ? await createStoreIfAbsent(orgId, WO_REACTIONS_KEY, { reactions: next }, userId)
        : await writeStore(orgId, WO_REACTIONS_KEY, { reactions: next }, version, userId);
    if (res.ok) return;
  }
  throw new Error("บันทึกสติกเกอร์ไม่สำเร็จ มีคนแก้พร้อมกัน — ลองใหม่อีกครั้ง");
}

async function stickerById(orgId: string, stickerId: string): Promise<Sticker | undefined> {
  const custom = await readStore<Sticker[]>(orgId, "stickers");
  return (custom.data ?? defaultStickers).find((s) => s.id === stickerId);
}

async function isOwner(orgId: string, userId: string): Promise<boolean> {
  return (await listDirectory(orgId)).some((u) => u.id === userId && u.isOwner);
}

export class ReactionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function addWorkOrderReaction(
  orgId: string,
  byUserId: string,
  workOrderId: string,
  stickerId: string
): Promise<WorkOrderReaction> {
  // เหมือนงาน: ให้คะแนนได้เฉพาะคนที่ติ๊ก "เจ้าของ/หัวหน้า" ในรายชื่อพนักงาน (task-repo.ts R4)
  if (!(await isOwner(orgId, byUserId))) throw new ReactionError("เฉพาะหัวหน้า/ผู้จัดการที่ให้สติกเกอร์ได้", 403);
  const sticker = await stickerById(orgId, stickerId);
  if (!sticker) throw new ReactionError("ไม่พบสติกเกอร์นี้", 400);
  const wo = await prisma.workOrder.findFirst({
    where: { orgId, id: workOrderId },
    select: { id: true, code: true, title: true, assignedTo: true, status: true },
  });
  if (!wo || wo.status === "cancelled") throw new ReactionError("ไม่พบใบงานนี้", 404);
  // คะแนนต้องมีเจ้าของ — ใบที่ยังไม่มีผู้รับผิดชอบ ไม่โยนไปหักคนเปิดใบแทน
  if (!wo.assignedTo) throw new ReactionError("ใบงานนี้ยังไม่มีผู้รับผิดชอบ — มอบหมายในแจ้งซ่อมก่อน", 400);

  const reaction: WorkOrderReaction = {
    id: randomUUID(),
    workOrderId: wo.id,
    stickerId: sticker.id,
    byUserId,
    targetUserId: wo.assignedTo,
    createdAt: new Date().toISOString(),
  };
  await mutate(orgId, byUserId, (list) => [...list, reaction]);

  if (sticker.points !== 0) {
    await recordPerformanceEvents([
      {
        orgId,
        userId: wo.assignedTo,
        source: "report_task",
        category: "task_manual_dock",
        occurredAt: new Date(reaction.createdAt),
        points: sticker.points,
        refType: "work_order_reaction",
        refId: reaction.id,
        note: `${sticker.emoji} ${sticker.label} · ${wo.code} ${wo.title}`,
        createdBy: byUserId,
      },
    ]);
  }
  return reaction;
}

/** ยกเลิกสติกเกอร์ (กดผิด) — คืนคะแนนลงวันเดิม · ยกเลิกได้เฉพาะหัวหน้าเหมือนตอนให้ */
export async function removeWorkOrderReaction(orgId: string, byUserId: string, reactionId: string): Promise<void> {
  if (!(await isOwner(orgId, byUserId))) throw new ReactionError("เฉพาะหัวหน้า/ผู้จัดการที่ยกเลิกสติกเกอร์ได้", 403);
  let removed: WorkOrderReaction | undefined;
  await mutate(orgId, byUserId, (list) => {
    removed = list.find((r) => r.id === reactionId);
    return list.filter((r) => r.id !== reactionId);
  });
  if (!removed) return;

  const original = await prisma.performanceEvent.findFirst({
    where: { orgId, source: "report_task", category: "task_manual_dock", refType: "work_order_reaction", refId: removed.id },
    select: { occurredAt: true, points: true, userId: true, note: true },
  });
  if (!original || !original.points) return; // 0 แต้ม / ไม่เคยถูกบันทึก = ไม่มีอะไรต้องคืน
  await recordPerformanceEvents([
    {
      orgId,
      userId: original.userId,
      source: "report_task",
      category: "task_manual_dock",
      occurredAt: original.occurredAt,
      points: -Number(original.points),
      refType: "work_order_reaction_undo",
      refId: removed.id,
      note: `ยกเลิก: ${original.note ?? ""}`,
      createdBy: byUserId,
    },
  ]);
}
