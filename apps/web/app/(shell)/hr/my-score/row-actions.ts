import "server-only";

import { prisma } from "@smartboss/database";

import { eventDay, isReversalEvent, PERFORMANCE_CATEGORIES, type PerformanceCategory } from "@/lib/performance";
import type { ScorePeriodConfig } from "@/lib/score-period";
import { listScoreRequests, SCORE_REASON_TAGS, type ScoreRequest } from "@/lib/score-request-store";
import { wfTry, type AttendanceCorrection, type Me } from "@/modules/hr/lib/api";
import { listPenaltyRequests, type PenaltyRequest } from "@/modules/report_task/lib/db/report-penalty-requests";
import { penaltyRequestOpen, retroSubmitDeadline } from "@/modules/report_task/lib/penalty-request-window";
import type { RowActionSpec } from "./score-row-action";

/**
 * ปุ่ม "ขอแก้ไข" / สถานะคำขอ ของทุกรายการที่โดนหัก ในหน้า "คะแนนของฉัน" (ผู้ใช้ขอ 21/10/2569)
 *
 * กติกาตัดรอบ (ผู้ใช้ยืนยัน): ยื่นและอนุมัติได้ถึง 23:59 วันตัดรอบของรอบที่โดนหัก — อนุมัติหลังจากนั้นไม่มีผล
 * (คนละรอบแล้ว) ⇒ รอบที่ปิดแล้วไม่มีปุ่ม ใบที่ค้างตอนปิดรอบขึ้น "ปิดรอบแล้ว · อนุมัติไม่ทัน"
 */

interface Ev {
  id: string;
  userId: string;
  category: string;
  occurredAt: Date;
  points: unknown;
  note: string | null;
  refType: string | null;
  refId: string | null;
}

const SCORE_BASE: Record<string, string> = { task_late: "task", workorder_overdue: "work_order", pm_missed: "pm_schedule" };
const SCORE_ROLE: Record<string, string> = { task_late: "คนสั่งงาน", workorder_overdue: "คนเปิดใบงาน", pm_missed: "คนสร้างแผน PM" };

function deadlineText(day: string, period: ScorePeriodConfig): string {
  const close = new Date(retroSubmitDeadline(day, period).getTime() - 60_000);
  const d = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short" }).format(close);
  return `ขอได้ถึง ${d} 23:59`;
}

/** รายการที่มีตัวยกเลิกแล้ว (คืนคะแนนแล้ว) — กติกาเดียวกับ pairReversals ใน score-breakdown */
function reversedIds(events: Ev[]): Set<string> {
  const keys = new Set<string>();
  for (const e of events) {
    if (!e.refType || !e.refId || !isReversalEvent(e)) continue;
    keys.add(
      e.refType.endsWith("_undo") ? `${e.category}|${e.refType.slice(0, -"_undo".length)}|${e.refId}` : `${e.category}|id|${e.refId}`
    );
  }
  const out = new Set<string>();
  for (const e of events) {
    if (isReversalEvent(e)) continue;
    if (keys.has(`${e.category}|id|${e.id}`) || (e.refType && e.refId && keys.has(`${e.category}|${e.refType}|${e.refId}`))) out.add(e.id);
  }
  return out;
}

const latestBy = <T extends { createdAt: string }>(list: T[]) =>
  [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

export async function buildRowActions(orgId: string, userId: string, events: Ev[], period: ScorePeriodConfig): Promise<Map<string, RowActionSpec>> {
  const out = new Map<string, RowActionSpec>();
  const reversed = reversedIds(events);
  const docks = events.filter((e) => !isReversalEvent(e) && !reversed.has(e.id) && Number(e.points) < 0 && e.refId);
  if (docks.length === 0) return out;

  const needScore = docks.some((e) => SCORE_BASE[e.category] === e.refType);
  const needReport = docks.some((e) => e.refType === "report_round");
  const needAttendance = docks.some((e) => e.refType === "attendance_day");
  const [scoreReqs, reportReqs, me] = await Promise.all([
    needScore ? listScoreRequests(orgId).then((l) => l.filter((r) => r.userId === userId)) : Promise.resolve([] as ScoreRequest[]),
    needReport ? listPenaltyRequests(orgId).then((l) => l.filter((r) => r.userId === userId)) : Promise.resolve([] as PenaltyRequest[]),
    needAttendance ? wfTry<Me>("/me") : Promise.resolve(null),
  ]);
  const corrections =
    needAttendance && me?.employment_id
      ? ((await wfTry<{ items: AttendanceCorrection[] }>("/me/attendance-correction-requests"))?.items ?? [])
      : [];
  const approverIds = [...new Set(scoreReqs.map((r) => r.approverId).filter((x): x is string => !!x))];
  const names = new Map(
    (approverIds.length
      ? await prisma.user.findMany({ where: { orgId, id: { in: approverIds } }, select: { id: true, name: true } })
      : []
    ).map((u) => [u.id, u.name])
  );

  for (const e of docks) {
    const day = eventDay(e.occurredAt);
    const open = penaltyRequestOpen(day, period);
    const deadline = deadlineText(day, period);
    const label = PERFORMANCE_CATEGORIES[e.category as PerformanceCategory] ?? e.category;
    const points = Number(e.points);
    const lateLock = { tone: "lock" as const, text: "🔒 ปิดรอบแล้ว · อนุมัติไม่ทัน", sub: "คะแนนรอบนี้ไม่เปลี่ยน" };

    // ── งาน / ใบงาน / PM เลยกำหนด ──
    if (SCORE_BASE[e.category] === e.refType) {
      const r = latestBy(scoreReqs.filter((x) => x.category === e.category && x.refId === e.refId));
      if (r?.status === "pending") {
        const who = r.approverId ? `${r.approverRole} ${names.get(r.approverId) ?? ""}`.trim() : "CEO";
        out.set(e.id, open ? { status: { tone: "wait", text: "⏳ รอพิจารณา", sub: `${who} · ต้องอนุมัติ${deadline.replace("ขอได้", "")}` } } : { status: lateLock });
      } else if (r?.status === "rejected") {
        out.set(e.id, { status: { tone: "no", text: "❌ ไม่อนุมัติ", sub: r.decisionNote ?? "" } });
      } else if (open) {
        out.set(e.id, {
          deadline,
          open: {
            kind: "score",
            eventId: e.id,
            label,
            title: e.note ?? label,
            points,
            day,
            approverText: `${SCORE_ROLE[e.category]} (หรือ CEO)`,
            reasonTags: [...SCORE_REASON_TAGS],
          },
        });
      }
      continue;
    }

    // ── รายงาน: คำร้องตัวเดิม (CEO) ──
    if (e.refType === "report_round" && (e.category === "report_missed" || e.category === "report_late")) {
      const reqs = reportReqs.filter((x) => x.refId === e.refId && x.category === e.category);
      const r = latestBy(reqs);
      const reportDay = e.refId!.split(":")[0] ?? day;
      if (r?.status === "pending") {
        out.set(e.id, open ? { status: { tone: "wait", text: "⏳ รอพิจารณา", sub: `CEO · ต้องอนุมัติ${deadline.replace("ขอได้", "")}` } } : { status: lateLock });
      } else if (r?.status === "approved" && r.awaitingPost) {
        out.set(e.id, { status: { tone: "wait", text: "อนุมัติให้ส่งย้อนหลัง", sub: `กด "ส่งย้อนหลัง" ในห้องรีพอต${deadline.replace("ขอได้", "")} ส่งแล้วได้คะแนนคืน` } });
      } else if (open) {
        out.set(e.id, {
          deadline,
          ...(r?.status === "rejected" ? { status: { tone: "no" as const, text: "❌ ไม่อนุมัติ", sub: "ยื่นใหม่ได้" } } : {}),
          open: {
            kind: "report",
            userId,
            category: e.category,
            categoryLabel: label,
            item: {
              refId: e.refId!,
              points,
              day: reportDay,
              topicName: e.note ?? label,
              roundLabel: label,
              hasPendingRequest: false,
              requestOpen: true,
            },
          },
        });
      }
      continue;
    }

    // ── มาสาย / ขาดงาน: ฟอร์มขอแก้เวลาตัวเดิม (HR/CEO 2 คน) ──
    if (e.refType === "attendance_day" && (e.category === "attendance_late" || e.category === "attendance_absent")) {
      // refId = `${userId}:${YYYY-MM-DD}` — วันทำงานตรง ๆ ไม่ต้องแปลงจากเวลา
      const workDay = /^\d{4}-\d{2}-\d{2}$/.test(e.refId!.split(":")[1] ?? "") ? e.refId!.split(":")[1]! : day;
      const c = latestBy(corrections.filter((x) => x.work_date.slice(0, 10) === workDay).map((x) => ({ ...x, createdAt: x.created_at })));
      if (c?.status === "PENDING") {
        out.set(e.id, open ? { status: { tone: "wait", text: "⏳ ยื่นแก้เวลาแล้ว", sub: `รอ HR / CEO · ต้องอนุมัติ${deadline.replace("ขอได้", "")}` } } : { status: lateLock });
      } else if (c?.status === "APPROVED") {
        out.set(e.id, { status: { tone: "ok", text: "✅ อนุมัติแก้เวลาแล้ว", sub: "ระบบกำลังคิดคะแนนวันนั้นใหม่" } });
      } else if (open && me?.employment_id) {
        out.set(e.id, {
          deadline,
          ...(c?.status === "REJECTED" ? { status: { tone: "no" as const, text: "❌ คำขอแก้เวลาไม่อนุมัติ", sub: "ยื่นใหม่ได้" } } : {}),
          open: { kind: "attendance", employmentId: me.employment_id, day: workDay, intent: "CLOCK_IN", label: `${label} · ${e.note ?? workDay}`, points },
        });
      }
    }
  }
  return out;
}
