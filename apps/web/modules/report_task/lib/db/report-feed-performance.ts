import "server-only";
import { recordPerformanceEvents, type PerformanceEventInput } from "@/lib/performance";
import { readStore } from "./org-store";
import { listDirectory } from "./employee-directory";
import { defaultStickers } from "../../data/stickers";
import type { Sticker } from "../../types";

interface PostStickerReaction {
  id: string;
  stickerId: string;
  byUserId: string;
  createdAt: string;
}
interface PostLike {
  id: string;
  title: string;
  authorId: string;
  stickerReactions?: PostStickerReaction[];
}
interface FeedSliceLike {
  posts?: PostLike[];
}

/**
 * แปลงสติกเกอร์ที่เพิ่งติดใหม่บนโพสต์รายงานให้เป็นคะแนนผลงานกลาง
 * (core.performance_events) — ขนานกับ recordStickerEvents ของ Kanban ใน
 * task-repo.ts เป๊ะ ๆ (แม้แต่ category ก็ใช้ "task_manual_dock" ตัวเดียวกัน
 * — เป็น "หักคะแนนโดยหัวหน้า" อยู่แล้ว ไม่ผูกกับคำว่า "งาน" ในความหมายที่
 * เจาะจงแค่ Kanban ใช้ค่า refType ที่ต่างกัน ("report_post_reaction" vs
 * "task_reaction") กันชนกันเองในตาราง performance_events) ต่างจาก Kanban
 * ตรงที่ให้คะแนนกับ**คนโพสต์**คนเดียว ("คนที่โพสต์รายงานนั้น") ไม่ใช่ทุกคนที่
 * รับผิดชอบร่วมแบบงาน — โพสต์มีเจ้าของเดียวเสมอ ไม่มีแนวคิด "รับผิดชอบร่วม"
 * แบบงาน
 *
 * report-feed เก็บเป็นก้อน JSON เดียว (ไม่ใช่ตารางแยกแถวแบบ Task) —
 * `oldData`/`newData` คือทั้งก้อนก่อน/หลังเขียน ต้อง diff เอาเฉพาะ reaction id
 * ที่เพิ่งโผล่มาใหม่ (ไม่เคยอยู่ใน oldData) กันหักคะแนนซ้ำทุกครั้งที่มีการ
 * PUT ก้อนข้อมูลทั้งหมด (ซึ่งเกิดบ่อยกว่า "มีสติกเกอร์ใหม่จริง ๆ" มาก)
 */
export async function recordReportStickerEvents(
  orgId: string,
  oldData: FeedSliceLike | null,
  newData: FeedSliceLike
): Promise<void> {
  const oldReactionIds = new Set(
    (oldData?.posts ?? []).flatMap((p) => (p.stickerReactions ?? []).map((r) => r.id))
  );
  const additions: { post: PostLike; reaction: PostStickerReaction }[] = [];
  for (const post of newData.posts ?? []) {
    for (const reaction of post.stickerReactions ?? []) {
      if (!oldReactionIds.has(reaction.id)) additions.push({ post, reaction });
    }
  }
  if (additions.length === 0) return;

  // เช่นเดียวกับ writeTasks — client PUT ก้อนข้อมูลทั้งหมด ปลอม reaction
  // แทนใครก็ได้ถ้าไม่เช็คซ้ำฝั่งเซิร์ฟเวอร์ (ปุ่มถูกซ่อนไว้ที่ UI เฉยๆ ไม่ใช่
  // การกันจริง) ยอมรับเฉพาะ reaction ที่ byUserId เป็นเจ้าของบริษัทจริงเท่านั้น
  const owners = new Set((await listDirectory(orgId)).filter((u) => u.isOwner).map((u) => u.id));

  const custom = await readStore<Sticker[]>(orgId, "stickers");
  const stickers = custom.data ?? defaultStickers;
  const pointsById = new Map(stickers.map((s) => [s.id, s.points] as const));
  const labelById = new Map(stickers.map((s) => [s.id, `${s.emoji} ${s.label}`] as const));

  const events: PerformanceEventInput[] = [];
  for (const { post, reaction } of additions) {
    if (!owners.has(reaction.byUserId)) continue;
    const points = pointsById.get(reaction.stickerId);
    if (points === undefined || points === 0) continue; // สติกเกอร์ 0 แต้ม ไม่มีผลกับเกรด
    const label = labelById.get(reaction.stickerId) ?? reaction.stickerId;
    const occurredAt = new Date(reaction.createdAt);
    events.push({
      orgId,
      userId: post.authorId,
      source: "report_task",
      category: "task_manual_dock",
      occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
      points,
      refType: "report_post_reaction",
      refId: reaction.id,
      note: `${label} · ${post.title}`,
      createdBy: reaction.byUserId,
    });
  }

  if (events.length > 0) await recordPerformanceEvents(events);
}
