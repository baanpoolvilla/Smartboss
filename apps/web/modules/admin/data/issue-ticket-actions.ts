"use server";

import { redirect } from "next/navigation";
import { requireOrg, isSuperAdmin } from "@smartboss/auth";
import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { migrateIssueStoreSlice } from "@/modules/report_task/lib/issue-migration";
import { issueStatusMeta, issuePriorityMeta } from "@/modules/report_task/lib/issue-meta";
import type {
  IssueAudience,
  IssueMessage,
  IssuePriority,
  IssueStatus,
  IssueTicket,
} from "@/modules/report_task/types/issue";
import { listUsersAcrossOrgs } from "./users";

/**
 * Cross-org write actions for the platform Super Admin console
 * (/admin/issue-reports) — the per-company "issue desk" (claim, assign,
 * priority, status transitions, staff notes) has been retired everywhere
 * else (see report_task/lib/permissions.ts's isIssueAgent), so this is now
 * the *only* place that workflow runs, and it runs across every company's
 * ticket store at once instead of one org's own.
 *
 * Deliberately NOT sharing the Zustand `useIssueReportStore`'s mutation
 * bodies (issue-report-store.ts) — that store is wired to a per-org client
 * directory (getUser/agents()) and in-app notifications that don't have a
 * cross-org equivalent yet. These actions re-implement the same small state
 * machine directly against the target org's raw store row instead, which
 * keeps this file self-contained at the cost of the two write paths having
 * to be kept in sync by hand if the ticket state machine ever changes.
 */

async function requireSuperAdmin() {
  const session = await requireOrg();
  if (!isSuperAdmin(session)) redirect("/admin");
  return session;
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

async function mutateTicket(orgId: string, ticketId: string, mutate: (ticket: IssueTicket) => IssueTicket): Promise<IssueTicket> {
  const { data, version } = await readStore<unknown>(orgId, "issue-reports");
  const slice = migrateIssueStoreSlice(data);
  const idx = slice.tickets.findIndex((t) => t.id === ticketId);
  if (idx === -1) throw new Error("ไม่พบตั๋วนี้ — อาจถูกลบหรือย้ายไปแล้ว");
  const updated = mutate(slice.tickets[idx]!);
  const nextTickets = [...slice.tickets];
  nextTickets[idx] = updated;
  const result = await writeStore(orgId, "issue-reports", { ...slice, tickets: nextTickets }, version, "smartboss-admin");
  if (!result.ok) throw new Error("มีคนแก้ตั๋วนี้พร้อมกัน — โหลดหน้าใหม่แล้วลองอีกครั้ง");
  return updated;
}

export async function adminReplyToTicket(orgId: string, ticketId: string, body: string, audience: IssueAudience = "all") {
  const session = await requireSuperAdmin();
  const trimmed = body.trim();
  if (!trimmed) throw new Error("พิมพ์ข้อความก่อนส่ง");
  return mutateTicket(orgId, ticketId, (t) => {
    const now = new Date().toISOString();
    const msg: IssueMessage = {
      id: `${ticketId}-msg-${crypto.randomUUID()}`,
      kind: "message",
      authorId: session.userId,
      audience,
      body: trimmed,
      attachments: [],
      createdAt: now,
      editedAt: null,
      readBy: [session.userId],
    };
    return {
      ...t,
      messages: [...t.messages, msg],
      updatedAt: now,
      firstResponseAt: t.firstResponseAt ?? (audience === "all" ? now : t.firstResponseAt),
    };
  });
}

/** "รับเรื่อง" — claim (assign to self) + move to triaged in one step, same
 * shortcut the old per-org side panel offered agents. */
export async function adminClaimTicket(orgId: string, ticketId: string) {
  const session = await requireSuperAdmin();
  return mutateTicket(orgId, ticketId, (t) => {
    const now = new Date().toISOString();
    const next: IssueTicket = {
      ...t,
      status: "triaged",
      assigneeId: session.userId,
      firstResponseAt: t.firstResponseAt ?? now,
      updatedAt: now,
    };
    next.messages = [
      ...t.messages,
      pushEvent(next, session.userId, "รับเรื่องแล้ว", { type: "status_changed", from: t.status, to: "triaged" }),
    ];
    return next;
  });
}

export async function adminSetStatus(
  orgId: string,
  ticketId: string,
  status: IssueStatus,
  extra?: { rejectReason?: string; duplicateOfId?: string; whatWasChecked?: string }
) {
  const session = await requireSuperAdmin();
  return mutateTicket(orgId, ticketId, (t) => {
    const now = new Date().toISOString();
    const isEscalating = status === "escalated" && t.escalatedAt === null;
    const isResolving = status === "resolved";
    const isReopening = (t.status === "pending_verify" || t.status === "resolved") && (status === "in_progress" || status === "escalated");
    const next: IssueTicket = {
      ...t,
      status,
      firstResponseAt: t.firstResponseAt ?? (t.status === "new" ? now : t.firstResponseAt),
      escalatedAt: isEscalating ? now : t.escalatedAt,
      escalatedBy: isEscalating ? session.userId : t.escalatedBy,
      whatWasChecked: isEscalating ? (extra?.whatWasChecked ?? t.whatWasChecked) : t.whatWasChecked,
      resolvedAt: isResolving ? now : t.resolvedAt,
      closedAt: status === "resolved" || status === "rejected" || status === "duplicate" ? now : t.closedAt,
      rejectReason: status === "rejected" ? (extra?.rejectReason ?? t.rejectReason) : t.rejectReason,
      duplicateOfId: status === "duplicate" ? (extra?.duplicateOfId ?? t.duplicateOfId) : t.duplicateOfId,
      reopenCount: isReopening ? t.reopenCount + 1 : t.reopenCount,
      updatedAt: now,
    };
    const eventBody = status === "escalated" ? "ส่งต่อให้ผู้พัฒนาแล้ว" : `เปลี่ยนสถานะเป็น "${issueStatusMeta[status].label}"`;
    next.messages = [
      ...t.messages,
      pushEvent(next, session.userId, eventBody, {
        type: status === "escalated" ? "escalated" : isReopening ? "reopened" : "status_changed",
        from: t.status,
        to: status,
      }),
    ];
    return next;
  });
}

export async function adminSetPriority(orgId: string, ticketId: string, priority: IssuePriority) {
  const session = await requireSuperAdmin();
  return mutateTicket(orgId, ticketId, (t) => {
    const now = new Date().toISOString();
    const next = { ...t, priority, updatedAt: now };
    next.messages = [
      ...t.messages,
      pushEvent(
        next,
        session.userId,
        `ปรับความสำคัญเป็น "${issuePriorityMeta[priority].label}"`,
        { type: "priority_changed", from: t.priority, to: priority },
        "staff"
      ),
    ];
    return next;
  });
}

export async function adminSetAssignee(orgId: string, ticketId: string, assigneeId: string | null, assigneeName: string) {
  const session = await requireSuperAdmin();
  return mutateTicket(orgId, ticketId, (t) => {
    const now = new Date().toISOString();
    const next = { ...t, assigneeId, updatedAt: now };
    next.messages = [
      ...t.messages,
      pushEvent(
        next,
        session.userId,
        assigneeId ? `มอบหมายให้ ${assigneeName}` : "ยกเลิกผู้รับผิดชอบ",
        { type: "assigned", from: t.assigneeId ?? undefined, to: assigneeId ?? undefined },
        "staff"
      ),
    ];
    return next;
  });
}

/** Confirming "on the reporter's behalf" — same idea the old side panel had
 * for an agent, now only ever done by a Super Admin from this console. */
export async function adminConfirmResolution(orgId: string, ticketId: string, worked: boolean, reason?: string) {
  const session = await requireSuperAdmin();
  return mutateTicket(orgId, ticketId, (t) => {
    const now = new Date().toISOString();
    const next: IssueTicket = worked
      ? { ...t, status: "resolved", resolvedAt: now, closedAt: now, updatedAt: now }
      : { ...t, status: t.escalatedAt ? "escalated" : "in_progress", reopenCount: t.reopenCount + 1, updatedAt: now };
    const body = worked
      ? `ยืนยันว่าใช้ได้แล้ว (โดยทีม Smartboss แทนผู้แจ้ง${reason ? `: ${reason}` : ""})`
      : `ยังไม่หาย — เปิดกลับ${reason ? `: ${reason}` : ""}`;
    next.messages = [
      ...t.messages,
      pushEvent(next, session.userId, body, { type: worked ? "verified" : "reopened", from: t.status, to: next.status }),
    ];
    return next;
  });
}

/** Who a ticket can be assigned to — any active platform Super Admin, not a
 * per-org employee list (there's no more "in-company agent"). */
export async function listSuperAdmins() {
  await requireSuperAdmin();
  const all = await listUsersAcrossOrgs();
  return all.filter((u) => u.hasSystemRole && u.isActive).map((u) => ({ id: u.id, name: u.name }));
}
