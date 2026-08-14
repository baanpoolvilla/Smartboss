import { Bug, LayoutTemplate, Database, Gauge, Lock, HelpCircle, Sparkles, MoreHorizontal, type LucideIcon } from "lucide-react";
import type { IssueCategory, IssueDeskConfig, IssueImpact, IssuePriority, IssueStatus } from "@/modules/report_task/types/issue";

export const issueCategoryMeta: Record<IssueCategory, { label: string; icon: LucideIcon }> = {
  bug: { label: "ใช้งานไม่ได้", icon: Bug },
  ui: { label: "หน้าตา / UI", icon: LayoutTemplate },
  data: { label: "ข้อมูลผิด", icon: Database },
  performance: { label: "ช้า / ค้าง", icon: Gauge },
  access: { label: "สิทธิ์เข้าไม่ได้", icon: Lock },
  how_to: { label: "ถามวิธีใช้", icon: HelpCircle },
  feature: { label: "ขอฟีเจอร์", icon: Sparkles },
  other: { label: "อื่นๆ", icon: MoreHorizontal },
};

/** Categories that aren't really "a problem" — the impact question ("ตอนนี้คุณ…")
 * doesn't apply, and the submit button reads differently (see issueSubmitLabel). */
export const NON_IMPACT_CATEGORIES: IssueCategory[] = ["how_to", "feature"];

export function issueSubmitLabel(category: IssueCategory): string {
  if (category === "how_to") return "ส่งคำถาม";
  if (category === "feature") return "ส่งคำขอ";
  return "ส่งเรื่อง";
}

export const issueImpactMeta: Record<IssueImpact, { label: string }> = {
  blocked: { label: "ทำงานต่อไม่ได้เลย" },
  workaround: { label: "พอมีทางเลี่ยงได้ แต่เสียเวลา" },
  minor: { label: "แค่รำคาญ / เรื่องความสวยงาม" },
};

export const issuePriorityMeta: Record<IssuePriority, { label: string; colorVar: string }> = {
  urgent: { label: "ด่วน", colorVar: "var(--chart-red)" },
  high: { label: "สูง", colorVar: "var(--chart-orange)" },
  normal: { label: "ปกติ", colorVar: "var(--chart-blue)" },
  low: { label: "ต่ำ", colorVar: "var(--ink-soft)" },
};

/** Priority isn't something a reporter can judge — they know impact, Agent knows
 * priority. This is only the *starting* value; Agent can change it on triage. */
export function defaultPriorityFor(impact: IssueImpact, category: IssueCategory): IssuePriority {
  if (category === "how_to" || category === "feature") return "low";
  if (impact === "blocked") return "urgent";
  if (impact === "workaround") return "normal";
  return "low";
}

export const issueStatusMeta: Record<IssueStatus, { label: string }> = {
  new: { label: "ยังไม่มีใครรับ" },
  triaged: { label: "รับเรื่องแล้ว" },
  in_progress: { label: "กำลังดำเนินการ" },
  waiting_reporter: { label: "รอผู้แจ้งตอบกลับ" },
  escalated: { label: "ส่งต่อผู้พัฒนาแล้ว" },
  vendor_working: { label: "ผู้พัฒนากำลังทำ" },
  vendor_released: { label: "ผู้พัฒนาแก้แล้ว" },
  pending_verify: { label: "รอผู้แจ้งยืนยัน" },
  resolved: { label: "เสร็จแล้ว" },
  rejected: { label: "ไม่ดำเนินการ" },
  duplicate: { label: "ซ้ำกับตั๋วอื่น" },
};

export type ReporterStatusGroup = "awaiting" | "in_progress" | "needs_you" | "done" | "closed";

const REPORTER_GROUP_BY_STATUS: Record<IssueStatus, ReporterStatusGroup> = {
  new: "awaiting",
  triaged: "in_progress",
  in_progress: "in_progress",
  escalated: "in_progress",
  vendor_working: "in_progress",
  vendor_released: "in_progress",
  waiting_reporter: "needs_you",
  pending_verify: "needs_you",
  resolved: "done",
  rejected: "closed",
  duplicate: "closed",
};

export const reporterStatusGroupMeta: Record<ReporterStatusGroup, { label: string; dot: string; className: string }> = {
  awaiting: { label: "รอรับเรื่อง", dot: "bg-[var(--chart-red)]", className: "bg-red-50 text-[var(--chart-red)] border-red-200" },
  in_progress: { label: "กำลังดำเนินการ", dot: "bg-[var(--chart-amber)]", className: "bg-amber-50 text-[var(--chart-amber)] border-amber-200" },
  needs_you: { label: "รอคุณตอบกลับ", dot: "bg-[var(--chart-blue)]", className: "bg-blue-50 text-[var(--chart-blue)] border-blue-200" },
  done: { label: "เสร็จแล้ว", dot: "bg-[var(--chart-green)]", className: "bg-green-50 text-[var(--brand-green-dark)] border-green-200" },
  closed: { label: "ปิดแล้ว", dot: "bg-[var(--ink-soft)]", className: "bg-gray-50 text-[var(--ink-soft)] border-gray-200" },
};

export function reporterStatusGroup(status: IssueStatus): ReporterStatusGroup {
  return REPORTER_GROUP_BY_STATUS[status];
}

export function nextTicketCode(existingCount: number): string {
  return `IS-${String(existingCount + 1).padStart(4, "0")}`;
}

/** In-order status list for Agent-facing selects — mirrors the state machine's
 * left-to-right progression (see ISSUE_REPORT_SYSTEM_SPEC.md §4), not enum order. */
export const AGENT_STATUS_ORDER: IssueStatus[] = [
  "new",
  "triaged",
  "in_progress",
  "waiting_reporter",
  "escalated",
  "vendor_working",
  "vendor_released",
  "pending_verify",
  "resolved",
  "rejected",
  "duplicate",
];

/**
 * Which statuses a ticket can move to *from* each status — the status
 * dropdown used to list all 11 regardless of where the ticket actually was,
 * letting an Agent "escalate" a ticket that's already resolved or jump
 * straight to `vendor_released` on a ticket nobody's touched. Terminal
 * states (resolved/rejected/duplicate) only offer a manual reopen back to
 * `in_progress` — the spec's 30-day reopen window isn't enforced here yet,
 * this is just the honest state machine, not the full policy.
 * See ISSUE_DESK_AUDIT_2026-08-08.md §C2.
 */
const NEXT_STATUSES: Record<IssueStatus, IssueStatus[]> = {
  new: ["triaged", "rejected", "duplicate"],
  triaged: ["in_progress", "waiting_reporter", "escalated", "rejected", "duplicate"],
  in_progress: ["waiting_reporter", "escalated", "pending_verify", "resolved"],
  waiting_reporter: ["in_progress", "escalated", "pending_verify"],
  escalated: ["vendor_working"],
  vendor_working: ["vendor_released"],
  vendor_released: ["pending_verify"],
  pending_verify: ["resolved", "in_progress", "escalated"],
  resolved: ["in_progress"],
  rejected: ["in_progress"],
  duplicate: ["in_progress"],
};

/** Current status + only the statuses reachable from it, in AGENT_STATUS_ORDER. */
export function nextStatusOptions(current: IssueStatus): IssueStatus[] {
  const reachable = new Set([current, ...NEXT_STATUSES[current]]);
  return AGENT_STATUS_ORDER.filter((s) => reachable.has(s));
}

/** "2 ชม. 14 นาที" — a plain duration, not a "X ago" relative string (see
 * lib/format.ts's relativeTime, which is the wrong shape for "รอมาแล้ว…"). */
export function formatWaitDuration(fromIso: string): string {
  const ms = Date.now() - new Date(fromIso).getTime();
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} นาที`;
  return `${hours} ชม. ${minutes} นาที`;
}

/** The known-issues banner auto-expires 24h after it was last saved, so a
 * "ระบบล่ม กำลังแก้ไข" note can't silently sit stale for a week after the
 * incident's long over — see ISSUE_DESK_AUDIT_2026-08-08.md §D. */
const KNOWN_ISSUES_BANNER_TTL_MS = 24 * 60 * 60 * 1000;

export function isKnownIssuesBannerActive(banner: IssueDeskConfig["knownIssuesBanner"]): boolean {
  if (!banner?.active) return false;
  return Date.now() - new Date(banner.updatedAt).getTime() < KNOWN_ISSUES_BANNER_TTL_MS;
}
