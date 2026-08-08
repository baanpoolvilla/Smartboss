"use client";

import { useState } from "react";
import { AlarmClockOff } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/modules/report_task/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/modules/report_task/components/ui/dialog";
import { Textarea } from "@/modules/report_task/components/ui/textarea";
import { Button } from "@/modules/report_task/components/ui/button";
import { getUser } from "@/modules/report_task/data/mock";
import { formatShortDate } from "@/modules/report_task/lib/format";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { cn } from "@/modules/report_task/lib/utils";
import { useTaskStore, SYSTEM_USER_ID } from "@/modules/report_task/store/task-store";
import { usePenaltySettingsStore } from "@/modules/report_task/store/penalty-settings-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canDockPenalty, canOverrideAutoPenalty, canSeePenaltyStatus } from "@/modules/report_task/lib/permissions";
import type { Task } from "@/modules/report_task/types";
import { toast } from "sonner";

/**
 * The missed-deadline dock shown as a task *status* — not a sticker.
 * - "strict" tasks: docked automatically the instant the task goes overdue —
 *   nothing to click for anyone else. Only the owner can cancel one (with a
 *   stated reason) or manually reinstate one afterward if it turns out the
 *   work genuinely wasn't done.
 * - "flexible" tasks: one click docks the default points (configured in the
 *   sticker manager); clicking again removes it. Case-by-case, at a lead's
 *   discretion. Appears once docked, or as an offer on an overdue task.
 */
export function PenaltyChip({
  task,
  className,
  variant = "full",
}: {
  task: Task;
  className?: string;
  /** "card" keeps the un-docked state to a tiny hover-only icon to avoid clutter. */
  variant?: "full" | "card";
}) {
  const applyPenalty = useTaskStore((s) => s.applyPenalty);
  const clearPenalty = useTaskStore((s) => s.clearPenalty);
  const overrideAutoPenalty = useTaskStore((s) => s.overrideAutoPenalty);
  const defaultPoints = usePenaltySettingsStore((s) => s.defaultPoints);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  // A new dock affects someone else's score — worth one confirm click before
  // it applies, now that more people than just a department head can trigger
  // it (the task's own assigner). Undocking (an "oops, undo") stays a single
  // click, same as before.
  const [confirmDockOpen, setConfirmDockOpen] = useState(false);

  const isOverdue = dueUrgency(task) === "overdue";
  const penalty = task.penalty;
  const isStrict = (task.deadlineType ?? "flexible") === "strict";
  const canDock = !isStrict && canDockPenalty(task.assignedById, task.departmentIds, viewingAsUserId);
  const canOverride = isStrict && canOverrideAutoPenalty(viewingAsUserId);
  // After an owner cancels an auto-dock, the chip shouldn't just go dark —
  // if it turns out the work really wasn't done, the owner can reinstate the
  // standard dock directly (no reason needed to re-apply, only to undo).
  const canManualRedock = isStrict && !penalty && isOverdue && canOverride;

  // An existing penalty is a fact everyone sees; an *offer* to dock one is an
  // action affordance hidden from anyone who can't actually use it (see
  // canSeePenaltyStatus).
  if (!canSeePenaltyStatus(task, viewingAsUserId)) return null;

  function submitOverride() {
    const reason = overrideReason.trim();
    if (!reason) return;
    overrideAutoPenalty(task.id, viewingAsUserId, reason);
    toast.success(`ยกเลิกการหักคะแนนอัตโนมัติ "${task.title}" แล้ว — บันทึกเหตุผลไว้ในคอมเมนต์`);
    setOverrideOpen(false);
    setOverrideReason("");
  }

  function confirmManualRedock() {
    applyPenalty(task.id, defaultPoints, viewingAsUserId, "หักคะแนนโดยเจ้าของระบบ (ตรวจสอบแล้วว่างานไม่เสร็จจริง)");
    toast.error(`หัก ${defaultPoints} คะแนน — "${task.title}" เลยกำหนด (ตรงกำหนด)`);
    setConfirmDockOpen(false);
  }

  function confirmDock() {
    applyPenalty(task.id, defaultPoints, viewingAsUserId);
    toast.error(`หัก ${defaultPoints} คะแนน — "${task.title}" เลยกำหนด`);
    setConfirmDockOpen(false);
  }

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (isStrict) {
      if (penalty) {
        if (!canOverride) {
          toast.error("ยกเลิกการหักคะแนนอัตโนมัติได้เฉพาะเจ้าของระบบเท่านั้น");
          return;
        }
        setOverrideReason("");
        setOverrideOpen(true);
        return;
      }
      // No penalty yet on a strict+overdue task — either it hasn't been
      // swept yet, or an owner already cancelled it. Only the owner can
      // manually put it back.
      if (!canManualRedock) return;
      setConfirmDockOpen(true);
      return;
    }
    if (!canDock) {
      toast.error("หักคะแนนได้เฉพาะหัวหน้าแผนกที่งานนี้สังกัด");
      return;
    }
    if (penalty) {
      clearPenalty(task.id);
      toast.success(`ยกเลิกการหักคะแนน "${task.title}" แล้ว`);
      return;
    }
    setConfirmDockOpen(true);
  }

  const by = penalty
    ? penalty.byUserId === SYSTEM_USER_ID
      ? "ระบบ (อัตโนมัติ)"
      : getUser(penalty.byUserId)?.name
    : null;

  const interactive = isStrict ? (penalty ? canOverride : canManualRedock) : canDock;

  // On the card, an un-docked overdue task shows only a tiny hover-revealed icon
  // (no wide "ยังไม่หักคะแนน" pill) to keep dense boards clean.
  const trigger =
    variant === "card" && !penalty ? (
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={toggle}
        title={canDock || canManualRedock ? `หักคะแนนงานนี้ (−${defaultPoints})` : "หักคะแนนได้เฉพาะหัวหน้าแผนก"}
        aria-label={`หักคะแนนงานนี้ (−${defaultPoints})`}
        className={cn(
          "h-5 w-5 rounded-md flex items-center justify-center text-[var(--ink-soft)] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all",
          canDock || canManualRedock ? "hover:bg-red-50 hover:text-red-600" : "cursor-not-allowed",
          className
        )}
      >
        <AlarmClockOff className="h-3.5 w-3.5" />
      </button>
    ) : (
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={toggle}
        className={cn(
          "inline-flex items-center gap-1 h-5 rounded-md px-1.5 text-[10px] font-semibold whitespace-nowrap transition-all",
          penalty
            ? cn(
                "bg-red-600 text-white shadow-[0_1px_2px_rgba(220,38,38,0.4)]",
                interactive ? "hover:bg-red-700" : "cursor-not-allowed opacity-80"
              )
            : cn(
                "bg-white text-[var(--ink-soft)] ring-1 ring-inset ring-[var(--line)]",
                interactive ? "hover:ring-red-300 hover:text-red-600" : "cursor-not-allowed opacity-60"
              ),
          className
        )}
      >
        {penalty ? (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
            {variant === "card" ? `−${Math.abs(penalty.points)}` : `หักคะแนน −${Math.abs(penalty.points)}`}
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--line)]" />
            หักคะแนน −{defaultPoints}
          </>
        )}
      </button>
    );

  return (
    <>
      <Tooltip>
        <TooltipTrigger render={trigger} />
        <TooltipContent className="text-xs">
          {penalty ? (
            <>
              <p className="font-medium">หักไป {Math.abs(penalty.points)} คะแนน</p>
              {penalty.reason && <p className="opacity-80">เหตุผล: {penalty.reason}</p>}
              <p className="opacity-80">โดย {by ?? "—"} · {formatShortDate(penalty.appliedAt)}</p>
              {isStrict ? (
                <p className="opacity-80 mt-0.5">
                  {canOverride ? "งานนี้กำหนดส่งตรงเวลา — หักคะแนนอัตโนมัติ กดเพื่อยกเลิก (ต้องใส่เหตุผล)" : "งานนี้กำหนดส่งตรงเวลา — หักคะแนนอัตโนมัติ ยกเลิกได้เฉพาะเจ้าของระบบ"}
                </p>
              ) : (
                <p className="opacity-80 mt-0.5">{canDock ? "กดเพื่อยกเลิก" : "ยกเลิกได้เฉพาะหัวหน้าแผนก"}</p>
              )}
            </>
          ) : (
            <>
              <p className="font-medium">
                {isOverdue ? "งานนี้เลยกำหนด" : `เลื่อนกำหนดส่งมาแล้ว ${task.revisions.length} ครั้ง`}
              </p>
              <p className="opacity-80">
                {isStrict
                  ? canManualRedock
                    ? `กดเพื่อหัก ${defaultPoints} คะแนนเอง (เจ้าของระบบ)`
                    : "งานตรงกำหนด — รอระบบหักคะแนนอัตโนมัติ"
                  : canDock
                    ? `กดเพื่อหัก ${defaultPoints} คะแนน (ปรับค่าเริ่มต้นได้ในเมนูสติกเกอร์)`
                    : "หักคะแนนได้เฉพาะหัวหน้าแผนกที่งานนี้สังกัด"}
              </p>
            </>
          )}
        </TooltipContent>
      </Tooltip>

      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>ยกเลิกการหักคะแนนอัตโนมัติ</DialogTitle>
            <DialogDescription>
              งานนี้เลยกำหนดส่ง จึงถูกหักคะแนนอัตโนมัติ — พิมพ์เหตุผลที่จะยกเลิกด้านล่าง
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={3}
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="เช่น ตั้งกำหนดส่งผิดพลาด, ระบบขัดข้อง..."
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOverrideOpen(false)}>ยกเลิก</Button>
            <Button
              className="bg-[var(--chart-red)] hover:bg-red-700 text-white"
              onClick={submitOverride}
              disabled={!overrideReason.trim()}
            >
              ยืนยันยกเลิกการหักคะแนน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDockOpen} onOpenChange={setConfirmDockOpen}>
        <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>หักคะแนน −{defaultPoints}?</DialogTitle>
            <DialogDescription>
              จะหักคะแนน {defaultPoints} คะแนนจาก &quot;{task.title}&quot; — มีผลกับคะแนนรวมของ{" "}
              {task.assigneeIds.length > 1 ? "ผู้รับผิดชอบทุกคน" : "ผู้รับผิดชอบ"} ทันที
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDockOpen(false)}>ยกเลิก</Button>
            <Button
              className="bg-[var(--chart-red)] hover:bg-red-700 text-white"
              onClick={isStrict ? confirmManualRedock : confirmDock}
            >
              ยืนยันหักคะแนน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
