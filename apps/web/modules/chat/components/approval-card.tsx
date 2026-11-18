"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, Check, ClipboardList, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@smartboss/ui/cn";

import { decideDueRequestAction } from "@/app/(shell)/maintenance/work-orders/due-request-actions";
import { decideExpenseExtensionAction } from "@/app/(shell)/maintenance/work-orders/expense-deadline-actions";
import { canDecideTaskDueRequest } from "@/modules/report_task/lib/pending-due-request";
import { getUser } from "@/modules/report_task/lib/directory";
import { formatShortDate } from "@/modules/report_task/lib/format";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useProjectStore } from "@/modules/report_task/store/project-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { daysBetween } from "../lib/approval";
import type { ChatApprovalInfo, ChatTaskCard } from "../types";

/**
 * การ์ดคำขอเลื่อนในห้อง "คำขออนุมัติ" (ผู้ใช้ 18/11/2569) — กดอนุมัติ/ไม่อนุมัติในแชทได้เลย
 * ปุ่มเรียกคำสั่งตัวเดิมเท่านั้น (ไม่มีทางอนุมัติทางที่สอง):
 *   งาน = useTaskStore.decideDueDateRequest (ตัวเดียวกับบอร์ด) · ใบแจ้งซ่อม = decideDueRequestAction · ค่าใช้จ่าย = decideExpenseExtensionAction
 * ไม่อนุมัติ: งานไม่บังคับเหตุผล · ใบแจ้งซ่อม/ค่าใช้จ่ายบังคับ (กติกาเดิมฝั่ง server)
 */
export function ApprovalCard({ card }: { card: ChatTaskCard & { approval: ChatApprovalInfo } }) {
  const a = card.approval;
  const me = useIdentityStore((s) => s.viewingAsUserId);
  const task = useTaskStore((s) => (a.source === "task" ? s.tasks.find((t) => t.id === card.taskId) : undefined));
  const projectOwnerId = useProjectStore((s) => (task?.project ? s.projects.find((p) => p.id === task.project!.projectId)?.ownerId : undefined));
  // ตัดสินในแชทแล้ว — การ์ดเปลี่ยนทันที ไม่ต้องรอโหลดข้อความใหม่
  const [local, setLocal] = useState<Pick<ChatApprovalInfo, "status" | "decidedBy" | "decidedAt" | "decisionNote"> | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  // งาน: สถานะใน store สดกว่า (กดบนบอร์ดในเครื่องนี้แล้ว) — ใช้ก่อนค่าจากตอนโหลดข้อความ
  const storeReq = task?.dueDateRequests?.find((r) => r.id === a.requestId);
  const state = local ?? (storeReq ? { status: storeReq.status, decidedBy: storeReq.decidedBy, decidedAt: storeReq.decidedAt, decisionNote: storeReq.decisionNote } : a);
  const isWo = a.source !== "task";
  const noteRequired = isWo;
  const canDecide =
    state.status === "pending" &&
    !!me &&
    me !== a.requesterId &&
    // งาน: กติกาเดียวกับปุ่มบนหน้างาน (ใบแจ้งซ่อม: ห้องนี้มีแต่คนที่อนุมัติได้ server ตรวจซ้ำตอนกด)
    (a.source !== "task" || (!!task && canDecideTaskDueRequest(task, me, projectOwnerId)));
  const isGroup = (a.forNames?.length ?? 0) > 1;
  const days = daysBetween(a.previousDate, a.newDate);
  const kindLabel = a.source === "expense" ? "ขอเลื่อนบันทึกค่าใช้จ่าย" : "ขอเลื่อนกำหนดส่ง";
  const who = a.requesterName ?? getUser(a.requesterId)?.name ?? "มีคน";

  function decide(approve: boolean) {
    if (!me) return;
    const memo = note.trim();
    if (!approve && noteRequired && !memo) {
      toast.error("ใส่เหตุผลที่ไม่อนุมัติ");
      return;
    }
    if (a.source === "task") {
      const fresh = useTaskStore.getState().tasks.find((t) => t.id === card.taskId)?.dueDateRequests?.find((r) => r.id === a.requestId);
      if (!fresh || fresh.status !== "pending") {
        toast.error("คำขอนี้ถูกตัดสินไปแล้ว");
        return;
      }
      useTaskStore.getState().decideDueDateRequest(card.taskId, a.requestId, me, approve, memo || undefined);
      setLocal({ status: approve ? "approved" : "rejected", decidedBy: me, decidedAt: new Date().toISOString(), ...(memo ? { decisionNote: memo } : {}) });
      setRejecting(false);
      toast.success(approve ? "อนุมัติแล้ว — กำหนดส่งเปลี่ยนเป็นวันใหม่" : "ไม่อนุมัติแล้ว — คงกำหนดเดิม");
      return;
    }
    startTransition(async () => {
      const res =
        a.source === "expense"
          ? await decideExpenseExtensionAction(a.requestId, approve, memo)
          : await decideDueRequestAction(a.requestId, approve, memo);
      if (res.error) {
        toast.error(res.error);
        // คนอื่นกดไปก่อน — ปิดปุ่ม (สถานะจริงขึ้นตอนโหลดห้องใหม่)
        if (res.error.includes("ตัดสินไปแล้ว")) setLocal({ status: "cancelled" });
        return;
      }
      setLocal({ status: approve ? "approved" : "rejected", decidedBy: me, decidedAt: new Date().toISOString(), ...(memo ? { decisionNote: memo } : {}) });
      setRejecting(false);
      toast.success(approve ? "อนุมัติแล้ว — กำหนดส่งเปลี่ยนเป็นวันใหม่" : "ไม่อนุมัติแล้ว — คงกำหนดเดิม");
    });
  }

  const open = state.status === "pending";
  const decidedLine =
    state.status === "approved"
      ? `อนุมัติแล้ว${state.decidedBy ? ` · ${state.decidedBy === me ? "คุณ" : (getUser(state.decidedBy)?.name ?? "")}` : ""}${state.decidedAt ? ` ${formatShortDate(state.decidedAt)}` : ""}`
      : state.status === "rejected"
        ? `ไม่อนุมัติ${state.decidedBy ? ` · ${state.decidedBy === me ? "คุณ" : (getUser(state.decidedBy)?.name ?? "")}` : ""}${state.decidedAt ? ` ${formatShortDate(state.decidedAt)}` : ""}`
        : state.status === "cancelled"
          ? "ยกเลิกแล้ว"
          : null;

  return (
    <div
      className={cn(
        "w-72 max-w-full overflow-hidden rounded-2xl rounded-tl-md border bg-(--bg) text-left shadow-[0_1px_1px_rgba(0,0,0,0.06)]",
        open ? "border-[#f0b9b4]" : "border-(--line) opacity-80"
      )}
    >
      <div className={cn("flex items-center gap-2 px-3 py-2 text-xs font-semibold", open ? "bg-[#fdecea] text-[#a3261b]" : "bg-(--bg-soft) text-(--ink-soft)")}>
        {isWo ? <Wrench className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />}
        <span className="min-w-0 truncate">
          {kindLabel}
          {open && canDecide ? " · รอคุณอนุมัติ" : ""}
        </span>
        <span className="ml-auto shrink-0 rounded border border-current px-1 text-[10px] leading-4">{isWo ? "ใบแจ้งซ่อม" : "Task"}</span>
      </div>

      <div className="flex flex-col gap-2 px-3 py-2.5">
        <div className="line-clamp-2 text-[15px] font-semibold text-(--ink)">{card.title}</div>
        {card.code && <div className="-mt-1.5 text-xs text-(--ink-soft)">{card.code}</div>}
        <div className="text-xs text-(--ink-soft)">
          <b className="text-(--ink)">{who}</b> ขอเลื่อน
          {isGroup ? (a.memberCount && a.forNames!.length === a.memberCount ? ` ให้ทั้งกลุ่ม ${a.memberCount} คน` : ` ให้ ${a.forNames!.join(", ")}`) : ""}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <CalendarClock className="h-4 w-4 text-(--ink-soft)" aria-hidden="true" />
          {a.previousDate && <span className="rounded-md bg-(--bg-soft) px-1.5 text-(--ink-soft) line-through">{formatShortDate(a.previousDate)}</span>}
          <ArrowRight className="h-3.5 w-3.5 text-(--ink-soft)" aria-hidden="true" />
          <span className="rounded-md bg-[#e9eef8] px-1.5 font-semibold text-(--brand-navy,#1e3a6e)">{formatShortDate(a.newDate)}</span>
          {days !== null && days > 0 && <span className="text-xs text-(--ink-soft)">เลื่อน {days} วัน</span>}
        </div>
        {a.reason && (
          <div className="rounded-lg bg-(--bg-soft) px-2.5 py-1.5 text-[13px] text-(--ink)">
            <span className="text-(--ink-soft)">เหตุผล: </span>
            {a.reason}
          </div>
        )}

        {decidedLine && (
          <div className={cn("flex items-center gap-1 text-[13px] font-semibold", state.status === "rejected" ? "text-[#b42318]" : "text-(--ink-soft)")}>
            {state.status === "approved" ? <Check className="h-4 w-4" aria-hidden="true" /> : state.status === "rejected" ? <X className="h-4 w-4" aria-hidden="true" /> : null}
            {decidedLine}
          </div>
        )}
        {state.decisionNote && state.status !== "cancelled" && <div className="text-xs text-(--ink-soft)">หมายเหตุ: {state.decisionNote}</div>}

        {canDecide && rejecting && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`rej-${a.requestId}`} className="text-xs font-semibold text-(--ink)">
              {noteRequired ? "เหตุผลที่ไม่อนุมัติ (ต้องใส่)" : "หมายเหตุ (ไม่ใส่ก็ได้)"}
            </label>
            <textarea
              id={`rej-${a.requestId}`}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="resize-none rounded-lg border border-(--line) bg-(--bg) px-2 py-1.5 text-sm text-(--ink)"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => setRejecting(false)} disabled={pending} className="h-10 flex-1 rounded-lg border border-(--line) text-sm font-semibold text-(--ink)">
                กลับ
              </button>
              <button type="button" onClick={() => decide(false)} disabled={pending} className="h-10 flex-1 rounded-lg bg-[#b42318] text-sm font-semibold text-white disabled:opacity-60">
                ยืนยันไม่อนุมัติ
              </button>
            </div>
          </div>
        )}

        {canDecide && !rejecting && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => decide(true)}
              disabled={pending}
              className="h-10 flex-1 rounded-lg bg-(--brand-navy,#1e3a6e) text-sm font-semibold text-white disabled:opacity-60"
            >
              {isGroup ? `อนุมัติ ${a.forNames!.length} คน` : "อนุมัติ"}
            </button>
            <button
              type="button"
              onClick={() => setRejecting(true)}
              disabled={pending}
              className="h-10 flex-1 rounded-lg border border-[#e3a59f] text-sm font-semibold text-[#b42318] disabled:opacity-60"
            >
              ไม่อนุมัติ
            </button>
          </div>
        )}
      </div>

      <Link href={card.link} className="flex items-center justify-between border-t border-(--line) px-3 py-2 text-sm font-semibold text-(--brand-navy,#1e3a6e) hover:bg-(--bg-soft)">
        {canDecide && isGroup ? "เลือกบางคน / ดูรายละเอียด" : "ดูรายละเอียด"}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
