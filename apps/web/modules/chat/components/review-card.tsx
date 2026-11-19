"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, Check, ClipboardCheck, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@smartboss/ui/cn";

import { reviewWorkOrderAction } from "@/app/(shell)/maintenance/work-orders/actions";
import { getUser, isOwner } from "@/modules/report_task/lib/directory";
import { formatShortDate } from "@/modules/report_task/lib/format";
import { canReviewTaskRecord } from "@/modules/report_task/lib/permissions";
import { isAwaitingReview } from "@/modules/report_task/lib/personal-task";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useTaskReviewSettingsStore } from "@/modules/report_task/store/task-review-settings-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { ChatReviewInfo, ChatTaskCard } from "../types";

/**
 * การ์ด "เสร็จแล้ว รอตรวจ" ในห้อง "คำขออนุมัติ" (ผู้ใช้ 19/11/2569 "ให้กดยืนยันในนั้นได้เลย")
 * ปุ่มเรียกคำสั่งตัวเดิมเท่านั้น: งาน = useTaskStore.markReviewed (ปุ่ม "ผ่าน" บนหน้างาน) · ใบแจ้งซ่อม = reviewWorkOrderAction
 * "ไม่ผ่าน" ต้องเลือกกำหนดส่งใหม่ (งานกลุ่มเลือกรายคน) ⇒ พาไปหน้างาน ใช้ฟอร์มเดิม
 */
export function ReviewCard({ card }: { card: ChatTaskCard & { review: ChatReviewInfo } }) {
  const r = card.review;
  const me = useIdentityStore((s) => s.viewingAsUserId);
  const task = useTaskStore((s) => (r.source === "task" ? s.tasks.find((t) => t.id === card.taskId) : undefined));
  const reviewSettings = useTaskReviewSettingsStore((s) => s.settings);
  const [local, setLocal] = useState<Pick<ChatReviewInfo, "status" | "decidedBy" | "decidedAt"> | null>(null);
  const [pending, startTransition] = useTransition();

  // งาน: ค่าใน store สดกว่า (กดตรวจบนบอร์ดในเครื่องนี้แล้ว) — รอบเดียวกันเท่านั้น (completedAt ตรงกับตอนส่ง)
  const sameRound = !!task && task.status === "done" && task.completedAt === r.submittedAt;
  const fromStore: Pick<ChatReviewInfo, "status" | "decidedBy" | "decidedAt"> | null =
    r.source === "task" && task
      ? sameRound
        ? task.reviewedBy
          ? { status: "passed", decidedBy: task.reviewedBy, decidedAt: task.reviewedAt }
          : { status: "pending" }
        : r.status === "pending"
          ? { status: "closed" }
          : null
      : null;
  const state = local ?? fromStore ?? r;
  const isWo = r.source === "work_order";
  const canDecide =
    state.status === "pending" &&
    !!me &&
    me !== r.submitterId &&
    // งาน: กติกาเดียวกับปุ่มบนหน้างาน · ใบแจ้งซ่อม: ห้องนี้มีแต่คนเปิดใบ server ตรวจซ้ำตอนกด
    (isWo || (!!task && isAwaitingReview(task) && (canReviewTaskRecord(task, me, reviewSettings) || isOwner(me))));
  const who = r.submitterName ?? getUser(r.submitterId)?.name ?? "มีคน";

  function pass() {
    if (!me) return;
    if (!isWo) {
      const fresh = useTaskStore.getState().tasks.find((t) => t.id === card.taskId);
      if (!fresh || !isAwaitingReview(fresh) || fresh.completedAt !== r.submittedAt) {
        toast.error("งานนี้ถูกตรวจไปแล้ว หรือถูกส่งกลับไปแก้แล้ว");
        return;
      }
      useTaskStore.getState().markReviewed(card.taskId, me);
      setLocal({ status: "passed", decidedBy: me, decidedAt: new Date().toISOString() });
      toast.success("ตรวจผ่านแล้ว");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", card.taskId);
      fd.set("decision", "pass");
      const res = await reviewWorkOrderAction(fd);
      if (res.error) {
        toast.error(res.error);
        if (res.error.includes("ไปแล้ว") || res.error.includes("ไม่ได้รอตรวจ")) setLocal({ status: "closed" });
        return;
      }
      setLocal({ status: "passed", decidedBy: me, decidedAt: new Date().toISOString() });
      toast.success("ตรวจผ่านแล้ว — ไปขั้นบันทึกค่าใช้จ่ายต่อ");
    });
  }

  const open = state.status === "pending";
  const by = (id?: string) => (id ? ` · ${id === me ? "คุณ" : (getUser(id)?.name ?? "")}` : "");
  const at = (v?: string) => (v ? ` ${formatShortDate(v)}` : "");
  const decidedLine =
    state.status === "passed"
      ? `ตรวจแล้ว ผ่าน${by(state.decidedBy)}${at(state.decidedAt)}`
      : state.status === "failed"
        ? `ไม่ผ่าน ส่งกลับไปแก้${by(state.decidedBy)}${at(state.decidedAt)}`
        : state.status === "closed"
          ? "รอบนี้ปิดไปแล้ว (เปิดงานกลับ / ส่งรอบใหม่)"
          : null;
  const note = local ? undefined : r.note;

  return (
    <div
      className={cn(
        "w-72 max-w-full overflow-hidden rounded-2xl rounded-tl-md border bg-(--bg) text-left shadow-[0_1px_1px_rgba(0,0,0,0.06)]",
        open ? "border-[#b9c7e3]" : "border-(--line) opacity-80"
      )}
    >
      <div className={cn("flex items-center gap-2 px-3 py-2 text-xs font-semibold", open ? "bg-[#e9eef8] text-(--brand-navy,#1e3a6e)" : "bg-(--bg-soft) text-(--ink-soft)")}>
        {isWo ? <Wrench className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ClipboardCheck className="h-4 w-4 shrink-0" aria-hidden="true" />}
        <span className="min-w-0 truncate">
          เสร็จแล้ว รอตรวจ
          {open && canDecide ? " · รอคุณตรวจ" : ""}
        </span>
        <span className="ml-auto shrink-0 rounded border border-current px-1 text-[10px] leading-4">{isWo ? "ใบแจ้งซ่อม" : "Task"}</span>
      </div>

      <div className="flex flex-col gap-2 px-3 py-2.5">
        <div className="line-clamp-2 text-[15px] font-semibold text-(--ink)">{card.title}</div>
        {card.code && <div className="-mt-1.5 text-xs text-(--ink-soft)">{card.code}</div>}
        <div className="text-xs text-(--ink-soft)">
          <b className="text-(--ink)">{who}</b> ส่งงานแล้ว{at(r.submittedAt)}
        </div>
        {card.dueDate && (
          <div className="flex items-center gap-1.5 text-sm text-(--ink-soft)">
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
            กำหนดส่ง {formatShortDate(card.dueDate)}
          </div>
        )}

        {decidedLine && (
          <div className={cn("flex items-center gap-1 text-[13px] font-semibold", state.status === "failed" ? "text-[#b42318]" : "text-(--ink-soft)")}>
            {state.status === "passed" ? <Check className="h-4 w-4" aria-hidden="true" /> : state.status === "failed" ? <X className="h-4 w-4" aria-hidden="true" /> : null}
            {decidedLine}
          </div>
        )}
        {note && state.status === "failed" && <div className="text-xs text-(--ink-soft)">เหตุผล: {note}</div>}

        {canDecide && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={pass}
              disabled={pending}
              className="h-10 flex-1 rounded-lg bg-(--brand-navy,#1e3a6e) text-sm font-semibold text-white disabled:opacity-60"
            >
              ผ่าน
            </button>
            <Link
              href={card.link}
              className="flex h-10 flex-1 items-center justify-center rounded-lg border border-[#e3a59f] text-sm font-semibold text-[#b42318]"
            >
              ไม่ผ่าน…
            </Link>
          </div>
        )}
        {canDecide && <div className="-mt-1 text-[11px] text-(--ink-soft)">ไม่ผ่าน: เปิดหน้างานเพื่อใส่เหตุผลและกำหนดส่งใหม่</div>}
      </div>

      <Link href={card.link} className="flex items-center justify-between border-t border-(--line) px-3 py-2 text-sm font-semibold text-(--brand-navy,#1e3a6e) hover:bg-(--bg-soft)">
        ดูรายละเอียด
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
