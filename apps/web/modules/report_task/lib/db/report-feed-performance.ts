import "server-only";
import { prisma } from "@smartboss/database";
import { Prisma } from "@prisma/client";
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
  newData: FeedSliceLike,
  removedBy: string | null
): Promise<void> {
  const oldPosts = oldData?.posts ?? [];
  const oldReactionById = new Map(
    oldPosts.flatMap((p) => (p.stickerReactions ?? []).map((r) => [r.id, { post: p, reaction: r }] as const))
  );
  const newReactionIds = new Set(
    (newData.posts ?? []).flatMap((p) => (p.stickerReactions ?? []).map((r) => r.id))
  );

  const additions: { post: PostLike; reaction: PostStickerReaction }[] = [];
  for (const post of newData.posts ?? []) {
    for (const reaction of post.stickerReactions ?? []) {
      if (!oldReactionById.has(reaction.id)) additions.push({ post, reaction });
    }
  }
  // ถูกลบไป — เคยอยู่ใน oldData แต่หายไปจาก newData แล้ว ("ให้กดยกเลิกได้ด้วย
  // สิ ถ้าแบบกดผิดหรือไม่ได้ตั้งใจ") ต้องหักคะแนนที่เคยให้ไปคืน ไม่ใช่แค่ซ่อน
  // แถวออกจากหน้าจอเฉยๆ — สร้าง event ตัวใหม่หักล้างของเดิม (ไม่ลบ event เก่า
  // ทิ้ง) เพื่อให้ประวัติ audit ยังอ่านย้อนได้ครบว่าเคยให้แล้วก็ยกเลิกทีหลัง
  const removals: { post: PostLike; reaction: PostStickerReaction }[] = [];
  for (const [id, entry] of oldReactionById) {
    if (!newReactionIds.has(id)) removals.push(entry);
  }

  if (additions.length === 0 && removals.length === 0) return;

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

  // ยกเลิกได้เฉพาะคนที่มีสิทธิ์ให้ตั้งแต่แรก (isOwner) — ตรวจจาก session.userId
  // ที่ route.ts ส่งมา (`removedBy`) ไม่ใช่จาก request body ที่แก้เองได้
  if (removedBy && owners.has(removedBy)) {
    for (const { post, reaction } of removals) {
      const points = pointsById.get(reaction.stickerId);
      if (points === undefined || points === 0) continue;
      const label = labelById.get(reaction.stickerId) ?? reaction.stickerId;
      events.push({
        orgId,
        userId: post.authorId,
        source: "report_task",
        category: "task_manual_dock",
        occurredAt: new Date(),
        points: -points,
        refType: "report_post_reaction_undo",
        refId: reaction.id,
        note: `ยกเลิก: ${label} · ${post.title}`,
        createdBy: removedBy,
      });
    }
  }

  if (events.length > 0) await recordPerformanceEvents(events);
}

interface RoundLike {
  id: string;
}
interface CutoffLike {
  id: string;
}
interface TopicRoundsLike {
  id: string;
  submissionRounds?: RoundLike[];
  cutoffs?: CutoffLike[];
}
interface ReportFeedTopicsSlice {
  topics?: TopicRoundsLike[];
}

function roundIdsByTopic(topics: TopicRoundsLike[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const t of topics) {
    const ids = new Set<string>();
    for (const r of t.submissionRounds ?? []) ids.add(r.id);
    for (const c of t.cutoffs ?? []) ids.add(c.id); // ห้องเก่า — id เดียวกับที่ effectiveRoundsOf สังเคราะห์เป็นรอบ
    map.set(t.id, ids);
  }
  return map;
}

/**
 * คืนคะแนนของ report_missed/report_late อัตโนมัติทันทีที่ "รอบส่ง" (หรือทั้งห้อง)
 * ที่เป็นต้นเรื่องถูกลบไปในการเซฟนี้ — ขนานกับ recordReportStickerEvents ข้างบน
 * (diff oldData/newData ก้อนเดียวกัน) ต่างกันแค่ทิศทาง: อันนั้นมองหา "ของใหม่ที่
 * เพิ่งเพิ่ม" ส่วนนี้มองหา "รอบที่เคยมีแต่หายไปแล้ว"
 *
 * ที่มา: sweep (report-penalty-sweep.ts) ตัดสินจากรอบที่ "มีอยู่ตอนนี้" เท่านั้น
 * — ลบรอบทิ้งแล้ว คะแนนที่เคยหักไปตอนรอบนั้นยังมีอยู่จะค้างติดลบถาวรไม่มีอะไร
 * คืนให้ (เจอจริงจากการใช้งาน) เดิมต้องรันสคริปต์แยก
 * (reconcile-orphan-report-penalty-events.ts, ยังเก็บไว้แก้ของเก่าที่ค้างมา
 * ก่อนไฟล์นี้จะมีอยู่) — จากนี้ไปจับที่นี่ทันทีตอนลบ ไม่ต้องรอใครมารันสคริปต์
 *
 * เจตนา: หักเฉพาะรอบที่ "มีอยู่จริงตอนนี้" เท่านั้น — รอบที่เคยใส่แล้วลบทิ้ง
 * ไม่ควรมีคะแนนติดค้างอยู่เลย เหมือนไม่เคยมีรอบนั้นอยู่ตั้งแต่แรก
 *
 * ใช้ `refId.contains(":${topicId}:${roundId}:")` แทนการ match ทั้งก้อน เพราะ
 * refId จริงมี day/userId ปนอยู่ด้วย (`${day}:${topicId}:${roundId}:${userId}`,
 * ดู report-penalty-sweep.ts) — เดินคิวรีแค่ตอนมีรอบถูกลบจริงเท่านั้น (ปกติ
 * diff ว่างเปล่าทุกครั้งที่เซฟ ไม่กระทบ perf ของการเซฟปกติ)
 */
export async function refundDeletedReportRoundEvents(
  orgId: string,
  oldData: ReportFeedTopicsSlice | null,
  newData: ReportFeedTopicsSlice
): Promise<void> {
  const oldTopics = oldData?.topics ?? [];
  if (oldTopics.length === 0) return;
  const newRoundsByTopic = roundIdsByTopic(newData.topics ?? []);

  const deletedRounds: { topicId: string; roundId: string }[] = [];
  for (const t of oldTopics) {
    const stillAlive = newRoundsByTopic.get(t.id); // undefined = ทั้งห้องถูกลบไปเลย
    const oldIds = new Set<string>();
    for (const r of t.submissionRounds ?? []) oldIds.add(r.id);
    for (const c of t.cutoffs ?? []) oldIds.add(c.id);
    for (const roundId of oldIds) {
      if (!stillAlive?.has(roundId)) deletedRounds.push({ topicId: t.id, roundId });
    }
  }
  if (deletedRounds.length === 0) return;

  const events = await prisma.performanceEvent.findMany({
    where: {
      orgId,
      source: "report_task",
      refType: "report_round",
      category: { in: ["report_missed", "report_late"] },
      OR: deletedRounds.map(({ topicId, roundId }) => ({ refId: { contains: `:${topicId}:${roundId}:` } })),
    },
    select: { userId: true, category: true, points: true, occurredAt: true, refId: true, createdBy: true },
  });
  if (events.length === 0) return;

  const undone = new Set(
    (
      await prisma.performanceEvent.findMany({
        where: {
          orgId,
          source: "report_task",
          refType: "report_round_undo",
          refId: { in: events.map((e) => e.refId!) },
        },
        select: { refId: true },
      })
    ).map((u) => u.refId)
  );
  const toRefund = events.filter((e) => e.refId && !undone.has(e.refId));
  if (toRefund.length === 0) return;

  await prisma.performanceEvent.createMany({
    data: toRefund.map((e) => ({
      orgId,
      userId: e.userId,
      source: "report_task" as const,
      category: e.category,
      points: new Prisma.Decimal(e.points).neg(),
      occurredAt: e.occurredAt,
      refType: "report_round_undo",
      refId: e.refId,
      note: "ยกเลิก (รอบส่ง/ห้องถูกลบ)",
      createdBy: e.createdBy,
    })),
    skipDuplicates: true,
  });
}
