"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { selectClass } from "@/modules/admin/components/ui";
import {
  adminReplyToTicket,
  adminClaimTicket,
  adminSetStatus,
  adminSetPriority,
  adminSetAssignee,
  adminConfirmResolution,
} from "@/modules/admin/data/issue-ticket-actions";
import {
  issueCategoryMeta,
  issueImpactMeta,
  issuePriorityMeta,
  issueStatusMeta,
  nextStatusOptions,
  formatWaitDuration,
} from "@/modules/report_task/lib/issue-meta";
import type { IssueAudience, IssuePriority, IssueStatus, IssueTicket } from "@/modules/report_task/types/issue";
import { cn } from "@/modules/report_task/lib/utils";

export interface TicketUserInfo {
  name: string;
  email: string | null;
  role: string | null;
}

/**
 * The actual "receiving desk" for a ticket, now that it only ever lives here
 * (see report_task/lib/permissions.ts's isIssueAgent — the per-org agent
 * workflow is retired). Deliberately re-implements a compact version of the
 * old per-org side panel/thread rather than reusing it wholesale: that one
 * is wired to the per-org Zustand store + client directory (getUser, users)
 * which have no cross-org equivalent — this component instead calls the
 * server actions in issue-ticket-actions.ts and re-syncs via router.refresh().
 */
export function IssueTicketDetailClient({
  orgId,
  orgName,
  ticket,
  userMap,
  superAdmins,
  currentUserId,
}: {
  orgId: string;
  orgName: string;
  ticket: IssueTicket;
  userMap: Record<string, TicketUserInfo>;
  superAdmins: { id: string; name: string }[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState<IssueAudience>("all");
  const [replyText, setReplyText] = useState("");

  const reporter = userMap[ticket.reporterId];
  const assignee = ticket.assigneeId ? userMap[ticket.assigneeId] : null;
  const category = issueCategoryMeta[ticket.category];
  const CategoryIcon = category.icon;

  function run(action: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง");
      }
    });
  }

  function handleReply() {
    const body = replyText.trim();
    if (!body) return;
    run(async () => {
      await adminReplyToTicket(orgId, ticket.id, body, audience);
      setReplyText("");
    });
  }

  function handleStatusChange(next: IssueStatus) {
    if (next === ticket.status) return;
    if (next === "rejected") {
      const reason = window.prompt("เหตุผลที่ไม่ดำเนินการ (จำเป็น):");
      if (!reason?.trim()) return;
      run(() => adminSetStatus(orgId, ticket.id, next, { rejectReason: reason.trim() }));
      return;
    }
    if (next === "duplicate") {
      // Free-text reference only (e.g. another ticket's code) — this admin
      // console spans every org's tickets, so resolving it to a real
      // cross-org ticket id isn't done here; it's a note for whoever reads
      // the thread, same as the per-org page shows it.
      const ref = window.prompt("อ้างอิงตั๋วที่ซ้ำกัน (เลขตั๋ว):");
      if (!ref?.trim()) return;
      run(() => adminSetStatus(orgId, ticket.id, next, { duplicateOfId: ref.trim() }));
      return;
    }
    if (next === "escalated" && ticket.escalatedAt === null) {
      const checked = window.prompt("ตรวจสอบอะไรไปแล้วบ้างก่อนส่งต่อผู้พัฒนา? (จำเป็น):");
      if (!checked?.trim()) return;
      run(() => adminSetStatus(orgId, ticket.id, next, { whatWasChecked: checked.trim() }));
      return;
    }
    run(() => adminSetStatus(orgId, ticket.id, next));
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4 min-w-0">
        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-(--radius) bg-(--bg-soft)">
              <CategoryIcon className="h-5 w-5 text-(--ink-soft)" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-(--ink-soft)">
                {orgName} · {category.label} · {issueImpactMeta[ticket.impact].label}
              </p>
              <h2 className="mt-0.5 text-base font-semibold text-(--ink) break-words">{ticket.title}</h2>
              <p className="mt-1 text-xs text-(--ink-soft)">
                แจ้งโดย <span className="font-medium text-(--ink)">{reporter?.name ?? "ไม่ทราบชื่อ"}</span>
                {reporter?.role && ` · ${reporter.role}`}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="flex items-center gap-1 border-b border-(--line) px-3 py-2">
            {(["all", "staff"] as IssueAudience[]).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAudience(a)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  audience === a ? "bg-(--ink) text-white" : "text-(--ink-soft) hover:bg-(--bg-soft)"
                )}
              >
                {a === "all" ? "คุยกับผู้แจ้ง" : "โน้ตภายใน (ทีม Smartboss)"}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3 p-4 max-h-[50vh] overflow-y-auto">
            {ticket.messages
              .filter((m) => m.audience === audience)
              .map((m) => {
                const author = userMap[m.authorId];
                return (
                  <div key={m.id} className={cn("max-w-[85%] rounded-2xl px-3.5 py-2.5", m.kind === "event" ? "self-center bg-(--bg-soft) text-[11px] text-(--ink-soft) max-w-full text-center" : m.authorId === ticket.reporterId ? "self-start bg-(--bg-soft)" : "self-end bg-teal-50")}>
                    {m.kind === "message" && (
                      <p className="text-[11px] font-medium text-(--ink-soft) mb-0.5">{author?.name ?? "ไม่ทราบชื่อ"}</p>
                    )}
                    <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                  </div>
                );
              })}
          </div>

          {ticket.status === "pending_verify" && (
            <div className="flex flex-wrap items-center gap-2 border-t border-(--line) bg-amber-50 px-4 py-3">
              <p className="text-xs text-amber-800 flex-1 min-w-[200px]">
                ตั๋วนี้รอผู้แจ้งยืนยันว่าใช้ได้แล้ว — ยืนยันแทนได้ถ้าติดต่อผู้แจ้งแล้ว
              </p>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => {
                  const reason = window.prompt("เหตุผล (ถ้ามี — ยืนยันแทนผู้แจ้ง):") ?? undefined;
                  run(() => adminConfirmResolution(orgId, ticket.id, true, reason || undefined));
                }}
              >
                ใช้ได้แล้ว
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => {
                  const reason = window.prompt("เหตุผล (ยังไม่หาย):") ?? undefined;
                  run(() => adminConfirmResolution(orgId, ticket.id, false, reason || undefined));
                }}
              >
                ยังไม่หาย
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-(--line) p-3">
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={audience === "staff" ? "โน้ตภายใน — ผู้แจ้งไม่เห็น" : "พิมพ์ตอบผู้แจ้ง…"}
              rows={3}
              className="w-full resize-none rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm outline-none focus-visible:border-(--brand-green)"
            />
            <div className="flex justify-end">
              <Button size="sm" disabled={isPending || !replyText.trim()} onClick={handleReply}>
                ส่ง
              </Button>
            </div>
          </div>
        </Card>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="flex flex-col gap-3">
        {ticket.status === "new" && (
          <Button className="w-full" disabled={isPending} onClick={() => run(() => adminClaimTicket(orgId, ticket.id))}>
            รับเรื่อง + มอบหมายให้ฉัน
          </Button>
        )}

        <Card className="p-4 flex flex-col gap-3">
          <Field label="สถานะ">
            <select
              className={selectClass}
              value={ticket.status}
              disabled={isPending}
              onChange={(e) => handleStatusChange(e.target.value as IssueStatus)}
            >
              {nextStatusOptions(ticket.status).map((s) => (
                <option key={s} value={s}>{issueStatusMeta[s].label}</option>
              ))}
            </select>
          </Field>

          <Field label="ความสำคัญ">
            <select
              className={selectClass}
              value={ticket.priority}
              disabled={isPending}
              onChange={(e) => run(() => adminSetPriority(orgId, ticket.id, e.target.value as IssuePriority))}
            >
              {(Object.keys(issuePriorityMeta) as IssuePriority[]).map((p) => (
                <option key={p} value={p}>{issuePriorityMeta[p].label}</option>
              ))}
            </select>
          </Field>

          <Field label="ผู้รับผิดชอบ (ทีม Smartboss)">
            <select
              className={selectClass}
              value={ticket.assigneeId ?? ""}
              disabled={isPending}
              onChange={(e) => {
                const id = e.target.value || null;
                const name = superAdmins.find((a) => a.id === id)?.name ?? "-";
                run(() => adminSetAssignee(orgId, ticket.id, id, name));
              }}
            >
              <option value="">— ยังไม่มอบหมาย —</option>
              {superAdmins.map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.id === currentUserId ? " (ฉัน)" : ""}</option>
              ))}
            </select>
          </Field>

          {ticket.status === "new" && (
            <p className="text-[11px] text-(--ink-soft)">รอมาแล้ว {formatWaitDuration(ticket.createdAt)}</p>
          )}
        </Card>

        <Card className="p-4 flex flex-col gap-2 text-xs">
          <Row label="เลขตั๋ว" value={ticket.code} />
          <Row label="บริษัท" value={orgName} />
          <Row label="อีเมลผู้แจ้ง" value={reporter?.email ?? "-"} />
          {assignee && <Row label="ผู้รับผิดชอบ" value={assignee.name} />}
          <Row label="หน้าที่แจ้งมา" value={ticket.context.pageUrl || "-"} mono />
          {ticket.whatWasChecked && <Row label="ตรวจสอบแล้ว" value={ticket.whatWasChecked} />}
          {ticket.rejectReason && <Row label="เหตุผลที่ไม่ดำเนินการ" value={ticket.rejectReason} />}
          {ticket.duplicateOfId && <Row label="ซ้ำกับตั๋ว" value={ticket.duplicateOfId} />}
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-(--ink-soft)">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-(--ink-soft) shrink-0">{label}</span>
      <span className={cn("text-right text-(--ink) break-all", mono && "font-mono text-[11px]")}>{value}</span>
    </div>
  );
}
