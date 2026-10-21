import "server-only";

import { prisma } from "@smartboss/database";
import { hasRole, isSuperAdmin, type OrgSession } from "@smartboss/auth";

import { PERFORMANCE_CATEGORIES } from "@/lib/performance";
import { loadScorePeriodConfig } from "@/lib/score-period-config";
import { listScoreRequests, type ScoreRequest } from "@/lib/score-request-store";
import { canDecideScoreRequest } from "@/lib/score-requests";
import { penaltyRequestOpen, retroSubmitDeadline } from "@/modules/report_task/lib/penalty-request-window";
import type { ScoreQueueItem } from "@/app/(shell)/hr/penalty-requests/score-requests-queue";

const fmtDay = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short" });
const fmtDayTime = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function hrefOf(r: ScoreRequest): string | null {
  if (r.target.kind === "work_order") return `/maintenance/work-orders/${r.target.id}`;
  if (r.target.kind === "task") return `/report-task/tasks?task=${encodeURIComponent(r.target.id)}`;
  return "/maintenance/pm";
}

function statusText(r: ScoreRequest, names: Map<string, string>): string {
  const by = r.decidedBy ? (names.get(r.decidedBy) ?? "") : "";
  if (r.status === "approved") return `✓ อนุมัติ · คืน +${Math.abs(r.points)}${by ? ` · ${by}` : ""}`;
  if (r.status === "rejected") return `✕ ไม่อนุมัติ${by ? ` · ${by}` : ""}${r.decisionNote ? ` — ${r.decisionNote}` : ""}`;
  if (r.status === "closed") return `ปิดแล้ว · ${r.closedReason ?? ""}`;
  return "รอพิจารณา";
}

/**
 * คำขอแก้คะแนนที่คนดูเกี่ยว — `filter` เลือกเพิ่ม (เช่น ของใบงานใบเดียว)
 * รอพิจารณา: เฉพาะใบที่คนดูตัดสินได้ เรียงใบใกล้ตัดรอบขึ้นก่อน · ตัดสินแล้ว: 20 ใบล่าสุดที่คนดูเป็นเจ้าของเรื่อง (CEO เห็นทั้งหมด)
 */
export async function buildScoreQueue(
  session: OrgSession,
  filter: (r: ScoreRequest) => boolean = () => true
): Promise<{ pending: ScoreQueueItem[]; decided: ScoreQueueItem[]; isCeo: boolean }> {
  const orgId = session.orgId;
  const isCeo = hasRole(session, "CEO") || isSuperAdmin(session);
  const [all, period] = await Promise.all([listScoreRequests(orgId), loadScorePeriodConfig(orgId)]);
  const mine = all.filter(filter);
  const pendingReqs = mine.filter((r) => r.status === "pending" && canDecideScoreRequest(session, r));
  const decidedReqs = mine
    .filter((r) => r.status !== "pending" && (isCeo || r.approverId === session.userId))
    .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))
    .slice(0, 20);
  const ids = new Set<string>();
  for (const r of [...pendingReqs, ...decidedReqs]) {
    ids.add(r.userId);
    ids.add(r.submittedBy);
    if (r.approverId) ids.add(r.approverId);
    if (r.decidedBy) ids.add(r.decidedBy);
  }
  const names = new Map(
    (ids.size ? await prisma.user.findMany({ where: { orgId, id: { in: [...ids] } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name])
  );
  const now = Date.now();
  const view = (r: ScoreRequest): ScoreQueueItem => {
    const close = retroSubmitDeadline(r.day, period).getTime();
    const open = penaltyRequestOpen(r.day, period);
    return {
      id: r.id,
      userName: names.get(r.userId) ?? "พนักงาน",
      submitterName: r.submittedBy !== r.userId ? (names.get(r.submittedBy) ?? null) : null,
      label: PERFORMANCE_CATEGORIES[r.category] ?? r.category,
      title: r.title,
      points: r.points,
      dayText: fmtDay.format(new Date(`${r.day}T12:00:00+07:00`)),
      reasonTag: r.reasonTag,
      reason: r.reason,
      createdText: fmtDayTime.format(new Date(r.createdAt)),
      approverText: r.approverId ? `${r.approverRole} ${names.get(r.approverId) ?? ""}`.trim() : "CEO (ไม่มีคนอื่นอนุมัติได้)",
      // ไม่มีเจ้าของเรื่องที่อนุมัติได้ ⇒ CEO คือคนอนุมัติหลักของใบนั้น (ไม่ใช่ "อนุมัติแทน")
      primary: r.approverId === session.userId || (!r.approverId && isCeo),
      notifiesCeo: !r.approverId,
      deadlineText: `ภายใน ${fmtDay.format(new Date(close - 60_000))} 23:59`,
      urgent: open && close - now <= 24 * 3600_000,
      open,
      href: hrefOf(r),
      status: r.status,
      statusText: statusText(r, names),
    };
  };
  const pending = pendingReqs.map(view).sort((a, b) => Number(b.open) - Number(a.open) || Number(b.urgent) - Number(a.urgent));
  return { pending, decided: decidedReqs.map(view), isCeo };
}
