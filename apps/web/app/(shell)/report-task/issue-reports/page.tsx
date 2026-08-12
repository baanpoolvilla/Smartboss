"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Send,
  Megaphone,
  Paperclip,
  MessageCircle,
  Settings2,
} from "lucide-react";
import { StickyFilterBar } from "@/modules/report_task/components/shared/sticky-filter-bar";
import { Button } from "@/modules/report_task/components/ui/button";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/modules/report_task/components/ui/table";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useIssueReportStore } from "@/modules/report_task/store/issue-report-store";
import { useIssueDeskConfigStore } from "@/modules/report_task/store/issue-desk-config-store";
import { useSettingsAccessStore } from "@/modules/report_task/store/settings-access-store";
import { IssueReportDialog } from "@/modules/report_task/components/issue-report/issue-report-dialog";
import { canSeeIssue, canSeeIssueMessage, canSeeIssueSummaryAsHead, isIssueAgent, canManageIssueDeskSettings } from "@/modules/report_task/lib/permissions";
import {
  isKnownIssuesBannerActive,
  issueCategoryMeta,
  issuePriorityMeta,
  issueStatusMeta,
  reporterStatusGroup,
  reporterStatusGroupMeta,
  type ReporterStatusGroup,
} from "@/modules/report_task/lib/issue-meta";
import { CLOSED_STATUSES, type IssueTicket } from "@/modules/report_task/types/issue";
import { getUser, isDepartmentHead, isOwner } from "@/modules/report_task/lib/directory";
import { relativeTime } from "@/modules/report_task/lib/format";
import { cn } from "@/modules/report_task/lib/utils";

function hasUnread(ticket: IssueTicket, viewerId: string, config: { recipientDepartmentIds: string[]; extraAgentUserIds: string[] }) {
  return ticket.messages.some(
    (m) => m.authorId !== viewerId && !m.readBy.includes(viewerId) && canSeeIssueMessage(m, ticket, config, viewerId)
  );
}

function needsAgentResponse(ticket: IssueTicket): boolean {
  if (CLOSED_STATUSES.includes(ticket.status)) return false;
  if (ticket.status === "new") return true;
  const lastAll = [...ticket.messages].reverse().find((m) => m.audience === "all");
  return lastAll?.authorId === ticket.reporterId;
}

const AGENT_TABS = ["unclaimed", "mine", "needs_reply", "with_vendor", "all", "closed"] as const;
type AgentTab = (typeof AGENT_TABS)[number];
const AGENT_TAB_LABEL: Record<AgentTab, string> = {
  unclaimed: "ยังไม่มีคนรับ",
  mine: "ของฉัน",
  needs_reply: "รอฉันตอบ",
  with_vendor: "ส่งผู้พัฒนา",
  all: "ทั้งหมด",
  closed: "ปิดแล้ว",
};

const REPORTER_TABS: ("all" | ReporterStatusGroup)[] = ["all", "awaiting", "in_progress", "needs_you", "done", "closed"];

export default function IssueReportsPage() {
  const router = useRouter();
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const tickets = useIssueReportStore((s) => s.tickets);
  const config = useIssueDeskConfigStore((s) => s.config);
  const grants = useSettingsAccessStore((s) => s.grants);

  const owner = isOwner(viewingAsUserId);
  const isAgent = isIssueAgent(config, viewingAsUserId);
  const isDeskView = owner || isAgent; // sees the whole shared inbox, table layout
  const canConfigure = canManageIssueDeskSettings(viewingAsUserId, grants);

  const visibleTickets = useMemo(
    () => tickets.filter((t) => canSeeIssue(t, config, viewingAsUserId)),
    [tickets, config, viewingAsUserId]
  );

  // Metadata-only roll-up for a department head who ISN'T also an Agent
  // (an Agent-head already sees everything through the normal desk view) —
  // see canSeeIssueSummaryAsHead's doc comment for why this stays separate
  // from `visibleTickets` instead of folding into it: it's a narrower,
  // read-only surface, not full ticket access.
  const teamTickets = useMemo(
    () => (!isDeskView && isDepartmentHead(viewingAsUserId) ? tickets.filter((t) => canSeeIssueSummaryAsHead(t, viewingAsUserId)) : []),
    [tickets, isDeskView, viewingAsUserId]
  );

  const [agentTab, setAgentTab] = useState<AgentTab>("all");
  const [reporterTab, setReporterTab] = useState<"all" | ReporterStatusGroup>("all");
  const [newOpen, setNewOpen] = useState(false);

  const filtered = useMemo(() => {
    if (isDeskView) {
      switch (agentTab) {
        case "unclaimed":
          return visibleTickets.filter((t) => t.status === "new");
        case "mine":
          return visibleTickets.filter((t) => t.assigneeId === viewingAsUserId);
        case "needs_reply":
          return visibleTickets.filter(needsAgentResponse);
        case "with_vendor":
          return visibleTickets.filter((t) => ["escalated", "vendor_working", "vendor_released"].includes(t.status));
        case "closed":
          return visibleTickets.filter((t) => CLOSED_STATUSES.includes(t.status));
        default:
          return visibleTickets;
      }
    }
    if (reporterTab === "all") return visibleTickets;
    return visibleTickets.filter((t) => reporterStatusGroup(t.status) === reporterTab);
  }, [visibleTickets, isDeskView, agentTab, reporterTab, viewingAsUserId]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [filtered]);

  const stats = useMemo(() => {
    // Reading the clock here is deliberate — "closed this week" is a rolling
    // window, not a value that should freeze at first render. It's fine to
    // recompute on whatever cadence this component re-renders anyway (ticket
    // list changes drive that), so this doesn't need a timer of its own.
    // eslint-disable-next-line react-hooks/purity -- see comment above
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return {
      unclaimed: visibleTickets.filter((t) => t.status === "new").length,
      urgentOpen: visibleTickets.filter((t) => t.priority === "urgent" && !CLOSED_STATUSES.includes(t.status)).length,
      withVendor: visibleTickets.filter((t) => ["escalated", "vendor_working", "vendor_released"].includes(t.status)).length,
      closedThisWeek: visibleTickets.filter((t) => t.closedAt && new Date(t.closedAt).getTime() >= weekAgo).length,
    };
  }, [visibleTickets]);

  return (
    <div className="flex flex-col gap-6">
      <StickyFilterBar
        actions={
          <div className="flex items-center gap-2">
            {canConfigure && (
              <Link
                href="/settings?tab=issueDesk"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-white hover:bg-[var(--bg-soft)] px-2.5 py-2 text-sm font-medium transition-colors"
              >
                <Settings2 className="h-4 w-4" /> ตั้งค่า
              </Link>
            )}
            <Button
              className="bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white"
              onClick={() => setNewOpen(true)}
            >
              <Send className="h-4 w-4" /> แจ้งปัญหาใหม่
            </Button>
          </div>
        }
      >
        {/* A reporter with zero tickets has nothing to filter — showing 6
         * filter chips above an empty state reads as "the feature is
         * broken," not "you have nothing yet". Agents always see the
         * toolbar since the shared inbox is never truly empty for them in
         * practice. See ISSUE_DESK_AUDIT_2026-08-08.md §C1. */}
        {(isDeskView || visibleTickets.length > 0) && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex items-center gap-1 flex-wrap">
              {isDeskView
                ? AGENT_TABS.map((key) => (
                    <TabChip key={key} active={agentTab === key} onClick={() => setAgentTab(key)} label={AGENT_TAB_LABEL[key]} />
                  ))
                : REPORTER_TABS.map((key) => (
                    <TabChip
                      key={key}
                      active={reporterTab === key}
                      onClick={() => setReporterTab(key)}
                      label={key === "all" ? "ทั้งหมด" : reporterStatusGroupMeta[key].label}
                    />
                  ))}
            </div>
          </div>
        )}
      </StickyFilterBar>

      {isKnownIssuesBannerActive(config.knownIssuesBanner) && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-[var(--chart-amber)]">
          <Megaphone className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{config.knownIssuesBanner?.text}</span>
        </div>
      )}

      {isDeskView && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatPill label="ยังไม่รับ" value={stats.unclaimed} colorVar="var(--chart-red)" />
          <StatPill label="ด่วน (เปิดอยู่)" value={stats.urgentOpen} colorVar="var(--chart-orange)" />
          <StatPill label="อยู่ที่ผู้พัฒนา" value={stats.withVendor} colorVar="var(--chart-blue)" />
          <StatPill label="ปิดสัปดาห์นี้" value={stats.closedThisWeek} colorVar="var(--brand-green-dark)" />
        </div>
      )}

      {teamTickets.length > 0 && <TeamTicketsPanel tickets={teamTickets} />}

      {sorted.length === 0 ? (
        <EmptyState isDeskView={isDeskView} hasAnyTickets={visibleTickets.length > 0} onCreate={() => setNewOpen(true)} />
      ) : isDeskView ? (
        <>
          <div className="hidden md:block rounded-2xl border border-[var(--line)] bg-white overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>เรื่อง</TableHead>
                  <TableHead>ประเภท</TableHead>
                  <TableHead>สำคัญ</TableHead>
                  <TableHead>ผู้รับผิดชอบ</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead>อายุ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((t) => (
                  <TicketRow key={t.id} ticket={t} viewingAsUserId={viewingAsUserId} config={config} onClick={() => router.push(`/issue-reports/${t.id}`)} />
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="md:hidden flex flex-col gap-2">
            {sorted.map((t) => (
              <TicketCard key={t.id} ticket={t} viewingAsUserId={viewingAsUserId} config={config} onClick={() => router.push(`/issue-reports/${t.id}`)} />
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((t) => (
            <TicketCard key={t.id} ticket={t} viewingAsUserId={viewingAsUserId} config={config} onClick={() => router.push(`/issue-reports/${t.id}`)} />
          ))}
        </div>
      )}

      <IssueReportDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}

/**
 * A department head's read-only roll-up — title, status, age, who filed it.
 * Deliberately not a link into the ticket: canSeeIssue doesn't grant heads
 * the thread, so clicking through would just dead-end at "ไม่มีสิทธิ์ดูตั๋วนี้".
 * See ISSUE_DESK_AUDIT_2026-08-08.md §C3.
 */
function TeamTicketsPanel({ tickets }: { tickets: IssueTicket[] }) {
  const sorted = [...tickets].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-4">
      <p className="text-sm font-medium">ของทีมฉัน</p>
      <p className="text-xs text-[var(--ink-soft)] mt-0.5 mb-3">
        เห็นแค่หัวข้อ+สถานะของเรื่องที่ลูกทีมแจ้งและเลือกให้คุณเห็น — ไม่เห็นเนื้อหาในตั๋ว
      </p>
      <div className="flex flex-col gap-1.5">
        {sorted.map((t) => {
          const reporter = getUser(t.reporterId);
          const groupMeta = reporterStatusGroupMeta[reporterStatusGroup(t.status)];
          return (
            <div key={t.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--bg-soft)]">
              <Avatar className="h-5 w-5 shrink-0"><AvatarFallback className="text-[9px] bg-[var(--accent)]">{reporter?.avatar}</AvatarFallback></Avatar>
              <span className="text-xs text-[var(--ink-soft)] shrink-0">{reporter?.name}</span>
              <span className="text-sm truncate flex-1">{t.title}</span>
              <Badge variant="outline" className={cn("text-[10px] gap-1 shrink-0", groupMeta.className)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", groupMeta.dot)} /> {groupMeta.label}
              </Badge>
              <span className="text-[11px] text-[var(--ink-soft)] shrink-0">{relativeTime(t.createdAt)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatPill({ label, value, colorVar }: { label: string; value: number; colorVar: string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5">
      <p className="text-[11px] text-[var(--ink-soft)]">{label}</p>
      <p className="text-xl font-semibold tabular-nums" style={{ color: colorVar }}>{value}</p>
    </div>
  );
}

function TabChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-xs font-medium rounded-full px-3 py-1.5 border transition-colors whitespace-nowrap",
        active ? "bg-[var(--ink)] text-white border-[var(--ink)]" : "bg-white text-[var(--ink-soft)] border-[var(--line)] hover:bg-[var(--bg-soft)]"
      )}
    >
      {label}
    </button>
  );
}

function TicketMeta({ ticket }: { ticket: IssueTicket }) {
  const CategoryIcon = issueCategoryMeta[ticket.category].icon;
  return (
    <span className="inline-flex items-center gap-1 text-[var(--ink-soft)]">
      <CategoryIcon className="h-3.5 w-3.5" /> {issueCategoryMeta[ticket.category].label}
    </span>
  );
}

function TicketRow({
  ticket,
  viewingAsUserId,
  config,
  onClick,
}: {
  ticket: IssueTicket;
  viewingAsUserId: string;
  config: { recipientDepartmentIds: string[]; extraAgentUserIds: string[] };
  onClick: () => void;
}) {
  const reporter = getUser(ticket.reporterId);
  const assignee = ticket.assigneeId ? getUser(ticket.assigneeId) : null;
  const unread = hasUnread(ticket, viewingAsUserId, config);
  return (
    <TableRow onClick={onClick} className="cursor-pointer">
      <TableCell className="font-mono text-xs text-[var(--ink-soft)]">
        <span className="flex items-center gap-1.5">
          {unread && <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-green)]" />}
          {ticket.code}
        </span>
      </TableCell>
      <TableCell className="max-w-[320px]">
        <p className="truncate font-medium">{ticket.title}</p>
        <p className="text-[11px] text-[var(--ink-soft)] flex items-center gap-2 mt-0.5">
          {reporter?.name}
          {ticket.attachments.length > 0 && (
            <span className="inline-flex items-center gap-0.5"><Paperclip className="h-3 w-3" />{ticket.attachments.length}</span>
          )}
          {ticket.messages.length > 0 && (
            <span className="inline-flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{ticket.messages.length}</span>
          )}
        </p>
      </TableCell>
      <TableCell><TicketMeta ticket={ticket} /></TableCell>
      <TableCell>
        <span className="text-xs font-medium" style={{ color: issuePriorityMeta[ticket.priority].colorVar }}>
          {issuePriorityMeta[ticket.priority].label}
        </span>
      </TableCell>
      <TableCell>
        {assignee ? (
          <span className="inline-flex items-center gap-1.5">
            <Avatar className="h-5 w-5"><AvatarFallback className="text-[9px] bg-[var(--accent)]">{assignee.avatar}</AvatarFallback></Avatar>
            <span className="text-xs">{assignee.name}</span>
          </span>
        ) : (
          <span className="text-xs text-[var(--ink-soft)]">—</span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="text-[10px]">{issueStatusMeta[ticket.status].label}</Badge>
      </TableCell>
      <TableCell className="text-xs text-[var(--ink-soft)]">{relativeTime(ticket.createdAt)}</TableCell>
    </TableRow>
  );
}

function TicketCard({
  ticket,
  viewingAsUserId,
  config,
  onClick,
}: {
  ticket: IssueTicket;
  viewingAsUserId: string;
  config: { recipientDepartmentIds: string[]; extraAgentUserIds: string[] };
  onClick: () => void;
}) {
  const reporter = getUser(ticket.reporterId);
  const group = reporterStatusGroup(ticket.status);
  const groupMeta = reporterStatusGroupMeta[group];
  const unread = hasUnread(ticket, viewingAsUserId, config);
  return (
    <button
      onClick={onClick}
      className="text-left rounded-2xl border border-[var(--line)] bg-white p-4 shadow-sm hover:border-[var(--brand-green)] transition-colors flex items-start gap-3"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-soft)] text-[var(--ink-soft)]">
        {(() => {
          const Icon = issueCategoryMeta[ticket.category].icon;
          return <Icon className="h-4 w-4" />;
        })()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          {unread && <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-green)]" />}
          <span className="font-mono text-[11px] text-[var(--ink-soft)]">{ticket.code}</span>
          <p className="text-sm font-medium truncate">{ticket.title}</p>
          <Badge variant="outline" className={cn("text-[10px] gap-1", groupMeta.className)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", groupMeta.dot)} /> {groupMeta.label}
          </Badge>
        </div>
        <p className="text-xs text-[var(--ink-soft)] mt-1 line-clamp-1">{ticket.description || "ไม่มีรายละเอียดเพิ่มเติม"}</p>
        <div className="flex items-center gap-2 mt-2 text-[11px] text-[var(--ink-soft)]">
          <Avatar className="h-4 w-4"><AvatarFallback className="text-[8px] bg-[var(--accent)]">{reporter?.avatar}</AvatarFallback></Avatar>
          {reporter?.name} · {relativeTime(ticket.createdAt)}
          {ticket.attachments.length > 0 && <span className="inline-flex items-center gap-0.5"><Paperclip className="h-3 w-3" />{ticket.attachments.length}</span>}
          {ticket.messages.length > 0 && <span>· {ticket.messages.length} ข้อความ</span>}
        </div>
      </div>
    </button>
  );
}

function EmptyState({ isDeskView, hasAnyTickets, onCreate }: { isDeskView: boolean; hasAnyTickets: boolean; onCreate: () => void }) {
  if (hasAnyTickets) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--line)] bg-white p-10 text-center">
        <p className="text-sm text-[var(--ink-soft)]">ไม่มีตั๋วตรงกับตัวกรองนี้</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-dashed border-[var(--line)] bg-white p-10 text-center">
      <p className="text-sm font-medium mb-1">{isDeskView ? "ยังไม่มีตั๋วเข้ามา" : "คุณยังไม่เคยแจ้งปัญหาอะไรเลย"}</p>
      {!isDeskView && (
        <div className="text-xs text-[var(--ink-soft)] max-w-sm mx-auto mt-2 space-y-1 text-left">
          <p className="font-medium text-[var(--ink)]">แจ้งปัญหาให้ทีมช่วยได้เร็วขึ้น:</p>
          <p>• บอกว่าทำอะไรอยู่ตอนเจอปัญหา และคาดว่าควรเป็นยังไง</p>
          <p>• แนบภาพหน้าจอ — วาง Ctrl+V ได้เลยหลังกด PrintScreen</p>
          <p>• เลือก &ldquo;ตอนนี้คุณ…&rdquo; ให้ตรง จะช่วยให้ทีมจัดคิวถูก</p>
        </div>
      )}
      <Button onClick={onCreate} className="mt-4 bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white">
        <Send className="h-4 w-4" /> แจ้งปัญหาใหม่
      </Button>
    </div>
  );
}

