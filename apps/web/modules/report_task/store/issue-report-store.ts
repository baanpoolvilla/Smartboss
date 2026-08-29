import { create } from "zustand";
import { getUser, users } from "@/modules/report_task/lib/directory";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useActivityLogStore } from "@/modules/report_task/store/activity-log-store";
import { useIssueDeskConfigStore } from "@/modules/report_task/store/issue-desk-config-store";
import { isIssueAgent } from "@/modules/report_task/lib/permissions";
import { defaultPriorityFor, nextTicketCode, issueStatusMeta, issuePriorityMeta, reporterStatusGroup } from "@/modules/report_task/lib/issue-meta";
import { migrateIssueStoreSlice, extractV1RecipientDepartmentIds, ISSUE_STORE_SCHEMA_VERSION, type IssueStoreSlice } from "@/modules/report_task/lib/issue-migration";
import type {
  IssueAttachment,
  IssueAudience,
  IssueCategory,
  IssueImpact,
  IssueMessage,
  IssueStatus,
  IssueTicket,
} from "@/modules/report_task/types/issue";

export type { IssueCategory, IssueStatus } from "@/modules/report_task/types/issue";

interface NewTicketInput {
  reporterId: string;
  category: IssueCategory;
  title: string;
  description: string;
  impact: IssueImpact;
  shareWithHead: boolean;
  context: IssueTicket["context"];
  attachments: IssueAttachment[];
}

interface IssueReportStore extends IssueStoreSlice {
  addTicket: (input: NewTicketInput) => IssueTicket;
  addMessage: (ticketId: string, authorId: string, body: string, audience: IssueAudience, attachments?: IssueAttachment[]) => void;
  setStatus: (
    ticketId: string,
    status: IssueStatus,
    byUserId: string,
    extra?: { rejectReason?: string; duplicateOfId?: string; whatWasChecked?: string }
  ) => void;
  setPriority: (ticketId: string, priority: IssueTicket["priority"], byUserId: string) => void;
  setAssignee: (ticketId: string, assigneeId: string | null, byUserId: string) => void;
  setVisibility: (ticketId: string, visibility: IssueTicket["visibility"]) => void;
  confirmResolution: (ticketId: string, userId: string, worked: boolean, reason?: string) => void;
  markRead: (ticketId: string, messageIds: string[], userId: string) => void;
}

function agents(): string[] {
  const cfg = useIssueDeskConfigStore.getState().config;
  return users.filter((u) => isIssueAgent(cfg, u.id)).map((u) => u.id);
}

function notifyTicket(ticket: IssueTicket, userId: string, byUserId: string, message: string) {
  if (userId === byUserId) return;
  useNotificationStore.getState().notify({ userId, byUserId, message, link: `/report-task/issue-reports/${ticket.id}` });
}

function logTicketActivity(ticket: IssueTicket, byUserId: string, action: string, detail?: string) {
  useActivityLogStore.getState().log({ userId: byUserId, action, target: `${ticket.code} · ${ticket.title}`, detail });
}

function pushEvent(
  ticket: IssueTicket,
  authorId: string,
  body: string,
  event: NonNullable<IssueMessage["event"]>,
  audience: IssueAudience = "all"
): IssueMessage {
  return {
    id: `${ticket.id}-evt-${crypto.randomUUID()}`,
    kind: "event",
    authorId,
    audience,
    body,
    event,
    attachments: [],
    createdAt: new Date().toISOString(),
    editedAt: null,
    readBy: [authorId],
  };
}

// Server-synced via ServerStoreSync (apiKey "issue-reports") in
// store-hydrator.tsx — shared company-wide, not per-browser. Config
// (recipient departments, categories, banner) lives in the separate
// issue-desk-config-store/key — see its file header for why.
export const useIssueReportStore = create<IssueReportStore>()((set, get) => ({
  schemaVersion: ISSUE_STORE_SCHEMA_VERSION,
  tickets: [],

  addTicket: (input) => {
    const now = new Date().toISOString();
    const priority = defaultPriorityFor(input.impact, input.category);
    const ticket: IssueTicket = {
      id: `issue-${crypto.randomUUID()}`,
      code: nextTicketCode(get().tickets.length),
      reporterId: input.reporterId,
      category: input.category,
      title: input.title,
      description: input.description,
      impact: input.impact,
      status: "new",
      priority,
      assigneeId: null,
      vendorAssigneeId: null,
      visibility: "private",
      shareWithHead: input.shareWithHead,
      context: input.context,
      attachments: input.attachments,
      // The ticket itself is always the first timeline entry — never an
      // empty "ยังไม่มีข้อความ" screen right after submitting (see
      // ISSUE_DESK_AUDIT_2026-08-08.md §B3). Falls back to the title when
      // the description was left blank (the composer already strips an
      // untouched template before this runs), so the bubble is never truly
      // empty, followed by an event marking it as waiting on the desk.
      messages: [
        {
          id: `${crypto.randomUUID()}-msg-0`,
          kind: "message",
          authorId: input.reporterId,
          audience: "all",
          body: input.description || input.title,
          attachments: input.attachments,
          createdAt: now,
          editedAt: null,
          readBy: [input.reporterId],
        },
        {
          id: `${crypto.randomUUID()}-evt-0`,
          kind: "event",
          authorId: input.reporterId,
          audience: "all",
          body: "รอทีมดูแลระบบรับเรื่อง",
          event: { type: "status_changed", to: "new" },
          attachments: [],
          createdAt: now,
          editedAt: null,
          readBy: [input.reporterId],
        },
      ],
      duplicateOfId: null,
      rejectReason: null,
      tags: [],
      whatWasChecked: null,
      createdAt: now,
      firstResponseAt: null,
      escalatedAt: null,
      escalatedBy: null,
      resolvedAt: null,
      closedAt: null,
      updatedAt: now,
      reopenCount: 0,
      satisfaction: null,
    };
    set((s) => ({ tickets: [ticket, ...s.tickets] }));

    const reporterName = getUser(input.reporterId)?.name ?? "พนักงาน";
    useNotificationStore
      .getState()
      .notifyMany(agents(), input.reporterId, `${reporterName} แจ้งปัญหาใหม่ (${ticket.code}): ${ticket.title}`, undefined, `/report-task/issue-reports/${ticket.id}`);
    logTicketActivity(ticket, input.reporterId, "แจ้งปัญหาใหม่", issueStatusMeta[ticket.status].label);

    return ticket;
  },

  addMessage: (ticketId, authorId, body, audience, attachments = []) => {
    let updated: IssueTicket | null = null;
    set((s) => ({
      tickets: s.tickets.map((t) => {
        if (t.id !== ticketId) return t;
        const isAgentOrOwner = isIssueAgent(useIssueDeskConfigStore.getState().config, authorId) || getUser(authorId)?.isOwner;
        const msg: IssueMessage = {
          id: `${ticketId}-msg-${crypto.randomUUID()}`,
          kind: "message",
          authorId,
          audience,
          body,
          attachments,
          createdAt: new Date().toISOString(),
          editedAt: null,
          readBy: [authorId],
        };
        updated = {
          ...t,
          messages: [...t.messages, msg],
          updatedAt: msg.createdAt,
          firstResponseAt: t.firstResponseAt ?? (isAgentOrOwner && audience === "all" ? msg.createdAt : t.firstResponseAt),
        };
        return updated;
      }),
    }));
    if (!updated) return;
    const t = updated as IssueTicket;

    if (audience === "all") {
      if (authorId === t.reporterId) {
        // Reporter replied — tell whoever's actually on the hook, not the
        // whole desk, so this doesn't turn into a group-chat notification.
        if (t.assigneeId) notifyTicket(t, t.assigneeId, authorId, `ผู้แจ้งตอบกลับตั๋ว ${t.code}: ${t.title}`);
        else useNotificationStore.getState().notifyMany(agents(), authorId, `ผู้แจ้งตอบกลับตั๋ว ${t.code}: ${t.title}`, undefined, `/report-task/issue-reports/${t.id}`);
      } else {
        notifyTicket(t, t.reporterId, authorId, `มีการตอบกลับใหม่ในตั๋ว ${t.code}: ${t.title}`);
      }
    }
  },

  setStatus: (ticketId, status, byUserId, extra) => {
    let updated: IssueTicket | null = null;
    let fromStatus: IssueStatus | null = null;
    set((s) => ({
      tickets: s.tickets.map((t) => {
        if (t.id !== ticketId) return t;
        fromStatus = t.status;
        const now = new Date().toISOString();
        const isEscalating = status === "escalated" && t.escalatedAt === null;
        const isResolving = status === "resolved";
        const isReopening =
          (t.status === "pending_verify" || t.status === "resolved") &&
          (status === "in_progress" || status === "escalated");
        const next: IssueTicket = {
          ...t,
          status,
          firstResponseAt: t.firstResponseAt ?? (t.status === "new" ? now : t.firstResponseAt),
          escalatedAt: isEscalating ? now : t.escalatedAt,
          escalatedBy: isEscalating ? byUserId : t.escalatedBy,
          whatWasChecked: isEscalating ? (extra?.whatWasChecked ?? t.whatWasChecked) : t.whatWasChecked,
          resolvedAt: isResolving ? now : t.resolvedAt,
          closedAt: status === "resolved" || status === "rejected" || status === "duplicate" ? now : t.closedAt,
          rejectReason: status === "rejected" ? (extra?.rejectReason ?? t.rejectReason) : t.rejectReason,
          duplicateOfId: status === "duplicate" ? (extra?.duplicateOfId ?? t.duplicateOfId) : t.duplicateOfId,
          reopenCount: isReopening ? t.reopenCount + 1 : t.reopenCount,
          updatedAt: now,
        };
        const eventBody =
          status === "escalated"
            ? `ส่งต่อให้ผู้พัฒนาแล้ว โดย ${getUser(byUserId)?.name ?? "ทีมดูแลระบบ"}`
            : `เปลี่ยนสถานะเป็น "${issueStatusMeta[status].label}"`;
        next.messages = [
          ...t.messages,
          pushEvent(next, byUserId, eventBody, {
            type: status === "escalated" ? "escalated" : isReopening ? "reopened" : "status_changed",
            from: t.status,
            to: status,
          }),
        ];
        updated = next;
        return next;
      }),
    }));
    if (!updated || !fromStatus) return;
    const t = updated as IssueTicket;
    logTicketActivity(t, byUserId, `เปลี่ยนสถานะตั๋วเป็น "${issueStatusMeta[status].label}"`);

    // Only notify the reporter when their at-a-glance bucket actually moves
    // (see reporterStatusGroup) — not on every one of the 11 internal
    // sub-states, which would read as noise to someone who only sees 5.
    if (reporterStatusGroup(fromStatus) !== reporterStatusGroup(status)) {
      notifyTicket(t, t.reporterId, byUserId, `ตั๋ว ${t.code} "${t.title}" เปลี่ยนเป็น "${issueStatusMeta[status].label}"`);
    }
  },

  setPriority: (ticketId, priority, byUserId) => {
    set((s) => ({
      tickets: s.tickets.map((t) => {
        if (t.id !== ticketId) return t;
        const now = new Date().toISOString();
        const next = { ...t, priority, updatedAt: now };
        next.messages = [
          ...t.messages,
          pushEvent(
            next,
            byUserId,
            `ปรับความสำคัญเป็น "${issuePriorityMeta[priority].label}"`,
            { type: "priority_changed", from: t.priority, to: priority },
            "staff" // internal triage detail — not for the reporter, see ISSUE_DESK_AUDIT_2026-08-08.md §B5
          ),
        ];
        return next;
      }),
    }));
  },

  setAssignee: (ticketId, assigneeId, byUserId) => {
    let updated: IssueTicket | null = null;
    set((s) => ({
      tickets: s.tickets.map((t) => {
        if (t.id !== ticketId) return t;
        const now = new Date().toISOString();
        const next = { ...t, assigneeId, updatedAt: now };
        next.messages = [
          ...t.messages,
          pushEvent(
            next,
            byUserId,
            assigneeId ? `มอบหมายให้ ${getUser(assigneeId)?.name ?? "-"}` : "ยกเลิกผู้รับผิดชอบ",
            { type: "assigned", from: t.assigneeId ?? undefined, to: assigneeId ?? undefined },
            "staff" // internal desk detail — not for the reporter, see ISSUE_DESK_AUDIT_2026-08-08.md §B5
          ),
        ];
        updated = next;
        return next;
      }),
    }));
    if (updated && assigneeId) {
      const t = updated as IssueTicket;
      notifyTicket(t, assigneeId, byUserId, `คุณถูกมอบหมายตั๋ว ${t.code}: ${t.title}`);
    }
  },

  setVisibility: (ticketId, visibility) =>
    set((s) => ({
      tickets: s.tickets.map((t) => (t.id === ticketId ? { ...t, visibility, updatedAt: new Date().toISOString() } : t)),
    })),

  confirmResolution: (ticketId, userId, worked, reason) => {
    let updated: IssueTicket | null = null;
    set((s) => ({
      tickets: s.tickets.map((t) => {
        if (t.id !== ticketId) return t;
        const now = new Date().toISOString();
        const actingForReporter = userId !== t.reporterId;
        const next: IssueTicket = worked
          ? { ...t, status: "resolved", resolvedAt: now, closedAt: now, updatedAt: now }
          : { ...t, status: t.escalatedAt ? "escalated" : "in_progress", reopenCount: t.reopenCount + 1, updatedAt: now };
        const body = worked
          ? `ยืนยันว่าใช้ได้แล้ว${actingForReporter ? ` (โดย ${getUser(userId)?.name ?? "ทีมดูแลระบบ"} แทนผู้แจ้ง${reason ? `: ${reason}` : ""})` : ""}`
          : `ยังไม่หาย — เปิดกลับ${reason ? `: ${reason}` : ""}`;
        next.messages = [
          ...t.messages,
          pushEvent(next, userId, body, { type: worked ? "verified" : "reopened", from: t.status, to: next.status }),
        ];
        updated = next;
        return next;
      }),
    }));
    if (updated) {
      const t = updated as IssueTicket;
      logTicketActivity(t, userId, worked ? "ยืนยันว่าตั๋วแก้ไขแล้ว" : "เปิดตั๋วกลับ (ยังไม่หาย)", reason);
      if (userId !== t.reporterId) notifyTicket(t, t.reporterId, userId, `ตั๋ว ${t.code} ถูกปิดแทนคุณ — ${worked ? "ยืนยันว่าใช้ได้แล้ว" : "เปิดกลับ"}`);
    }
  },

  markRead: (ticketId, messageIds, userId) =>
    set((s) => ({
      tickets: s.tickets.map((t) =>
        t.id !== ticketId
          ? t
          : {
              ...t,
              messages: t.messages.map((m) =>
                messageIds.includes(m.id) && !m.readBy.includes(userId) ? { ...m, readBy: [...m.readBy, userId] } : m
              ),
            }
      ),
    })),
}));

/** Re-exported for store-hydrator's ServerStoreSync `apply` — kept in
 * lib/issue-migration.ts (not defined here) so the migration logic stays
 * independently testable. */
export { migrateIssueStoreSlice, extractV1RecipientDepartmentIds };
