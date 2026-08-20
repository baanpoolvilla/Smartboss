"use client";

import { memo, useState, type KeyboardEvent } from "react";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Progress } from "@/modules/report_task/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/modules/report_task/components/ui/tooltip";
import { DueDateBadge } from "@/modules/report_task/components/shared/due-date-badge";
import { PenaltyChip } from "@/modules/report_task/components/shared/penalty-chip";
import { getUser, getDepartment, canManage } from "@/modules/report_task/lib/directory";
import { priorityMeta, statusMeta } from "@/modules/report_task/lib/task-meta";
import { isSuspiciousRevision, reactionCounts } from "@/modules/report_task/lib/task-flags";
import { isTaskFullyDone, remainingChecklistCount } from "@/modules/report_task/lib/task-completion";
import { toast } from "sonner";
import { daysUntil } from "@/modules/report_task/lib/format";
import { cn } from "@/modules/report_task/lib/utils";
import type { Task } from "@/modules/report_task/types";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useStickerStore } from "@/modules/report_task/store/sticker-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { MessageSquare, Paperclip, History, SmilePlus, SearchCheck, Check, Circle, Star, Clock } from "lucide-react";
import { showStickerToast } from "@/modules/report_task/lib/sticker-toast";
import { StickerConfirmDialog } from "@/modules/report_task/components/shared/sticker-confirm-dialog";
import type { Sticker } from "@/modules/report_task/types";

interface CardBodyProps {
  task: Task;
  onOpen?: (id: string) => void;
  /** True inside the derived "เลยกำหนด" column — tags the card with its real
   * underlying status (รอดำเนินการ/กำลังทำ) so it's still clear which late
   * tasks have someone actively on them and which are untouched, since the
   * column itself no longer distinguishes the two. */
  showOriginalStatus?: boolean;
  /** True when the board is grouped by "ความสำคัญ" — the column header
   * already carries priority then, so the top-left badge switches to status
   * instead of repeating it (mirrors groupBy==="status", where this same
   * badge shows priority since status is the one already on the header). */
  groupedByPriority?: boolean;
}

function TaskCardBody({ task, onOpen, showOriginalStatus, groupedByPriority }: CardBodyProps) {
  const addReaction = useTaskStore((s) => s.addReaction);
  const moveTask = useTaskStore((s) => s.moveTask);
  const toggleAssigneeChecklist = useTaskStore((s) => s.toggleAssigneeChecklist);
  const stickers = useStickerStore((s) => s.stickers);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const isDone = task.status === "done";
  // Strikethrough specifically means "confirmed finished" — a done-but-
  // unreviewed card ("รอตรวจสอบ") still needs someone to actually check it,
  // so crossing the title out already read as more final than it really is.
  const isReviewedDone = isDone && !!task.reviewedBy;
  // A group task tracks each assignee's own completion, derived from their
  // own checklist items — the card's status only follows once everyone's
  // marked done (see task-completion.ts). The quick-toggle circle below
  // then means "is MY part done" for whoever's viewing, not "is the whole
  // task done".
  const isShared = task.taskMode === "group";
  const completedCount = task.completedAssigneeIds?.length ?? 0;
  const iAmAssignee = task.assigneeIds.includes(viewingAsUserId);
  const myPartDone = isShared ? (task.completedAssigneeIds ?? []).includes(viewingAsUserId) : isDone;
  // "หัวร้อน" is a reprimand, not peer feedback — only the department head
  // can hand it out. Other stickers stay open to everyone.
  const pickableStickers = canManage(viewingAsUserId) ? stickers : stickers.filter((s) => s.id !== "angry");

  const assignees = task.assigneeIds.map(getUser).filter(Boolean);
  // In the "เลยกำหนด" column, a group task only has SOME people still
  // late — call them out by name/department instead of making the viewer
  // guess which of several assignees is actually the problem.
  const pendingOverdueAssignees =
    showOriginalStatus && isShared
      ? task.assigneeIds
          .filter((id) => !(task.completedAssigneeIds ?? []).includes(id))
          .filter((id) => daysUntil(task.assigneeDueDates?.[id] ?? task.dueDate) < 0)
          .map(getUser)
          .filter(Boolean)
      : [];
  const suspicious = isSuspiciousRevision(task);

  const reactionTotals = reactionCounts(task);
  const [pendingSticker, setPendingSticker] = useState<Sticker | null>(null);

  function handleReact(sticker: Sticker) {
    setPendingSticker(sticker);
  }

  function confirmSticker() {
    if (!pendingSticker) return;
    addReaction(task.id, pendingSticker.id, viewingAsUserId);
    showStickerToast(pendingSticker, task.title);
    setPendingSticker(null);
  }

  // A group task's checklist is scoped to the viewer's own items when
  // they're an assignee (their own progress is what matters to them);
  // anyone else (a non-assignee lead, the CEO) sees the aggregate across
  // everyone, same as before.
  const visibleChecklist = isShared && iAmAssignee ? task.checklist.filter((c) => c.ownerId === viewingAsUserId) : task.checklist;
  const doneChecklist = visibleChecklist.filter((c) => c.done).length;

  return (
    <>
    <div
      id={`task-card-${task.id}`}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={() => onOpen?.(task.id)}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen?.(task.id);
        }
      }}
      className={cn(
        "group relative rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_3px_rgba(16,24,40,0.07),0_1px_2px_rgba(16,24,40,0.04)] transition-all duration-200",
        onOpen && "cursor-pointer hover:shadow-[0_12px_28px_-10px_rgba(16,24,40,0.22)] hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--brand-green)_35%,var(--line))]",
        // A done card should read as "settled" at a glance even sitting next
        // to open ones in a column that isn't grouped by status (priority,
        // assignee) — the checkbox + strikethrough alone turned out too
        // subtle to notice (see below), so the whole card recedes too.
        isDone && "opacity-70"
      )}
    >
      <div className="flex items-center gap-2 mb-2.5">
        {/* Dot + label badge, colored to match whichever attribute it's
            showing — priority's own accent (red/amber/green/gray) normally,
            or status's accent when the board is grouped by priority (see
            groupedByPriority above), so the column header is never just
            repeating the exact same value back at itself. Once a task is
            done, both stop mattering — swap in one status badge instead
            (never two stacked — a done-but-unreviewed card used to show
            "เสร็จแล้ว" + a separate "รอเช็ค" chip side by side, which just
            reread as "is this done or not?"): light green "รอตรวจสอบ" while
            it waits on sign-off (see rejectReview/markReviewed in
            task-store.ts — same review the "รอตรวจสอบ" board column tracks),
            switching to the darker "เสร็จสิ้น" only once someone's actually
            checked it. */}
        {isDone ? (
          task.reviewedBy ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--brand-green)_14%,white)] text-[var(--brand-green-dark)]">
              <Check className="h-2.5 w-2.5" strokeWidth={3} />
              เสร็จสิ้น
            </span>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  // Two halves in one pill instead of a single "รอตรวจสอบ"
                  // label — "เสร็จ" (the part that's actually true already,
                  // muted) and "รอตรวจสอบ" (what's still pending, full color)
                  // read as one continuous progress pill rather than a flat
                  // status word. Sized to content (not a forced 50/50 split)
                  // with nowrap on both halves — an even split at this card
                  // width squeezed "รอตรวจสอบ" onto two lines, which read as
                  // broken/blurry rather than a clean pill.
                  <span className="inline-flex items-stretch text-[10px] font-semibold rounded-full overflow-hidden ring-1 ring-inset ring-[color-mix(in_srgb,var(--chart-green)_30%,white)] whitespace-nowrap">
                    <span className="flex items-center gap-1 px-2.5 py-1 bg-[color-mix(in_srgb,var(--chart-green)_10%,white)] text-[var(--chart-green)] opacity-70">
                      <Check className="h-2.5 w-2.5 shrink-0" strokeWidth={3} />
                      เสร็จ
                    </span>
                    <span className="flex items-center gap-1 px-2.5 py-1 bg-[color-mix(in_srgb,var(--chart-green)_20%,white)] text-[var(--chart-green)]">
                      <Clock className="h-2.5 w-2.5 shrink-0" />
                      รอตรวจสอบ
                    </span>
                  </span>
                }
              />
              <TooltipContent>ส่งงานแล้ว รอหัวหน้าตรวจสอบยืนยันว่าเสร็จจริง</TooltipContent>
            </Tooltip>
          )
        ) : groupedByPriority ? (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[var(--ink-soft)]">
            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: statusMeta[task.status].accentColor }} />
            {statusMeta[task.status].label}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[var(--ink-soft)]">
            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: priorityMeta[task.priority].accentColor }} />
            {priorityMeta[task.priority].label}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {suspicious && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="flex items-center justify-center h-5 w-5 rounded-md bg-amber-50 text-[var(--chart-amber)]">
                    <SearchCheck className="h-3 w-3" />
                  </span>
                }
              />
              <TooltipContent>แก้ไขกำหนดส่ง {task.revisions.length} ครั้ง — ควรตรวจสอบ</TooltipContent>
            </Tooltip>
          )}
          {task.revisions.length > 0 && !suspicious && (
            <span className="flex items-center gap-0.5 text-[10px] text-[var(--ink-soft)]">
              <History className="h-3 w-3" />
              {task.revisions.length}
            </span>
          )}
        </div>
      </div>

      {/* Completion circle + title */}
      <div className="flex items-start gap-2">
        {onOpen && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isShared) {
                      if (iAmAssignee) toggleAssigneeChecklist(task.id, viewingAsUserId);
                    } else if (isDone) {
                      moveTask(task.id, "todo");
                    } else if (!isTaskFullyDone(task.assigneeIds, task.checklist)) {
                      toast.error(`ยังติ๊ก checklist ไม่ครบ ${remainingChecklistCount(task.checklist)} ข้อ — ทำให้ครบก่อนถึงจะปิดงานได้`);
                    } else {
                      moveTask(task.id, "done");
                    }
                  }}
                  disabled={isShared && !iAmAssignee}
                  aria-label={myPartDone ? "ทำเครื่องหมายว่ายังไม่เสร็จ" : "ทำเครื่องหมายว่าเสร็จแล้ว"}
                  className={cn(
                    "mt-0.5 h-4.5 w-4.5 rounded-full flex items-center justify-center shrink-0 transition-all",
                    myPartDone
                      ? "bg-[var(--chart-green)] text-white"
                      : "text-[var(--line)] hover:text-[var(--chart-green)] hover:scale-110",
                    isShared && !iAmAssignee && "opacity-50 hover:scale-100 cursor-default"
                  )}
                >
                  {myPartDone ? <Check className="h-3 w-3" /> : <Circle className="h-4 w-4" />}
                </button>
              }
            />
            <TooltipContent>
              {isShared
                ? iAmAssignee
                  ? myPartDone
                    ? "ยกเลิกเครื่องหมายว่าส่วนของฉันเสร็จ"
                    : `ทำเครื่องหมายว่าส่วนของฉันเสร็จแล้ว (${completedCount}/${task.assigneeIds.length} คนเสร็จแล้ว)`
                  : `${completedCount}/${task.assigneeIds.length} คนเสร็จแล้ว — ไม่ได้รับมอบหมายงานนี้`
                : myPartDone
                  ? "ทำเครื่องหมายว่ายังไม่เสร็จ"
                  : "ทำเครื่องหมายว่าเสร็จแล้ว (คลิกเดียว ไม่ต้องเปิดงาน)"}
            </TooltipContent>
          </Tooltip>
        )}
        <div className="min-w-0 flex-1">
          <p className={cn("text-[13px] font-semibold leading-snug line-clamp-2 text-[var(--ink)]", isDone && "text-[var(--ink-soft)] font-medium", isReviewedDone && "line-through")}>
            {task.title}
          </p>
          {isShared && (
            <p className="text-[10px] text-[var(--ink-soft)] mt-0.5">{completedCount}/{task.assigneeIds.length} คนเสร็จแล้ว</p>
          )}
        </div>
      </div>

      {/* Checklist progress at a glance — the fraction alone (in the meta row
          below) is easy to skim past; a bar reads instantly even at a glance
          across a busy column. */}
      {visibleChecklist.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <Progress
            value={(doneChecklist / visibleChecklist.length) * 100}
            className="flex-1"
          />
          <span className="text-[10px] tabular-nums text-[var(--ink-soft)] shrink-0">
            {doneChecklist}/{visibleChecklist.length}
          </span>
        </div>
      )}

      {/* Checklist preview — Planner's "show on card" */}
      {task.showChecklistOnCard && visibleChecklist.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {visibleChecklist.slice(0, 4).map((c) => (
            <div key={c.id} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "h-3 w-3 rounded-sm border flex items-center justify-center shrink-0",
                  c.done ? "bg-[var(--chart-green)] border-[var(--chart-green)]" : "border-[var(--line)]"
                )}
              >
                {c.done && <Check className="h-2 w-2 text-white" />}
              </span>
              <span className={cn("text-[10px] truncate", c.done ? "line-through text-[var(--ink-soft)]" : "text-[var(--ink-soft)]")}>
                {c.text}
              </span>
            </div>
          ))}
          {visibleChecklist.length > 4 && (
            <p className="text-[10px] text-[var(--ink-soft)] pl-4.5">+{visibleChecklist.length - 4} รายการ</p>
          )}
        </div>
      )}

      {pendingOverdueAssignees.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-[10px] font-medium text-[var(--chart-red)]">ยังไม่เสร็จ ({pendingOverdueAssignees.length}):</p>
          {pendingOverdueAssignees.map((u) => (
            <div key={u!.id} className="flex items-center gap-1.5">
              <Avatar className="h-4 w-4 shrink-0">
                <AvatarFallback className="text-[7px] bg-red-50 text-[var(--chart-red)]">{u!.avatar}</AvatarFallback>
              </Avatar>
              <span className="text-[10px] truncate">{u!.name}</span>
              <span className="text-[9px] text-[var(--ink-soft)] truncate">{getDepartment(u!.departmentId)?.name}</span>
            </div>
          ))}
        </div>
      )}

      {Object.keys(reactionTotals).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {Object.entries(reactionTotals).map(([stickerId, count]) => {
            const sticker = stickers.find((s) => s.id === stickerId);
            if (!sticker) return null;
            return (
              <span
                key={stickerId}
                title={`${sticker.label} (${sticker.points > 0 ? `+${sticker.points}` : sticker.points})`}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-soft)] flex items-center gap-0.5"
              >
                <span>{sticker.emoji}</span>
                {count > 1 && <span className="text-[var(--ink-soft)]">{count}</span>}
              </span>
            );
          })}
        </div>
      )}

      {/* Divider keeps the meta row visually separate from the body */}
      <div className="mt-3.5 pt-3 border-t border-[var(--line)]/60 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 text-[var(--ink-soft)] min-w-0">
          {showOriginalStatus && (
            <span
              className={cn(
                "inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-md whitespace-nowrap",
                task.status === "in_progress" ? "bg-amber-50 text-[var(--chart-amber)]" : "bg-slate-100 text-[var(--chart-gray)]"
              )}
            >
              {task.status === "in_progress" ? statusMeta.in_progress.label : statusMeta.todo.label}
            </span>
          )}
          <DueDateBadge task={task} />
          {onOpen && !isShared && <PenaltyChip task={task} variant="card" />}
          {onOpen && isShared && Object.keys(task.penalties ?? {}).length > 0 && (
            <span className="flex items-center gap-0.5 h-5 rounded-md px-1.5 text-[10px] font-semibold bg-red-600 text-white" title="มีคนถูกหักคะแนน">
              −{Object.values(task.penalties ?? {}).reduce((sum, p) => sum + Math.abs(p.points), 0)}
            </span>
          )}
          {task.comments.length > 0 && (
            <span className="flex items-center gap-0.5 text-[11px]" title="ความคิดเห็น">
              <MessageSquare className="h-3.5 w-3.5" /> {task.comments.length}
            </span>
          )}
          {task.attachments.length > 0 && (
            <span className="flex items-center gap-0.5 text-[11px]" title="ไฟล์แนบ">
              <Paperclip className="h-3.5 w-3.5" /> {task.attachments.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onOpen && (
            <Popover>
              <PopoverTrigger
                render={
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    className="h-6 w-6 rounded-full flex items-center justify-center text-[var(--ink-soft)] ring-1 ring-inset ring-[var(--line)] bg-white hover:bg-[var(--accent)] hover:text-[var(--brand-green-dark)] hover:ring-[var(--brand-green)] data-[popup-open]:bg-[var(--accent)] data-[popup-open]:text-[var(--brand-green-dark)] transition-colors"
                    title="ติดสติกเกอร์ / ให้คะแนน"
                    aria-label="ติดสติกเกอร์ / ให้คะแนน"
                  >
                    <SmilePlus className="h-3.5 w-3.5" />
                  </button>
                }
              />
              <PopoverContent
                align="end"
                className="w-auto p-1.5 flex gap-1"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {pickableStickers.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleReact(s)}
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-base hover:bg-[var(--bg-soft)] transition-colors"
                    title={`${s.label} (${s.points > 0 ? `+${s.points}` : s.points})`}
                  >
                    {s.emoji}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}

          <div
            className="flex items-center -space-x-2"
            title={
              assignees.length > 1
                ? `ผู้รับผิดชอบร่วม ${assignees.length} คน: ${assignees
                    .map((a) => {
                      const tags = [
                        task.mainAssigneeId === a!.id && "หัวหน้า",
                        isShared && (task.completedAssigneeIds ?? []).includes(a!.id) && "เสร็จแล้ว",
                      ].filter(Boolean);
                      return tags.length > 0 ? `${a!.name} (${tags.join(", ")})` : a!.name;
                    })
                    .join(", ")}`
                : assignees[0]?.name
            }
          >
            {assignees.slice(0, 3).map((a) => {
              // For a shared task, anyone glancing at the board — including
              // someone who isn't an assignee, like the CEO — should be able
              // to tell who's done and who isn't without opening the card.
              const done = isShared && (task.completedAssigneeIds ?? []).includes(a!.id);
              return (
                <div key={a!.id} className="relative">
                  <Avatar className="h-6 w-6 ring-2 ring-white">
                    <AvatarFallback className="text-[9px] bg-[var(--accent)] text-[var(--brand-green-dark)]">
                      {a!.avatar}
                    </AvatarFallback>
                  </Avatar>
                  {done && (
                    <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-[var(--chart-green)] ring-2 ring-white flex items-center justify-center">
                      <Check className="h-2 w-2 text-white" strokeWidth={3} />
                    </span>
                  )}
                  {task.mainAssigneeId === a!.id && (
                    <Star className="absolute -top-1 -left-1 h-3 w-3 text-amber-500" fill="currentColor" />
                  )}
                </div>
              );
            })}
            {assignees.length > 3 && (
              <span className="h-6 w-6 rounded-full ring-2 ring-white bg-[var(--bg-soft)] text-[9px] text-[var(--ink-soft)] flex items-center justify-center">
                +{assignees.length - 3}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
    <StickerConfirmDialog
      open={!!pendingSticker}
      onOpenChange={(open) => !open && setPendingSticker(null)}
      sticker={pendingSticker}
      recipientName={assignees[0]?.name ?? "ผู้รับผิดชอบ"}
      taskTitle={task.title}
      onConfirm={confirmSticker}
    />
    </>
  );
}

export const TaskCard = memo(function TaskCard({
  task,
  onOpen,
  showOriginalStatus,
  groupedByPriority,
}: {
  task: Task;
  onOpen: (id: string) => void;
  showOriginalStatus?: boolean;
  groupedByPriority?: boolean;
}) {
  return <TaskCardBody task={task} onOpen={onOpen} showOriginalStatus={showOriginalStatus} groupedByPriority={groupedByPriority} />;
});
