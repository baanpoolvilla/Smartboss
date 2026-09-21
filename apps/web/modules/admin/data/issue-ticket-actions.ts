"use server";

import { redirect } from "next/navigation";
import { requireOrg } from "@smartboss/auth";
import { getIssueConsoleAccess } from "./issue-console-access";
import { listIssueStaff } from "./issue-staff";
import { canActOnTickets } from "../support-org";
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
import { notifyUser } from "@/modules/maintenance/data/notify";
import { SYSTEM_USER_ID } from "@/modules/report_task/lib/task-penalty-sweep";
import type { ActivityItem } from "@/modules/report_task/types";

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

/** แก้/ตอบ/รับเรื่อง/ลบตั๋วได้ไหม — Super Admin และแผนก IT/ฝ่ายพัฒนาระบบของบริษัทเรา
 * (ISSUE_SUPPORT_ORG) ทำได้ทุกบริษัท (บริษัทอื่นแจ้ง/ดูตั๋วตัวเองได้อย่างเดียว เราเป็นคนแก้ให้);
 * CEO/ADMIN ดูอย่างเดียว ตัดสินจาก session ฝั่งเซิร์ฟเวอร์ ไม่เชื่อค่าที่ client ส่งมา */
async function requireTicketActor(_orgId: string, _ticketId: string) {
  const session = await requireOrg();
  const access = await getIssueConsoleAccess(session);
  if (!access || !canActOnTickets(access)) throw new Error("คุณไม่มีสิทธิ์แก้ตั๋วนี้ (ดูได้อย่างเดียว)");
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
  const session = await requireTicketActor(orgId, ticketId);
  const trimmed = body.trim();
  if (!trimmed) throw new Error("พิมพ์ข้อความก่อนส่ง");
  const updated = await mutateTicket(orgId, ticketId, (t) => {
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

  // แจ้งผู้แจ้งเฉพาะข้อความที่เขาเห็นได้จริง — "staff" คือโน้ตภายในที่ผู้แจ้ง
  // ไม่มีทางเห็นในหน้าของตัวเองเลย แจ้งไปก็จะงงว่าลิงก์พาไปแล้วไม่เห็นอะไร
  if (audience === "all") {
    void notifyUser(orgId, updated.reporterId, {
      title: `มีการตอบกลับตั๋ว "${updated.title}" ที่คุณแจ้งไว้`,
      type: "issue_ticket_reply_reporter",
      referenceId: ticketId,
    });
  }

  return updated;
}

/** ข้อความแจ้งผู้แจ้งเมื่อสถานะตั๋วเปลี่ยน (เฉพาะสถานะที่ผู้แจ้งควรรู้) */
function statusChangeText(status: IssueStatus, title: string): string | null {
  switch (status) {
    case "triaged":
      return `ทีม Smartboss รับเรื่อง "${title}" ของคุณแล้ว`;
    case "in_progress":
      return `กำลังแก้ไข "${title}" ของคุณอยู่`;
    case "waiting_reporter":
      return `ทีมต้องการข้อมูลเพิ่มเรื่อง "${title}" — รบกวนตอบกลับ`;
    case "escalated":
    case "vendor_working":
    case "vendor_released":
      return `ส่งเรื่อง "${title}" ให้ผู้พัฒนาแล้ว`;
    case "pending_verify":
      return `แก้ไข "${title}" แล้ว — รอคุณยืนยันว่าใช้ได้`;
    case "resolved":
      return `เรื่อง "${title}" แก้ไขเสร็จแล้ว`;
    case "rejected":
      return `เรื่อง "${title}" — ทีมไม่ดำเนินการ`;
    case "duplicate":
      return `เรื่อง "${title}" ซ้ำกับตั๋วอื่น`;
    default:
      return null;
  }
}

/** แจ้งผู้แจ้งว่าตั๋วมีความคืบหน้า — ห่อ try/catch กันแจ้งเตือนพังแล้วทำให้การเปลี่ยน
 * สถานะจริงพังตาม ไม่แจ้งตัวเองถ้าผู้แจ้งเป็นคนกดเอง */
async function notifyReporterOfStatus(orgId: string, ticket: IssueTicket, status: IssueStatus, actorId: string) {
  if (ticket.reporterId === actorId) return;
  const title = statusChangeText(status, ticket.title);
  if (!title) return;
  try {
    await notifyUser(orgId, ticket.reporterId, { title, type: "issue_ticket_status_reporter", referenceId: ticket.id });
  } catch (err) {
    console.error("[issue-ticket-actions] notifyReporterOfStatus failed", err);
  }
}

/** "รับเรื่อง" — claim (assign to self) + move to triaged in one step, same
 * shortcut the old per-org side panel offered agents. */
export async function adminClaimTicket(orgId: string, ticketId: string) {
  const session = await requireTicketActor(orgId, ticketId);
  const updated = await mutateTicket(orgId, ticketId, (t) => {
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
  await notifyReporterOfStatus(orgId, updated, "triaged", session.userId);
  return updated;
}

export async function adminSetStatus(
  orgId: string,
  ticketId: string,
  status: IssueStatus,
  extra?: { rejectReason?: string; duplicateOfId?: string; whatWasChecked?: string }
) {
  const session = await requireTicketActor(orgId, ticketId);
  let previousStatus: IssueStatus | null = null;
  const updated = await mutateTicket(orgId, ticketId, (t) => {
    previousStatus = t.status;
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
  if (previousStatus !== status) await notifyReporterOfStatus(orgId, updated, status, session.userId);
  return updated;
}

export async function adminSetPriority(orgId: string, ticketId: string, priority: IssuePriority) {
  const session = await requireTicketActor(orgId, ticketId);
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
  const session = await requireTicketActor(orgId, ticketId);
  if (assigneeId && !(await assignableStaff()).some((u) => u.id === assigneeId)) throw new Error("มอบหมายให้คนนี้ไม่ได้");
  const updated = await mutateTicket(orgId, ticketId, (t) => {
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
  // ผู้รับผิดชอบคนใหม่ (ไม่ใช่ตัวเอง) ได้แจ้งเตือนว่ามีตั๋วมอบหมายให้ — ลิงก์เข้าหน้าตั๋วในคอนโซล
  if (assigneeId && assigneeId !== session.userId) {
    try {
      await notifyUser(orgId, assigneeId, {
        title: `มอบหมายตั๋ว "${updated.title}" ให้คุณ`,
        type: "issue_ticket_new",
        referenceId: `${orgId}:${ticketId}`,
      });
    } catch (err) {
      console.error("[issue-ticket-actions] notify assignee failed", err);
    }
  }
  return updated;
}

/** Confirming "on the reporter's behalf" — same idea the old side panel had
 * for an agent, now only ever done by a Super Admin from this console. */
export async function adminConfirmResolution(orgId: string, ticketId: string, worked: boolean, reason?: string) {
  const session = await requireTicketActor(orgId, ticketId);
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

/** ลงบันทึกลง "บันทึกกิจกรรม" ของบริษัทนั้นเอง (report_task/activity-log)
 * เมื่อทีม Smartboss ลบตั๋ว — ใช้ SYSTEM_USER_ID เป็นผู้กระทำ เพราะ session
 * ของ Super Admin ที่ลบเป็นบัญชีข้ามบริษัท ไม่มีทางอยู่ใน employee directory
 * ของบริษัทเจ้าของตั๋วเลย (getUser(userId) ในหน้าบันทึกกิจกรรมจะหาไม่เจอ
 * กลายเป็น "ไม่ทราบ") — ใส่รายละเอียดว่าใครลบไว้ใน detail แทน */
async function logTicketDeletion(orgId: string, ticket: IssueTicket, deletedByName: string) {
  const { data, version } = await readStore<ActivityItem[]>(orgId, "activity-log");
  const entries = data ?? [];
  const entry: ActivityItem = {
    id: `log-${crypto.randomUUID()}`,
    userId: SYSTEM_USER_ID,
    action: "ลบตั๋วแจ้งบัค",
    target: `${ticket.code} — ${ticket.title}`,
    detail: `ลบโดย ${deletedByName} (ทีม Smartboss)`,
    createdAt: new Date().toISOString(),
  };
  await writeStore(orgId, "activity-log", [entry, ...entries], version, "smartboss-admin");
}

/** ลบตั๋วทิ้งทั้งหมด (รวมข้อความในตั๋วทุกอัน) — ทำไม่ได้ย้อนกลับ ใช้ตอนตั๋วเป็น
 * สแปม/ทดสอบ/ไม่เกี่ยวข้อง ไม่ใช่ workflow ปกติ (ปิดตั๋วใช้เปลี่ยนสถานะแทน) */
export async function adminDeleteTicket(orgId: string, ticketId: string) {
  const session = await requireTicketActor(orgId, ticketId);
  const { data, version } = await readStore<unknown>(orgId, "issue-reports");
  const slice = migrateIssueStoreSlice(data);
  const ticket = slice.tickets.find((t) => t.id === ticketId);
  if (!ticket) throw new Error("ไม่พบตั๋วนี้ — อาจถูกลบไปแล้ว");
  const nextTickets = slice.tickets.filter((t) => t.id !== ticketId);
  const result = await writeStore(orgId, "issue-reports", { ...slice, tickets: nextTickets }, version, "smartboss-admin");
  if (!result.ok) throw new Error("มีคนแก้ตั๋วนี้พร้อมกัน — โหลดหน้าใหม่แล้วลองอีกครั้ง");

  const admins = await listUsersAcrossOrgs();
  const deletedByName = admins.find((u) => u.id === session.userId)?.name ?? "ทีม Smartboss";
  await logTicketDeletion(orgId, ticket, deletedByName);
}

/** Who a ticket can be assigned to — any active platform Super Admin plus the
 * CEO/ADMIN of our own company (ISSUE_SUPPORT_ORG), not a per-org employee
 * list (there's no more "in-company agent"). */
async function assignableStaff() {
  return listIssueStaff();
}

export async function listAssignableStaff() {
  const session = await requireOrg();
  if (!(await getIssueConsoleAccess(session))) redirect("/");
  return assignableStaff();
}
