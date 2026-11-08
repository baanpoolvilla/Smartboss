"use server";

import { revalidatePath } from "next/cache";
import { roundOrderTeam } from "@/modules/maintenance/lib/pm-team";
import { prisma } from "@smartboss/database";
import { canViewAll, requireOrg } from "@smartboss/auth";

import { nextWorkOrderCode } from "@/lib/document-code";
import { addWorkOrderComment } from "@/modules/maintenance/data/work-orders";
import { logActivity } from "@/modules/maintenance/data/activity";
import { notifyUser, resolveActionNotifications } from "@/modules/maintenance/data/notify";
import { postWorkOrderCard } from "@/modules/chat/data/task-cards";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";
import { isPastDay } from "@/modules/maintenance/lib/no-past-date";

import { ceoTitle } from "@/lib/ceo-title";
/**
 * PM ค้างหลายรอบ — CEO ตัดสิน (ผู้ใช้ 2/11/2569)
 *   ทีละรอบ: ไม่ต้องทำ (ยกเลิกใบ) + หัก/ไม่หักคะแนน · หรือยังต้องทำแต่ไม่หัก
 *   รวบหลายรอบเป็นใบเดียว: ใบเดิมยกเลิกชี้ไปใบรวม ช่างทำครั้งเดียว
 * คะแนน: overdueScore = waived → cron คืนคะแนนที่หักไปแล้วและไม่หักอีก · kept → หักไว้แม้ยกเลิกใบ
 */

const OPEN = ["open", "in_progress"];
const DONE_TITLES = ["ได้รับมอบหมายงานใหม่", "ขอเลื่อนกำหนดส่งใบงาน รออนุมัติ"];

async function requireCeo() {
  const ceo = await ceoTitle();
  const s = await requireOrg();
  if (!canViewAll(s)) throw new Error(`เฉพาะ ${ceo}`);
  return s;
}

function refresh() {
  revalidatePath("/maintenance/pm/rounds");
  revalidatePath("/maintenance/work-orders");
  revalidatePath("/maintenance");
}

export interface RoundDecision {
  woId: string;
  /** ไม่ต้องทำรอบนี้ (ยกเลิกใบ) */
  skip: boolean;
  /** ไม่หักคะแนนรอบนี้ (คืนที่หักไปแล้ว) */
  waive: boolean;
}

export async function decidePileupAction(pmId: string, decisions: RoundDecision[]): Promise<{ error?: string }> {
  const ceo = await ceoTitle();
  let s;
  try { s = await requireCeo(); } catch { return { error: `เฉพาะ ${ceo} ตัดสินได้` }; }
  const wos = await prisma.workOrder.findMany({
    where: { orgId: s.orgId, pmScheduleId: pmId, pmRoundDate: { not: null }, status: { in: OPEN }, id: { in: decisions.map((d) => d.woId) } },
    select: { id: true, code: true, title: true, pmRoundDate: true, assignedTo: true, overdueScore: true },
  });
  const byId = new Map(wos.map((w) => [w.id, w]));

  for (const d of decisions) {
    const wo = byId.get(d.woId);
    if (!wo) continue;
    const round = fmtThaiDate(wo.pmRoundDate!);
    const score = d.waive ? "ไม่หักคะแนน" : "หักคะแนนไว้";
    if (d.skip) {
      await prisma.workOrder.updateMany({
        where: { orgId: s.orgId, id: wo.id, status: { in: OPEN } },
        data: {
          status: "cancelled",
          overdueScore: d.waive ? "waived" : "kept",
          completionNotes: `${ceo}: ไม่ต้องทำรอบ ${round} · ${score}`,
        },
      });
      await resolveActionNotifications(wo.id, "work_order", DONE_TITLES);
    } else {
      const next = d.waive ? "waived" : null;
      if (next === wo.overdueScore) continue;
      await prisma.workOrder.update({ where: { id: wo.id }, data: { overdueScore: next } });
    }
    const summary = d.skip ? `${ceo}: ไม่ต้องทำรอบ ${round} · ${score}` : d.waive ? `${ceo}: ยังต้องทำรอบ ${round} · ไม่หักคะแนน` : `${ceo}: ยังต้องทำรอบ ${round} · หักคะแนนตามปกติ`;
    await addWorkOrderComment(s.orgId, wo.id, s.userId, summary, null, { kind: "log" });
    await logActivity(s.orgId, { userId: s.userId, entity: "work_order", entityId: wo.id, entityCode: wo.code, action: "update", summary: `${summary} ${wo.code}` });
    if (wo.assignedTo && wo.assignedTo !== s.userId) {
      await notifyUser(s.orgId, wo.assignedTo, { title: summary, body: `${wo.code} ${wo.title}`, type: "work_order", referenceId: wo.id });
    }
  }
  refresh();
  return {};
}

export type MergeScore = "all" | "one" | "none";

export async function mergePileupAction(input: {
  pmId: string;
  woIds: string[];
  dueDate: string;
  score: MergeScore;
  note: string;
}): Promise<{ error?: string; id?: string; code?: string }> {
  const ceo = await ceoTitle();
  let s;
  try { s = await requireCeo(); } catch { return { error: `เฉพาะ ${ceo} ตัดสินได้` }; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) return { error: "เลือกกำหนดส่งของใบรวม" };
  if (isPastDay(input.dueDate)) return { error: "กำหนดส่งย้อนหลังไม่ได้" };
  const due = new Date(`${input.dueDate}T23:59:59.999+07:00`);

  const [pm, wos] = await Promise.all([
    prisma.pmSchedule.findFirst({ where: { orgId: s.orgId, id: input.pmId } }),
    prisma.workOrder.findMany({
      where: { orgId: s.orgId, pmScheduleId: input.pmId, pmRoundDate: { not: null }, status: { in: OPEN }, id: { in: input.woIds } },
      orderBy: { pmRoundDate: "asc" },
      select: { id: true, code: true, pmRoundDate: true, assignedTo: true, groupMemberIds: true, completionRule: true },
    }),
  ]);
  if (!pm) return { error: "ไม่พบแผน PM" };
  if (wos.length < 2) return { error: "เลือกอย่างน้อย 2 รอบ" };

  const latest = wos[wos.length - 1]!;
  const assignee = latest.assignedTo ?? pm.assignedTo ?? null;
  const rounds = wos.map((w) => fmtThaiDate(w.pmRoundDate!)).join(", ");
  const note = input.note.trim().slice(0, 1000);
  const scoreText = input.score === "all" ? "หักทุกรอบ" : input.score === "one" ? "หักรอบเดียว" : "ไม่หัก";

  const merged = await prisma.$transaction(async (tx) => {
  const ceo = await ceoTitle();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pm-auto-wo:${pm.id}`}))`;
    const code = await nextWorkOrderCode(tx, s.orgId);
    const wo = await tx.workOrder.create({
      data: {
        orgId: s.orgId,
        code,
        propertyId: pm.propertyId,
        assetId: pm.assetId,
        assignedTo: assignee,
        // ทีมตามใบรอบล่าสุด (แก้ทีมในใบแล้วก็ตามนั้น) · เช็กลิสต์จากแผน
        ...roundOrderTeam({ ...pm, groupMemberIds: latest.assignedTo ? latest.groupMemberIds : pm.groupMemberIds, completionRule: latest.assignedTo ? latest.completionRule : pm.completionRule }, assignee),
        // CEO เป็นคนเปิดใบรวม ⇒ อนุมัติคำขอเลื่อนของใบนี้ได้ (กติกาเดิม: CEO หรือคนเปิดใบ)
        createdBy: s.userId,
        title: `${pm.title} (รวม ${wos.length} รอบ)`,
        description: [`PM: ${pm.title}`, `รวมรอบ ${rounds} (${ceo} รวบเป็นใบเดียว)`, note || null].filter(Boolean).join("\n"),
        status: "open",
        priority: "medium",
        pmScheduleId: pm.id,
        pmRoundDate: latest.pmRoundDate,
        dueDate: due,
        ccUserIds: pm.ccUserIds,
        requiresExpense: pm.requiresExpense,
        autoCreated: true,
      },
    });
    for (const w of wos) {
      const kept = input.score === "all" || (input.score === "one" && w.id === latest.id);
      await tx.workOrder.updateMany({
        where: { orgId: s.orgId, id: w.id, status: { in: OPEN } },
        data: {
          status: "cancelled",
          mergedIntoId: wo.id,
          overdueScore: kept ? "kept" : "waived",
          completionNotes: `รวมเข้า ${code} (${ceo} รวบ ${wos.length} รอบ · ${scoreText})`,
        },
      });
    }
    return wo;
  });

  for (const w of wos) {
    await resolveActionNotifications(w.id, "work_order", DONE_TITLES);
    await addWorkOrderComment(s.orgId, w.id, s.userId, `รวมเข้า ${merged.code} (${ceo} รวบ ${wos.length} รอบ · ${scoreText})`, null, { kind: "log" });
  }
  await logActivity(s.orgId, {
    userId: s.userId,
    entity: "work_order",
    entityId: merged.id,
    entityCode: merged.code,
    action: "create",
    summary: `${ceo} รวบ PM ${wos.length} รอบเป็นใบเดียว ${merged.code} "${merged.title}" · ${scoreText}`,
    detail: { pmScheduleId: pm.id, mergedFrom: wos.map((w) => w.code), score: input.score },
  });
  if (assignee && assignee !== s.userId) {
    await notifyUser(s.orgId, assignee, {
      title: `📋 ${ceo} รวบ PM ${wos.length} รอบเป็นใบเดียว: ${pm.title}`,
      body: `${merged.code} · ครบกำหนด ${fmtThaiDate(due)}${note ? ` · ${note}` : ""}`,
      type: "work_order",
      referenceId: merged.id,
    });
    await postWorkOrderCard(s.orgId, { assignerId: s.userId, assigneeId: assignee, workOrderId: merged.id, title: merged.title, dueDate: due });
  }
  refresh();
  return { id: merged.id, code: merged.code };
}
