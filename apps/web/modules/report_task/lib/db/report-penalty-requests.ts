import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@smartboss/database";
import { readStore, writeStore } from "./org-store";

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
    select: { category: true, points: true },
  });
  if (!event) return { error: "ไม่พบรายการหักคะแนนนี้" };

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

    const updated: PenaltyRequest = {
      ...found,
      status: decision,
      decidedAt: new Date().toISOString(),
      decidedBy,
    };
    const next = [...list];
    next[idx] = updated;

    const result = await writeStore(orgId, KEY, next, version, decidedBy);
    if (!result.ok) continue; // ชนกับคนอื่น — อ่านใหม่แล้วลองอีกรอบ

    if (decision === "approved") {
      // ไม่ใช้ recordPerformanceEvents (ซึ่งเช็ค performance_settings.enabled
      // และแทนที่ points ด้วยค่า rulePoints ปัจจุบันถ้าไม่ระบุ) — ตรงนี้ต้อง
      // คืนคะแนน "เท่าที่หักไปจริง" เสมอ ไม่ว่าตอนนี้บริษัทจะปิดระบบคะแนนไว้
      // หรือเกณฑ์จะเปลี่ยนไปแล้วก็ตาม (เหมือน reconcile script อื่นทุกตัว)
      await prisma.performanceEvent.createMany({
        data: [
          {
            orgId,
            userId: updated.userId,
            source: "report_task",
            category: updated.category,
            points: -updated.points,
            occurredAt: new Date(),
            refType: "report_round_undo",
            refId: updated.refId,
            note: `อนุมัติคำร้อง: ${updated.reason}`,
            createdBy: decidedBy,
          },
        ],
        skipDuplicates: true,
      });
    }
    return { error: null, request: updated };
  }
  return { error: "บันทึกผลไม่สำเร็จ ลองใหม่อีกครั้ง" };
}

/** userId ของทุกคนที่ถือ role "CEO" ในบริษัทนี้ — ใช้ส่งแจ้งเตือนตอนมีคำร้องใหม่ */
export async function listCeoUserIds(orgId: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { orgId, isActive: true, roles: { some: { role: { code: "CEO" } } } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}
