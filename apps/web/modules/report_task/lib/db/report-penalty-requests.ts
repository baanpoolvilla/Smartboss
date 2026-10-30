import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@smartboss/database";
import { readStore, writeStore } from "./org-store";
import { penaltyRequestOpen, retroSubmitDeadline } from "../penalty-request-window";
import type { ScorePeriodConfig } from "@/lib/score-period";
import type { ReportPost } from "@/modules/report_task/store/report-feed-store";
import { loadScorePeriodConfig } from "@/lib/score-period-config";

/**
 * คำร้องขอแก้ไข/ขอส่งย้อนหลังของ event หักคะแนนรายงาน (report_missed/report_late)
 * — ให้พนักงาน (หรือหัวหน้า/HR ที่เห็นหน้าคะแนน) ยื่นโต้แย้งการหักคะแนนครั้ง
 * หนึ่งได้ แทนที่จะต้องรอผู้ดูแลระบบไปรันสคริปต์คืนคะแนนให้ทีละเคส
 *
 * เก็บเป็น JSON array คีย์ "report-penalty-requests" — **ไม่อยู่ใน STORE_KEYS
 * whitelist** โดยตั้งใจ (ดูคอมเมนต์ที่นั่น) เขียนได้เฉพาะผ่านฟังก์ชันในไฟล์นี้
 * ซึ่งตรวจสิทธิ์เองทุกจุด ไม่ใช่ผ่าน PUT ทั่วไปที่ client ยิงตรงได้
 *
 * อนุมัติ = คืนคะแนนทันที (ไม่ต้องรอให้ส่งรายงานซ้ำ) — ใช้ event ตรงข้าม
 * (refType "report_round_undo") แบบเดียวกับทุกจุดคืนคะแนนอื่นในระบบนี้
 * (reconcile-orphan-report-penalty-events.ts, refundDeletedReportRoundEvents,
 * การคืนคะแนนตอนลาย้อนหลังใน reports/sweep/route.ts) เก็บ event เดิมไว้ ไม่ลบ
 * ทิ้ง — audit trail อ่านย้อนได้ครบ
 */

export type PenaltyRequestType = "retroactive" | "waive";
export type PenaltyRequestStatus = "pending" | "approved" | "rejected";

export interface PenaltyRequest {
  id: string;
  /** เจ้าของคะแนนที่ถูกหัก — ไม่จำเป็นต้องเป็นคนยื่น (หัวหน้า/HR อาจยื่นแทนได้ เพราะหน้าคะแนนเห็นได้เฉพาะ ADMIN/CEO/MANAGER) */
  userId: string;
  /** ผู้ยื่นคำร้องจริง (session.userId ตอนกด) — เพื่อ audit ว่าใครยื่นแทนใคร */
  submittedBy: string;
  /** refId ของ event ต้นเรื่องที่กำลังโต้แย้ง (report_round) */
  refId: string;
  category: "report_missed" | "report_late";
  /** แต้มที่ event ต้นเรื่องหักไป (ค่าติดลบ) — เก็บไว้ตอนยื่น กันกรณีเกณฑ์เปลี่ยนไปทีหลัง */
  points: number;
  topicId: string;
  roundId: string;
  /** "YYYY-MM-DD" ของวันที่ครบกำหนด */
  day: string;
  type: PenaltyRequestType;
  reason: string;
  status: PenaltyRequestStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  /**
   * "ขอส่งย้อนหลัง" ที่อนุมัติแล้ว (ตั้งแต่ 2026-10-14): ยังไม่คืนคะแนน รอให้คนนั้นส่งรีพอตผ่านปุ่ม "ส่งย้อนหลัง"
   * ก่อน 23:59 วันตัดรอบ (retroSubmitDeadline) — ส่งแล้วตัวหักคะแนนคืนให้เอง (acceptRetroPosts)
   * คำร้องเก่าที่อนุมัติก่อนหน้านี้ไม่มีฟิลด์นี้ = คืนไปแล้วตอนอนุมัติ
   */
  awaitingPost?: boolean;
  /** ส่งรีพอตย้อนหลังแล้วเมื่อไหร่ / โพสต์ไหน — ตัวหักคะแนนบันทึกตอนเห็นโพสต์ */
  fulfilledAt?: string;
  fulfilledPostId?: string;
}

const KEY = "report-penalty-requests";

export async function listPenaltyRequests(orgId: string): Promise<PenaltyRequest[]> {
  const { data } = await readStore<PenaltyRequest[]>(orgId, KEY);
  return data ?? [];
}

/** refId มาตรฐาน `${day}:${topicId}:${roundId}:${userId}` (ดู report-penalty-sweep.ts) */
function parseRefId(refId: string): { day: string; topicId: string; roundId: string; userId: string } | null {
  const parts = refId.split(":");
  if (parts.length !== 4) return null;
  const [day, topicId, roundId, userId] = parts as [string, string, string, string];
  return { day, topicId, roundId, userId };
}

export interface CreatePenaltyRequestInput {
  userId: string;
  submittedBy: string;
  refId: string;
  type: PenaltyRequestType;
  reason: string;
}

/**
 * สร้างคำร้องใหม่ — ตรวจก่อนว่า refId นี้ผูกกับ `userId` จริง, ยังเป็น event
 * ที่ active อยู่ (ไม่เคยถูกคืนคะแนนไปแล้ว ไม่ว่าจากที่ไหน), และยังไม่มีคำร้อง
 * pending ค้างอยู่สำหรับ refId เดียวกัน (กันยื่นซ้ำ) — คืน error message เป็น
 * string ถ้าไม่ผ่าน, null ถ้าสำเร็จ (เขียนแล้ว)
 */
export async function createPenaltyRequest(
  orgId: string,
  input: CreatePenaltyRequestInput
): Promise<{ error: string } | { error: null; request: PenaltyRequest }> {
  const parsed = parseRefId(input.refId);
  if (!parsed || parsed.userId !== input.userId) {
    return { error: "refId ไม่ถูกต้อง" };
  }
  if (!input.reason.trim()) {
    return { error: "กรุณาระบุเหตุผล" };
  }

  const event = await prisma.performanceEvent.findFirst({
    where: {
      orgId,
      userId: input.userId,
      source: "report_task",
      refType: "report_round",
      category: { in: ["report_missed", "report_late"] },
      refId: input.refId,
    },
    select: { category: true, points: true, createdAt: true },
  });
  if (!event) return { error: "ไม่พบรายการหักคะแนนนี้" };
  // รอบต่อรอบ — ยื่นได้ถึงวันตัดรอบเกรด (ปกติวันที่ 25) ของรอบที่โดนหัก (penalty-request-window.ts)
  if (!penaltyRequestOpen(parsed.day, await loadScorePeriodConfig(orgId))) {
    return { error: "ปิดรับคำร้องของรอบนั้นแล้ว — ขอแก้คะแนนได้ถึง 23:59 ของวันตัดรอบเกรดเท่านั้น" };
  }

  const undone = await prisma.performanceEvent.findFirst({
    where: { orgId, source: "report_task", refType: "report_round_undo", refId: input.refId },
    select: { refId: true },
  });
  if (undone) return { error: "รายการนี้ถูกคืนคะแนนไปแล้ว ไม่ต้องยื่นคำร้องอีก" };

  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: existing, version } = await readStore<PenaltyRequest[]>(orgId, KEY);
    const list = existing ?? [];
    if (list.some((r) => r.refId === input.refId && r.status === "pending")) {
      return { error: "มีคำร้องสำหรับรายการนี้รออยู่แล้ว" };
    }

    const request: PenaltyRequest = {
      id: randomUUID(),
      userId: input.userId,
      submittedBy: input.submittedBy,
      refId: input.refId,
      category: event.category as "report_missed" | "report_late",
      points: Number(event.points),
      topicId: parsed.topicId,
      roundId: parsed.roundId,
      day: parsed.day,
      type: input.type,
      reason: input.reason.trim(),
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    const result = await writeStore(orgId, KEY, [request, ...list], version, input.submittedBy);
    if (result.ok) return { error: null, request };
    // ชนกับคนอื่นที่เขียนพร้อมกัน — อ่านใหม่แล้วลองอีกรอบ
  }
  return { error: "บันทึกคำร้องไม่สำเร็จ ลองใหม่อีกครั้ง" };
}

/** อนุมัติ/ไม่อนุมัติคำร้อง — คืนคะแนนทันทีถ้าอนุมัติ (ไม่ต้องรอส่งรายงานซ้ำ) */
export async function decidePenaltyRequest(
  orgId: string,
  requestId: string,
  decision: "approved" | "rejected",
  decidedBy: string
): Promise<{ error: string } | { error: null; request: PenaltyRequest }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: existing, version } = await readStore<PenaltyRequest[]>(orgId, KEY);
    const list = existing ?? [];
    const idx = list.findIndex((r) => r.id === requestId);
    if (idx === -1) return { error: "ไม่พบคำร้องนี้" };
    const found = list[idx]!;
    if (found.status !== "pending") return { error: "คำร้องนี้ถูกตัดสินไปแล้ว" };
    // ล็อกแล้วจบ — รอบเกรดของวันนั้นปิดแล้ว (23:59 ของวันตัดรอบ) อนุมัติแล้วคะแนนไม่มีผล จึงไม่ให้อนุมัติ
    if (decision === "approved" && !penaltyRequestOpen(found.day, await loadScorePeriodConfig(orgId))) {
      return { error: "รอบเกรดของวันนั้นปิดแล้ว (23:59 ของวันตัดรอบ) — อนุมัติคืนคะแนนไม่ได้แล้ว กดไม่อนุมัติเพื่อปิดคำร้อง" };
    }

    // ขอส่งย้อนหลัง: อนุมัติ = ให้ไปส่งรีพอต ยังไม่คืนคะแนน ("อนุมัติแล้วให้คนนั้นไปส่งรีพอต")
    // ยกเว้น "ส่งสาย" — ส่งไปแล้วแค่ช้า ไม่มีอะไรให้ส่งซ้ำ อนุมัติ = คืนคะแนนทันที (ผู้ใช้ 30/10/2569)
    const awaitsPost = decision === "approved" && found.type === "retroactive" && found.category !== "report_late";
    const updated: PenaltyRequest = {
      ...found,
      status: decision,
      decidedAt: new Date().toISOString(),
      decidedBy,
      ...(awaitsPost ? { awaitingPost: true } : {}),
    };
    const next = [...list];
    next[idx] = updated;

    const result = await writeStore(orgId, KEY, next, version, decidedBy);
    if (!result.ok) continue; // ชนกับคนอื่น — อ่านใหม่แล้วลองอีกรอบ

    if (decision === "approved" && !awaitsPost) await refundRequest(orgId, updated, decidedBy);
    return { error: null, request: updated };
  }
  return { error: "บันทึกผลไม่สำเร็จ ลองใหม่อีกครั้ง" };
}

/** คืนคะแนนของคำร้องที่อนุมัติแล้ว — event ตรงข้าม "report_round_undo" · มีอยู่แล้วไม่ออกซ้ำ */
async function refundRequest(orgId: string, request: PenaltyRequest, decidedBy: string | undefined) {
  const undone = await prisma.performanceEvent.findFirst({
    where: { orgId, source: "report_task", refType: "report_round_undo", refId: request.refId },
    select: { refId: true },
  });
  if (undone) return;
  // คืนคะแนนลงวันเดียวกับที่หักไป (ดู reports/sweep) — ไม่งั้นอนุมัติเดือนถัดไปแล้ว
  // เดือนที่โดนหักยังติดลบ ส่วนเดือนนี้ได้ +คะแนนลอย ๆ
  const original = await prisma.performanceEvent.findFirst({
    where: { orgId, source: "report_task", category: request.category, refType: "report_round", refId: request.refId },
    select: { occurredAt: true },
  });
  // ไม่ใช้ recordPerformanceEvents (ซึ่งเช็ค performance_settings.enabled
  // และแทนที่ points ด้วยค่า rulePoints ปัจจุบันถ้าไม่ระบุ) — ตรงนี้ต้อง
  // คืนคะแนน "เท่าที่หักไปจริง" เสมอ ไม่ว่าตอนนี้บริษัทจะปิดระบบคะแนนไว้
  // หรือเกณฑ์จะเปลี่ยนไปแล้วก็ตาม (เหมือน reconcile script อื่นทุกตัว)
  await prisma.performanceEvent.createMany({
    data: [
      {
        orgId,
        userId: request.userId,
        source: "report_task",
        category: request.category,
        points: -request.points,
        occurredAt: original?.occurredAt ?? new Date(),
        refType: "report_round_undo",
        refId: request.refId,
        note: `อนุมัติคำร้อง: ${request.reason}`,
        createdBy: decidedBy ?? null,
      },
    ],
    skipDuplicates: true,
  });
}

/**
 * "ส่งสาย" ที่อนุมัติแบบขอส่งย้อนหลังไปก่อนแก้ (ค้าง "รอส่งรีพอต" ทั้งที่ส่งไปแล้ว) — คืนคะแนนให้เลย
 * และเลิกรอ เหมือนอนุมัติด้วยกติกาใหม่ · ทำได้เฉพาะรอบเกรดที่ยังไม่ปิด (เกินแล้วคะแนนไม่มีผลอยู่ดี)
 */
export async function settleApprovedLateRequests(orgId: string): Promise<void> {
  const stuck = (list: PenaltyRequest[]) =>
    list.filter((r) => r.category === "report_late" && r.status === "approved" && r.awaitingPost === true && !r.fulfilledAt);
  const { data } = await readStore<PenaltyRequest[]>(orgId, KEY);
  if (stuck(data ?? []).length === 0) return;
  const period = await loadScorePeriodConfig(orgId);
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: existing, version } = await readStore<PenaltyRequest[]>(orgId, KEY);
    const list = existing ?? [];
    const settle = stuck(list).filter((r) => penaltyRequestOpen(r.day, period));
    if (settle.length === 0) return;
    const ids = new Set(settle.map((r) => r.id));
    const next = list.map((r) => (ids.has(r.id) ? { ...r, awaitingPost: false } : r));
    const result = await writeStore(orgId, KEY, next, version);
    if (!result.ok) continue;
    for (const r of settle) await refundRequest(orgId, r, r.decidedBy);
    return;
  }
}

/** userId ของทุกคนที่ถือ role "CEO" ในบริษัทนี้ — ใช้ส่งแจ้งเตือนตอนมีคำร้องใหม่ */
export async function listCeoUserIds(orgId: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { orgId, isActive: true, roles: { some: { role: { code: "CEO" } } } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/**
 * โพสต์ส่งย้อนหลัง (ReportPost.retroFor) ที่เชื่อได้ — ตรงกับคำร้อง "ขอส่งย้อนหลัง" ที่ CEO อนุมัติ (คน/ห้อง/รอบ/วันตรงกัน)
 * และส่งก่อน 23:59 วันตัดรอบเกรดของวันนั้น · โพสต์อื่นที่มี retroFor ถูกตัดฟิลด์นี้ทิ้ง (โพสต์ store ฝั่ง client เขียนเองได้)
 * คืน posts ชุดที่กรองแล้วให้ตัวหักคะแนนใช้ + refId ของรอบที่ส่งย้อนหลังแล้ว + คำร้องที่เพิ่งส่ง (ยังไม่ได้บันทึกว่าส่งแล้ว)
 */
export function acceptRetroPosts(posts: ReportPost[], requests: PenaltyRequest[], period: ScorePeriodConfig) {
  const byId = new Map(requests.map((r) => [r.id, r] as const));
  const retroRefIds = new Set<string>();
  const newlyFulfilled: { request: PenaltyRequest; postId: string }[] = [];
  const accepted = posts.map((p) => {
    if (!p.retroFor) return p;
    const r = byId.get(p.retroFor.requestId);
    const ok =
      !!r &&
      r.type === "retroactive" &&
      r.status === "approved" &&
      r.awaitingPost === true &&
      r.userId === p.authorId &&
      r.topicId === p.topicId &&
      r.day === p.retroFor.day &&
      r.roundId === p.retroFor.roundId &&
      new Date(p.createdAt).getTime() < retroSubmitDeadline(r.day, period).getTime();
    if (!ok || !r) return { ...p, retroFor: undefined };
    retroRefIds.add(r.refId);
    if (!r.fulfilledAt && !newlyFulfilled.some((f) => f.request.id === r.id)) newlyFulfilled.push({ request: r, postId: p.id });
    return p;
  });
  return { posts: accepted, retroRefIds, newlyFulfilled };
}

/** บันทึกว่าคำร้องส่งย้อนหลังแล้ว (คิวคำร้องขึ้น "ส่งแล้ว") — คืนรายการที่บันทึกจริง */
export async function markRetroFulfilled(
  orgId: string,
  items: { request: PenaltyRequest; postId: string }[]
): Promise<PenaltyRequest[]> {
  if (items.length === 0) return [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: existing, version } = await readStore<PenaltyRequest[]>(orgId, KEY);
    const list = existing ?? [];
    const at = new Date().toISOString();
    const done: PenaltyRequest[] = [];
    const next = list.map((r) => {
      const hit = items.find((i) => i.request.id === r.id);
      if (!hit || r.fulfilledAt) return r;
      const u = { ...r, fulfilledAt: at, fulfilledPostId: hit.postId };
      done.push(u);
      return u;
    });
    if (done.length === 0) return [];
    const result = await writeStore(orgId, KEY, next, version);
    if (result.ok) return done;
  }
  return [];
}
