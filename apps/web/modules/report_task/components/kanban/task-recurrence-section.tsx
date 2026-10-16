"use client";

import { useState } from "react";
import { ChevronDown, Pause, Pencil, Repeat, SkipForward } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/modules/report_task/components/ui/alert-dialog";
import { Button } from "@/modules/report_task/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/modules/report_task/components/ui/dialog";
import { RecurrenceFields, RecurrencePreview } from "@/modules/report_task/components/kanban/recurrence-fields";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { finishedTaskOnTime } from "@/modules/report_task/lib/task-penalty-sweep";
import {
  addDaysYmd,
  describeEnd,
  describeRule,
  formatThaiDate,
  latestOfSeries,
  occurrenceDate,
  reanchorRule,
  roundDateBounds,
  scheduledDate,
  seriesTasks,
  validateRule,
} from "@/modules/report_task/lib/task-recurrence";
import { cn } from "@/modules/report_task/lib/utils";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { Task, TaskRecurrenceRule } from "@/modules/report_task/types";

function pointsOf(t: Task): number {
  return Math.abs(t.penalty?.points ?? 0) + Object.values(t.penalties ?? {}).reduce((s, p) => s + Math.abs(p.points), 0);
}

function roundStatus(t: Task): { label: string; tone: "ok" | "late" | "cur" } {
  if (t.status === "done") return finishedTaskOnTime(t) ? { label: "ส่งตรงเวลา", tone: "ok" } : { label: "ส่งช้า", tone: "late" };
  if (dueUrgency(t) === "overdue") return { label: "เลยกำหนด", tone: "late" };
  return { label: "ยังไม่เสร็จ", tone: "cur" };
}

const TONE = {
  ok: "bg-[var(--accent)] text-[var(--brand-green-dark)]",
  late: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  cur: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  next: "bg-[var(--bg-soft)] text-[var(--ink-soft)]",
};

/**
 * กล่อง "ทำซ้ำ" ในหน้ารายละเอียดงาน — ประวัติทุกรอบ + รอบที่จะมา + ปุ่มจัดการทั้งชุด
 * canManage: ดู canManageSeries — คนที่ได้รับงานกดข้าม/หยุดเองไม่ได้
 */
export function TaskRecurrenceSection({
  task,
  canManage,
  actorId,
  onLeave,
}: {
  task: Task;
  canManage: boolean;
  actorId: string;
  /** รอบนี้ถูกลบ (ข้าม/ลบและหยุด) — ปิดหน้ารายละเอียด */
  onLeave: () => void;
}) {
  const tasks = useTaskStore((s) => s.tasks);
  const skipRound = useTaskStore((s) => s.skipRecurringRound);
  const stopRecurrence = useTaskStore((s) => s.stopRecurrence);
  const updateRecurrence = useTaskStore((s) => s.updateRecurrence);
  const setRoundDate = useTaskStore((s) => s.setRoundDate);
  // ตารางรอบพับไว้เป็นค่าเริ่มต้น — เห็นแค่แถวสรุป กดเพื่อกาง
  const [open, setOpen] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [stopDelete, setStopDelete] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<TaskRecurrenceRule | null>(null);

  const rec = task.recurrence!;
  const rounds = seriesTasks(tasks, rec.seriesId);
  const latest = latestOfSeries(tasks, rec.seriesId) ?? task;
  const lrec = latest.recurrence!;
  const rule = lrec.rule;
  const stopped = !!lrec.stopped;
  const lead = Math.max(0, rule.leadDays || 0);
  const upcoming = stopped
    ? []
    : // รอบที่ยังไม่ขึ้นบอร์ด 6 รอบถัดไป — กดแก้วันได้ทีละรอบ
      Array.from({ length: 6 }, (_, i) => lrec.occurrence + 1 + i)
        .map((n) => ({ n, due: occurrenceDate(rule, n) }))
        .filter((u): u is { n: number; due: string } => !!u.due);
  // ตารางที่กำลังแก้ ต่อจากรอบล่าสุด (ดู reanchorRule) — ใช้ทั้งพรีวิวและตอนบันทึก
  const draftRule = draft ? reanchorRule(draft, latest.dueDate, lrec.occurrence) : null;

  const onTime = rounds.filter((t) => t.status === "done" && finishedTaskOnTime(t)).length;
  const late = rounds.filter((t) => roundStatus(t).tone === "late").length;
  const docked = rounds.reduce((s, t) => s + pointsOf(t), 0);

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl border border-[var(--line)]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-violet-50 px-3 py-2 text-left transition-colors hover:bg-violet-100/70 dark:bg-violet-950/40 dark:hover:bg-violet-950/60"
        >
          <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-violet-700 dark:text-violet-300">
            <Repeat className="h-4 w-4 shrink-0" />
            <span className="min-w-0">
              {describeRule(rule)}
              {latest.dueTime ? ` · ${latest.dueTime}` : ""} · {stopped ? "หยุดทำซ้ำแล้ว" : describeEnd(rule)}
            </span>
          </p>
          <div className="flex items-center gap-3 text-xs tabular-nums">
            <span>
              ตรงเวลา <b className="text-[var(--brand-green-dark)]">{onTime}</b>
            </span>
            <span>
              ช้า/ไม่ส่ง <b className="text-red-600 dark:text-red-400">{late}</b>
            </span>
            <span>
              หักรวม <b className="text-red-600 dark:text-red-400">{docked ? `−${docked}` : "0"}</b>
            </span>
            <span className="flex items-center gap-0.5 text-[var(--ink-soft)]">
              {open ? "ย่อ" : `ดู ${rounds.length + upcoming.length} รอบ`}
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
            </span>
          </div>
        </button>
        {open && (
          // รายการแทนตาราง — จอมือถือแคบ ตาราง 4 คอลัมน์ล้นจนต้องเลื่อนข้าง แถวแบบนี้ห่อบรรทัดเองได้ทุกความกว้าง
          <ul className="divide-y divide-[var(--line)] border-t border-[var(--line)] text-xs tabular-nums">
            {rounds.map((t) => {
              const st = roundStatus(t);
              const pts = pointsOf(t);
              return (
                <li key={t.id} className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2", t.id === task.id && "bg-sky-50/60 dark:bg-sky-950/20")}>
                  <span className="w-11 shrink-0 font-semibold">รอบ {t.recurrence!.occurrence}</span>
                  <span className="min-w-0 flex-1">
                    {formatThaiDate(t.dueDate)}
                    {t.id === task.id && <span className="ml-1 text-[10px] text-[var(--ink-soft)]">(งานนี้)</span>}
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 font-medium", TONE[st.tone])}>{st.label}</span>
                  <span className={cn("w-7 shrink-0 text-right font-semibold", pts ? "text-red-600 dark:text-red-400" : "text-[var(--ink-soft)]")}>
                    {pts ? `−${pts}` : "—"}
                  </span>
                </li>
              );
            })}
            {upcoming.map((u, i) => {
              const moved = !!rule.dateOverrides?.[String(u.n)];
              const prevDue = i === 0 ? latest.dueDate : upcoming[i - 1]!.due;
              const bounds = roundDateBounds(rule, u.n, prevDue);
              return (
                <li key={`up-${u.n}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-[var(--ink-soft)]">
                  <span className="w-11 shrink-0">รอบ {u.n}</span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    {/* รอบที่ยังไม่ขึ้นบอร์ด — กดวันที่เพื่อเลื่อนเฉพาะรอบนี้ ไม่แก้ = วันตามตารางปกติ */}
                    {canManage ? (
                      <DatePickerField
                        value={u.due}
                        minDate={bounds.min}
                        onChange={(v) => {
                          if (bounds.max && v > bounds.max) {
                            toast.error(`รอบ ${u.n} ต้องก่อนรอบถัดไป (ไม่เกิน ${formatThaiDate(bounds.max)})`);
                            return;
                          }
                          setRoundDate(task.id, u.n, v, actorId);
                          toast.success(`เลื่อนรอบ ${u.n} เป็น ${formatThaiDate(v)}`);
                        }}
                        className="h-7 w-[140px] text-xs [@media(pointer:coarse)]:h-9"
                      />
                    ) : (
                      <span>{formatThaiDate(u.due)}</span>
                    )}
                    {moved && (
                      <>
                        <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          เลื่อนจาก {formatThaiDate(scheduledDate(rule, u.n) ?? u.due, false)}
                        </span>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => setRoundDate(task.id, u.n, null, actorId)}
                            className="text-[10px] underline-offset-2 hover:text-[var(--ink)] hover:underline"
                          >
                            คืนวันปกติ
                          </button>
                        )}
                      </>
                    )}
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5", TONE.next)}>ขึ้นบอร์ด {formatThaiDate(addDaysYmd(u.due, -lead), false)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {canManage && (
        <div className="flex flex-wrap gap-1.5">
          {!stopped && (
            <Button type="button" variant="outline" size="sm" className="h-7 [@media(pointer:coarse)]:h-9 gap-1 text-xs" onClick={() => setSkipOpen(true)}>
              <SkipForward className="h-3.5 w-3.5" /> ข้ามรอบนี้
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 [@media(pointer:coarse)]:h-9 gap-1 text-xs"
            onClick={() => {
              setDraft(rule);
              setEditOpen(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" /> {stopped ? "ทำซ้ำต่อ / แก้การทำซ้ำ" : "แก้การทำซ้ำ"}
          </Button>
          {!stopped && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 [@media(pointer:coarse)]:h-9 gap-1 text-xs text-[var(--chart-red)]"
              onClick={() => {
                setStopDelete(false);
                setStopOpen(true);
              }}
            >
              <Pause className="h-3.5 w-3.5" /> หยุดทำซ้ำ
            </Button>
          )}
        </div>
      )}

      <AlertDialog open={skipOpen} onOpenChange={setSkipOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ข้ามรอบที่ {rec.occurrence}?</AlertDialogTitle>
            <AlertDialogDescription>
              รอบนี้จะถูกลบและไม่หักคะแนน แล้วรอบถัดไปจะขึ้นบอร์ดทันที (ไม่รอถึงวันขึ้นบอร์ด)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const nextId = skipRound(task.id, actorId);
                toast.success(nextId ? "ข้ามรอบนี้แล้ว · รอบถัดไปขึ้นบอร์ดแล้ว" : "ข้ามรอบนี้แล้ว · ไม่มีรอบถัดไป");
                onLeave();
              }}
            >
              ข้ามรอบนี้
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={stopOpen} onOpenChange={setStopOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>หยุดทำซ้ำ</AlertDialogTitle>
            <AlertDialogDescription>ประวัติรอบก่อน ๆ และคะแนนที่หักไปแล้วยังอยู่เหมือนเดิม</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            {[
              { del: false, title: "หยุดหลังรอบนี้", sub: "รอบนี้ยังต้องส่งตามปกติ ไม่สร้างรอบใหม่อีก" },
              { del: true, title: "ลบรอบนี้และหยุดทำซ้ำ", sub: "รอบนี้ไม่ต้องส่ง ไม่โดนหัก" },
            ].map((o) => (
              <label
                key={String(o.del)}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2",
                  stopDelete === o.del ? "border-[var(--brand-green)] bg-[var(--accent)]" : "border-[var(--line)]"
                )}
              >
                <input type="radio" name="stop-mode" checked={stopDelete === o.del} onChange={() => setStopDelete(o.del)} className="mt-1 h-4 w-4 accent-[var(--brand-green)]" />
                <span>
                  <span className="block text-sm font-semibold">{o.title}</span>
                  <span className="text-xs text-[var(--ink-soft)]">{o.sub}</span>
                </span>
              </label>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--chart-red)] text-white hover:bg-red-700"
              onClick={() => {
                stopRecurrence(task.id, stopDelete, actorId);
                toast.success(stopDelete ? "ลบรอบนี้และหยุดทำซ้ำแล้ว" : "หยุดทำซ้ำแล้ว");
                if (stopDelete) onLeave();
              }}
            >
              ยืนยัน
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>แก้การทำซ้ำ</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--ink-soft)]">
                เปลี่ยนตารางทั้งชุด มีผลตั้งแต่รอบถัดไป · อยากเลื่อนแค่บางรอบ กดที่วันที่ของรอบนั้นในรายการรอบแทน
              </p>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                <RecurrenceFields rule={draft} onChange={setDraft} />
                <RecurrencePreview rule={draftRule ?? draft} dueTime={task.dueTime} fromOccurrence={lrec.occurrence + 1} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              ยกเลิก
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!draft) return;
                const err = validateRule(draftRule ?? draft);
                if (err) {
                  toast.error(err);
                  return;
                }
                updateRecurrence(task.id, draftRule ?? draft, actorId);
                toast.success("บันทึกการทำซ้ำแล้ว");
                setEditOpen(false);
              }}
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
