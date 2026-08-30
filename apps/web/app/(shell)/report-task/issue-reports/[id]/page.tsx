"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  ExternalLink,
  Paperclip,
  Lock,
  Users,
  CheckCircle2,
  XCircle,
  Info,
} from "lucide-react";
import { Button } from "@/modules/report_task/components/ui/button";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { Textarea } from "@/modules/report_task/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/modules/report_task/components/ui/tooltip";
import { AttachmentPicker } from "@/modules/report_task/components/issue-report/attachment-picker";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useIssueReportStore } from "@/modules/report_task/store/issue-report-store";
import { useIssueDeskConfigStore } from "@/modules/report_task/store/issue-desk-config-store";
import { useSettingsAccessStore } from "@/modules/report_task/store/settings-access-store";
import {
  canConfirmResolution,
  canEscalateIssue,
  canManageIssue,
  canReporterCloseOwnIssue,
  canSeeIssue,
  canSeeIssueMessage,
  canViewCompanyIssues,
  isIssueAgent,
} from "@/modules/report_task/lib/permissions";
import {
  formatWaitDuration,
  issueCategoryMeta,
  issueImpactMeta,
  issuePriorityMeta,
  issueStatusMeta,
  nextStatusOptions,
  reporterStatusGroup,
  reporterStatusGroupMeta,
} from "@/modules/report_task/lib/issue-meta";
import { POST_TRIAGE_STATUSES, type IssueAttachment, type IssueAudience, type IssueMessage, type IssuePriority, type IssueStatus, type IssueTicket } from "@/modules/report_task/types/issue";
import { getUser, users } from "@/modules/report_task/lib/directory";
import { relativeTime, formatDate } from "@/modules/report_task/lib/format";
import { cn } from "@/modules/report_task/lib/utils";

export default function IssueTicketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const tickets = useIssueReportStore((s) => s.tickets);
  const config = useIssueDeskConfigStore((s) => s.config);
  const grants = useSettingsAccessStore((s) => s.grants);
  const markRead = useIssueReportStore((s) => s.markRead);

  const ticket = tickets.find((t) => t.id === params.id);

  // Read-only company-wide oversight (CEO/owner or whoever they delegated
  // it to, typically IT) — sees the ticket + its "all"-audience thread, same
  // as canSeeIssue/canSeeIssueMessage below already fold in.
  const canOversee = canViewCompanyIssues(viewingAsUserId, grants);
  const canSee = ticket ? canSeeIssue(ticket, config, viewingAsUserId, canOversee) : false;
  // Retired for every company, owner included — claim/assign/priority/staff
  // notes now live only in SmartBoss's own admin console. See the matching
  // comment on isIssueAgent in lib/permissions.ts.
  const isDeskView = false;
  const [tab, setTab] = useState<IssueAudience>("all");

  const visibleMessages = useMemo(
    () => (ticket ? ticket.messages.filter((m) => m.audience === tab && canSeeIssueMessage(m, ticket, config, viewingAsUserId, canOversee)) : []),
    [ticket, tab, config, viewingAsUserId, canOversee]
  );

  useEffect(() => {
    if (!ticket) return;
    const unreadIds = visibleMessages.filter((m) => !m.readBy.includes(viewingAsUserId)).map((m) => m.id);
    if (unreadIds.length > 0) markRead(ticket.id, unreadIds, viewingAsUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id, tab, visibleMessages.length]);

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <p className="text-sm text-[var(--ink-soft)]">ไม่พบตั๋วนี้ — อาจถูกลบหรือลิงก์ไม่ถูกต้อง</p>
        <Button variant="outline" onClick={() => router.push("/report-task/issue-reports")}>
          <ArrowLeft className="h-4 w-4" /> กลับไปหน้ารายการ
        </Button>
      </div>
    );
  }

  if (!canSee) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <p className="text-sm text-[var(--ink-soft)]">คุณไม่มีสิทธิ์ดูตั๋วนี้</p>
        <Button variant="outline" onClick={() => router.push("/report-task/issue-reports")}>
          <ArrowLeft className="h-4 w-4" /> กลับไปหน้ารายการ
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pt-4 lg:pt-6">
      <button
        onClick={() => router.push("/report-task/issue-reports")}
        className="inline-flex items-center gap-1 text-xs text-[var(--ink-soft)] hover:text-[var(--ink)] self-start"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> กลับไปหน้ารายการ
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 items-start">
        <div className="rounded-2xl border border-[var(--line)] bg-white flex flex-col min-h-[70vh]">
          <TicketThreadHeader ticket={ticket} isDeskView={isDeskView} tab={tab} setTab={setTab} />
          <TicketTimeline messages={visibleMessages} tab={tab} />
          {ticket.status === "pending_verify" && canConfirmResolution(ticket, config, viewingAsUserId) && (
            <ResolutionConfirmBar ticket={ticket} viewingAsUserId={viewingAsUserId} />
          )}
          {/* Read-only for a company overseer (CEO/IT) — they can see the
              thread and status, never post as if they were the reporter or
              staff. Posting a reply is reporter-only now that there's no
              more in-company agent to reply as staff either. */}
          {ticket.reporterId === viewingAsUserId ? (
            <TicketComposer ticket={ticket} tab={tab} viewingAsUserId={viewingAsUserId} isDeskView={isDeskView} />
          ) : (
            canOversee && (
              <p className="border-t border-[var(--line)] px-4 py-3 text-xs text-[var(--ink-soft)]">
                คุณกำลังดูอย่างเดียว (สิทธิ์ดูภาพรวม) — ทีม Smartboss เป็นผู้ตอบและปิดเรื่องนี้
              </p>
            )
          )}
        </div>

        <TicketSidePanel ticket={ticket} viewingAsUserId={viewingAsUserId} config={config} isDeskView={isDeskView} allTickets={tickets} />
      </div>
    </div>
  );
}

function TicketThreadHeader({
  ticket,
  isDeskView,
  tab,
  setTab,
}: {
  ticket: IssueTicket;
  isDeskView: boolean;
  tab: IssueAudience;
  setTab: (t: IssueAudience) => void;
}) {
  const reporter = getUser(ticket.reporterId);
  return (
    <div className="p-4 border-b border-[var(--line)] flex flex-col gap-2">
      <div>
        <p className="text-xs font-mono text-[var(--ink-soft)]">{ticket.code}</p>
        <h1 className="text-lg font-semibold">{ticket.title}</h1>
        <p className="text-xs text-[var(--ink-soft)] mt-0.5">
          แจ้งโดย {reporter?.name} · {relativeTime(ticket.createdAt)}
        </p>
      </div>
      {isDeskView && (
        <div className="flex items-center gap-1.5">
          <TabButton active={tab === "all"} onClick={() => setTab("all")} icon={<Users className="h-3.5 w-3.5" />} label="คุยกับผู้แจ้ง" />
          <TabButton active={tab === "staff"} onClick={() => setTab("staff")} icon={<Lock className="h-3.5 w-3.5" />} label="โน้ตภายใน" />
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "border-[var(--brand-green)] bg-[var(--accent)] text-[var(--brand-green-dark)]" : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
      )}
    >
      {icon} {label}
    </button>
  );
}

function TicketTimeline({ messages, tab }: { messages: IssueMessage[]; tab: IssueAudience }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3">
      {messages.length === 0 && (
        <p className="text-xs text-[var(--ink-soft)] text-center py-8">
          {tab === "staff" ? "ยังไม่มีโน้ตภายใน" : "ยังไม่มีข้อความ"}
        </p>
      )}
      {messages.map((m) =>
        m.kind === "event" ? (
          <div key={m.id} className="flex items-center gap-2 text-[11px] text-[var(--ink-soft)] pl-1">
            <span className="h-1 w-1 rounded-full bg-[var(--ink-soft)]" />
            {getUser(m.authorId)?.name ?? "ระบบ"} — {m.body} · {relativeTime(m.createdAt)}
          </div>
        ) : (
          <MessageBubble key={m.id} message={m} />
        )
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: IssueMessage }) {
  const author = getUser(message.authorId);
  return (
    <div className="flex items-start gap-2.5">
      <Avatar className="h-7 w-7 shrink-0"><AvatarFallback className="text-[10px] bg-[var(--accent)]">{author?.avatar}</AvatarFallback></Avatar>
      <div className={cn("min-w-0 flex-1 rounded-lg px-3 py-2", message.audience === "staff" ? "bg-amber-50" : "bg-[var(--bg-soft)]")}>
        <p className="text-xs font-medium">{author?.name}</p>
        {message.body && <p className="text-sm whitespace-pre-wrap mt-0.5">{message.body}</p>}
        {message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {message.attachments.map((a: IssueAttachment) =>
              a.isPreviewable ? (
                <img key={a.id} src={a.url} alt={a.name} className="h-20 w-20 rounded-md object-cover border border-[var(--line)]" />
              ) : (
                <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-md border border-[var(--line)] bg-white px-2 py-1 text-xs">
                  <Paperclip className="h-3 w-3" /> {a.name}
                </a>
              )
            )}
          </div>
        )}
        <p className="text-[10px] text-[var(--ink-soft)] mt-1">{formatDate(message.createdAt)}</p>
      </div>
    </div>
  );
}

function ResolutionConfirmBar({ ticket, viewingAsUserId }: { ticket: IssueTicket; viewingAsUserId: string }) {
  const confirmResolution = useIssueReportStore((s) => s.confirmResolution);
  const isReporter = ticket.reporterId === viewingAsUserId;
  const [reasonOpen, setReasonOpen] = useState<"worked" | "not_worked" | null>(null);
  const [reason, setReason] = useState("");

  function act(worked: boolean) {
    if (!isReporter && !reason.trim()) {
      setReasonOpen(worked ? "worked" : "not_worked");
      return;
    }
    confirmResolution(ticket.id, viewingAsUserId, worked, !isReporter ? reason.trim() : undefined);
    setReasonOpen(null);
    setReason("");
  }

  return (
    <div className="border-t border-[var(--line)] p-4 bg-blue-50/50 flex flex-col gap-2">
      <p className="text-sm font-medium">ทีมแจ้งว่าแก้ไขแล้ว — ยืนยันได้ไหม?</p>
      {reasonOpen && (
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="เหตุผลที่ปิด/เปิดกลับแทนผู้แจ้ง…"
          rows={2}
          autoFocus
        />
      )}
      <div className="flex gap-2">
        <Button className="bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white" onClick={() => act(true)}>
          <CheckCircle2 className="h-4 w-4" /> ใช้ได้แล้ว
        </Button>
        <Button variant="outline" onClick={() => act(false)}>
          <XCircle className="h-4 w-4" /> ยังไม่หาย
        </Button>
        {reasonOpen && (
          <Button variant="ghost" onClick={() => { setReasonOpen(null); setReason(""); }}>ยกเลิก</Button>
        )}
      </div>
    </div>
  );
}

function TicketComposer({
  ticket,
  tab,
  viewingAsUserId,
  isDeskView,
}: {
  ticket: IssueTicket;
  tab: IssueAudience;
  viewingAsUserId: string;
  isDeskView: boolean;
}) {
  const addMessage = useIssueReportStore((s) => s.addMessage);
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<IssueAttachment[]>([]);

  function send() {
    if (!body.trim() && attachments.length === 0) return;
    addMessage(ticket.id, viewingAsUserId, body.trim(), tab, attachments);
    setBody("");
    setAttachments([]);
  }

  return (
    <div className="border-t border-[var(--line)] p-4 flex flex-col gap-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={tab === "staff" ? "โน้ตภายใน (ผู้แจ้งไม่เห็น)…" : "พิมพ์ข้อความ…"}
        rows={2}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
        }}
      />
      <AttachmentPicker attachments={attachments} onChange={setAttachments} uploadedBy={viewingAsUserId} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--ink-soft)]">
          {tab === "staff" ? "ⓘ เฉพาะทีมดูแลระบบเห็นข้อความในแท็บนี้" : "ⓘ ข้อความในแท็บนี้ ผู้แจ้งเห็นด้วย"}
        </p>
        <Button size="sm" className="bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white" onClick={send}>
          ส่ง
        </Button>
      </div>
    </div>
  );
}

function TicketSidePanel({
  ticket,
  viewingAsUserId,
  config,
  isDeskView,
  allTickets,
}: {
  ticket: IssueTicket;
  viewingAsUserId: string;
  config: { recipientDepartmentIds: string[]; extraAgentUserIds: string[] };
  isDeskView: boolean;
  allTickets: IssueTicket[];
}) {
  const setStatus = useIssueReportStore((s) => s.setStatus);
  const setPriority = useIssueReportStore((s) => s.setPriority);
  const setAssignee = useIssueReportStore((s) => s.setAssignee);

  const canManage = canManageIssue(config, viewingAsUserId);
  const canCloseOwn = canReporterCloseOwnIssue(ticket, viewingAsUserId);
  const canEscalate = canEscalateIssue(ticket, config, viewingAsUserId, POST_TRIAGE_STATUSES);

  const [escalatePromptOpen, setEscalatePromptOpen] = useState(false);
  const [whatWasChecked, setWhatWasChecked] = useState("");
  const [rejectPromptOpen, setRejectPromptOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [duplicatePromptOpen, setDuplicatePromptOpen] = useState(false);
  const [duplicateCode, setDuplicateCode] = useState("");

  const agentCandidates = users.filter((u) => isIssueAgent(config, u.id));
  const reporter = getUser(ticket.reporterId);
  const groupMeta = reporterStatusGroupMeta[reporterStatusGroup(ticket.status)];

  function handleStatusChange(status: IssueStatus) {
    if (status === "escalated" && !ticket.escalatedAt) {
      setEscalatePromptOpen(true);
      return;
    }
    if (status === "rejected") {
      setRejectPromptOpen(true);
      return;
    }
    if (status === "duplicate") {
      setDuplicatePromptOpen(true);
      return;
    }
    setStatus(ticket.id, status, viewingAsUserId);
  }

  function confirmEscalate() {
    if (!whatWasChecked.trim()) {
      toast.error("กรุณากรอกสิ่งที่ตรวจสอบแล้วก่อน escalate");
      return;
    }
    setStatus(ticket.id, "escalated", viewingAsUserId, { whatWasChecked: whatWasChecked.trim() });
    setEscalatePromptOpen(false);
    setWhatWasChecked("");
  }

  function confirmReject() {
    if (!rejectReason.trim()) {
      toast.error("กรุณากรอกเหตุผล");
      return;
    }
    setStatus(ticket.id, "rejected", viewingAsUserId, { rejectReason: rejectReason.trim() });
    setRejectPromptOpen(false);
    setRejectReason("");
  }

  function confirmDuplicate() {
    const target = allTickets.find((t) => t.code.toLowerCase() === duplicateCode.trim().toLowerCase());
    if (!target) {
      toast.error("ไม่พบตั๋วเลขนี้");
      return;
    }
    setStatus(ticket.id, "duplicate", viewingAsUserId, { duplicateOfId: target.id });
    setDuplicatePromptOpen(false);
    setDuplicateCode("");
  }

  const [confirmingSelfClose, setConfirmingSelfClose] = useState(false);

  function claim() {
    setStatus(ticket.id, "triaged", viewingAsUserId);
    setAssignee(ticket.id, viewingAsUserId, viewingAsUserId);
  }

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-4 flex flex-col gap-4 lg:sticky lg:top-20">
      <div>
        <p className="text-xs text-[var(--ink-soft)] mb-1">สถานะ</p>
        {isDeskView && canManage && ticket.status === "new" ? (
          // One big, single action instead of "open the status dropdown, pick
          // รับเรื่องแล้ว, then separately assign yourself" — see
          // ISSUE_DESK_AUDIT_2026-08-08.md §C2.
          <Button
            className="w-full bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white"
            onClick={claim}
          >
            รับเรื่อง + มอบหมายให้ฉัน
          </Button>
        ) : isDeskView && canManage ? (
          <Select value={ticket.status} onValueChange={(v) => v && handleStatusChange(v as IssueStatus)}>
            <SelectTrigger className="w-full"><SelectValue>{issueStatusMeta[ticket.status].label}</SelectValue></SelectTrigger>
            <SelectContent>
              {nextStatusOptions(ticket.status).map((s) => (
                <SelectItem key={s} value={s}>{issueStatusMeta[s].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="outline" className={cn("gap-1.5", groupMeta.className)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", groupMeta.dot)} /> {groupMeta.label}
          </Badge>
        )}
        {isDeskView && <p className="text-[11px] text-[var(--ink-soft)] mt-1.5">รอมาแล้ว {formatWaitDuration(ticket.createdAt)}</p>}
        {canCloseOwn && !isDeskView && ticket.status !== "resolved" && (
          confirmingSelfClose ? (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-[var(--ink-soft)]">ปิดเรื่องนี้เลยไหม?</span>
              <button
                className="font-medium text-[var(--brand-green-dark)] hover:underline"
                onClick={() => setStatus(ticket.id, "resolved", viewingAsUserId)}
              >
                ยืนยัน
              </button>
              <button className="text-[var(--ink-soft)] hover:underline" onClick={() => setConfirmingSelfClose(false)}>
                ยกเลิก
              </button>
            </div>
          ) : (
            <button
              className="mt-2 text-xs text-[var(--ink-soft)] hover:text-[var(--ink)] hover:underline"
              onClick={() => setConfirmingSelfClose(true)}
            >
              ปิดเรื่องนี้เอง
            </button>
          )
        )}
      </div>

      {escalatePromptOpen && (
        <PromptBlock
          label="สิ่งที่ตรวจสอบแล้วก่อนส่งต่อผู้พัฒนา"
          value={whatWasChecked}
          onChange={setWhatWasChecked}
          onConfirm={confirmEscalate}
          onCancel={() => setEscalatePromptOpen(false)}
        />
      )}
      {rejectPromptOpen && (
        <PromptBlock label="เหตุผลที่ไม่ดำเนินการ" value={rejectReason} onChange={setRejectReason} onConfirm={confirmReject} onCancel={() => setRejectPromptOpen(false)} />
      )}
      {duplicatePromptOpen && (
        <PromptBlock label="เลขตั๋วต้นทาง (เช่น IS-0001)" value={duplicateCode} onChange={setDuplicateCode} onConfirm={confirmDuplicate} onCancel={() => setDuplicatePromptOpen(false)} />
      )}

      {isDeskView && canManage && (
        <div>
          <p className="text-xs text-[var(--ink-soft)] mb-1">ความสำคัญ</p>
          <Select value={ticket.priority} onValueChange={(v) => v && setPriority(ticket.id, v as IssuePriority, viewingAsUserId)}>
            <SelectTrigger className="w-full"><SelectValue>{issuePriorityMeta[ticket.priority].label}</SelectValue></SelectTrigger>
            <SelectContent>
              {(Object.keys(issuePriorityMeta) as IssuePriority[]).map((p) => (
                <SelectItem key={p} value={p}>{issuePriorityMeta[p].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isDeskView && canManage && (
        <div>
          <p className="text-xs text-[var(--ink-soft)] mb-1">ผู้รับผิดชอบ</p>
          <Select value={ticket.assigneeId ?? "__none"} onValueChange={(v) => setAssignee(ticket.id, v === "__none" ? null : v, viewingAsUserId)}>
            <SelectTrigger className="w-full"><SelectValue>{ticket.assigneeId ? getUser(ticket.assigneeId)?.name : "ยังไม่มอบหมาย"}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">ยังไม่มอบหมาย</SelectItem>
              {agentCandidates.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="border-t border-[var(--line)] pt-3 flex flex-col gap-1.5 text-xs">
        <Row label="ประเภท" value={issueCategoryMeta[ticket.category].label} />
        <Row label="ผลกระทบ" value={issueImpactMeta[ticket.impact].label} />
        {isDeskView && (
          <>
            {/* Debug context — meaningful to whoever's diagnosing the ticket,
             * meaningless (and a little "why is the system watching me?"
             * unsettling) to the reporter. See ISSUE_DESK_AUDIT_2026-08-08.md §C1. */}
            <Row
              label="แจ้งจากหน้า"
              value={ticket.context.pageUrl}
              info="เก็บอัตโนมัติตอนผู้แจ้งกดส่ง — กันไม่ให้ต้องถามซ้ำว่า 'เกิดที่หน้าไหน' ซึ่งเป็นคำถามแรกที่ทีมต้องถามแทบทุกครั้ง"
            />
            {ticket.context.viewport && (
              <Row
                label="ขนาดจอ"
                value={ticket.context.viewport}
                info="มีประโยชน์เฉพาะบั๊กที่เกี่ยวกับหน้าตา/การจัดวางที่ผิดแค่บางขนาดจอ — เคสอื่น (ใช้งานไม่ได้ ข้อมูลผิด) ไม่ต้องสนใจค่านี้"
              />
            )}
          </>
        )}
        {ticket.whatWasChecked && <Row label="IT ตรวจแล้ว" value={ticket.whatWasChecked} />}
        {ticket.rejectReason && <Row label="เหตุผลที่ไม่ดำเนินการ" value={ticket.rejectReason} />}
        {ticket.duplicateOfId && (
          <div className="flex items-center gap-1 text-[var(--brand-green-dark)]">
            <ExternalLink className="h-3 w-3" />
            <a href={`/report-task/issue-reports/${ticket.duplicateOfId}`} className="hover:underline">
              ซ้ำกับ {allTickets.find((t) => t.id === ticket.duplicateOfId)?.code ?? "-"}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, info }: { label: string; value: string; info?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[var(--ink-soft)] shrink-0 inline-flex items-center gap-1">
        {label}
        {info && (
          <Tooltip>
            <TooltipTrigger render={<button type="button" aria-label={`ทำไมถึงแสดง ${label}`} className="text-[var(--ink-soft)]/70 hover:text-[var(--ink)]" />}>
              <Info className="h-3 w-3" />
            </TooltipTrigger>
            <TooltipContent className="max-w-[220px] text-left">{info}</TooltipContent>
          </Tooltip>
        )}
      </span>
      <span className="text-right break-all">{value}</span>
    </div>
  );
}

function PromptBlock({
  label,
  value,
  onChange,
  onConfirm,
  onCancel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] p-2.5 flex flex-col gap-2">
      <p className="text-xs font-medium">{label}</p>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} autoFocus />
      <div className="flex gap-2">
        <Button size="sm" onClick={onConfirm}>ยืนยัน</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>ยกเลิก</Button>
      </div>
    </div>
  );
}
