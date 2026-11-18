"use client";

import { Check, ListTodo } from "lucide-react";
import { getUser } from "@/modules/report_task/lib/directory";
import { canToggleOwnChecklistItem } from "@/modules/report_task/lib/permissions";
import { completedAssigneeIdsOf, isSharedItem } from "@/modules/report_task/lib/task-completion";
import { cn } from "@/modules/report_task/lib/utils";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";

/**
 * กดงานบนไทม์ไลน์แล้วทำงานต่อได้เลย — รายละเอียด + เช็คลิสต์ที่ติ๊กได้ ไม่ต้องกดเปิดใบงาน
 * (ผู้ใช้ 18/11/2569 "กดที่งานแล้วแสดงรายละเอียดงานที่สามารถทำงานต่อได้เลย")
 *
 * ติ๊กผ่าน store ตัวเดียวกับหน้างานเต็ม (toggleChecklistItem / toggleAssigneeChecklist) และใช้กติกาเดียวกัน
 * ว่าใครติ๊กได้ (canToggleOwnChecklistItem) ⇒ คะแนน แจ้งเตือน ปิดงานอัตโนมัติ เหมือนติ๊กในหน้างานทุกอย่าง
 * ความคิดเห็น ไฟล์ เพิ่ม/ลบรายการ ยังอยู่ในหน้างานเต็ม (ปุ่ม "เปิดงาน" ฝั่งซ้ายเหมือนเดิม)
 */
export function TimelineTaskWork({ taskId }: { taskId: string }) {
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === taskId));
  const toggleChecklistItem = useTaskStore((s) => s.toggleChecklistItem);
  const toggleAssigneeChecklist = useTaskStore((s) => s.toggleAssigneeChecklist);
  const me = useIdentityStore((s) => s.viewingAsUserId);
  if (!task) return null;

  const group = task.taskMode === "group";
  const everyoneShares = task.completionRule === "shared";
  const done = task.checklist.filter((c) => c.done).length;
  const total = task.checklist.length;
  const doneIds = completedAssigneeIdsOf(task);
  // ข้อช่วยกันทำขึ้นก่อน แล้วไล่ตามคน (ลำดับเดียวกับหน้างาน)
  const items = [...task.checklist].sort((a, b) => Number(isSharedItem(b)) - Number(isSharedItem(a)));
  // งานกลุ่ม: คนที่ไม่มีข้อของตัวเองและไม่มีข้อช่วยกันทำ ติ๊ก "ส่วนของฉันเสร็จ" เอง (เหมือนหน้างาน)
  const noItemOwners =
    group && !everyoneShares && !task.checklist.some(isSharedItem)
      ? task.assigneeIds.filter((uid) => !task.checklist.some((c) => c.ownerId === uid))
      : [];

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3.5" data-testid="timeline-task-work">
      <div>
        <h4 className="m-0 mb-1 text-xs font-semibold text-[var(--ink-soft)]">รายละเอียดงาน</h4>
        {task.description.trim() ? (
          <p className="m-0 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm text-[var(--ink)]">{task.description}</p>
        ) : (
          <p className="m-0 text-sm text-[var(--ink-soft)]">ไม่มีรายละเอียด</p>
        )}
      </div>

      <div className="min-w-0">
        <div className="mb-1.5 flex items-center gap-2">
          <h4 className="m-0 flex items-center gap-1.5 text-sm font-semibold">
            <ListTodo className="h-4 w-4" aria-hidden /> เช็คลิสต์
          </h4>
          {total > 0 && (
            <>
              <span className="text-xs text-[var(--ink-soft)] tabular-nums">
                เสร็จ {done} จาก {total} ข้อ
              </span>
              <span className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-[var(--bg-soft)]" aria-hidden>
                <span className="block h-full rounded-full bg-[var(--chart-green)]" style={{ width: `${(done / total) * 100}%` }} />
              </span>
            </>
          )}
        </div>
        {total === 0 && noItemOwners.length === 0 ? (
          <p className="m-0 text-sm text-[var(--ink-soft)]">งานนี้ไม่มีเช็คลิสต์ · เพิ่มได้ในหน้างาน</p>
        ) : (
          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {items.map((c) => {
              const canToggle = canToggleOwnChecklistItem(c, me, task);
              const shared = everyoneShares || isSharedItem(c);
              const ownerName = group && !shared ? getUser(c.ownerId ?? task.assigneeIds[0] ?? "")?.name : undefined;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => canToggle && toggleChecklistItem(task.id, c.id)}
                  disabled={!canToggle}
                  aria-pressed={c.done}
                  title={!canToggle ? (shared ? "ติ๊กได้เฉพาะคนในงานนี้" : "ติ๊กได้เฉพาะเจ้าของรายการนี้") : undefined}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-sm",
                    canToggle ? "hover:bg-[var(--bg-soft)]" : "cursor-not-allowed",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      c.done ? "border-[var(--chart-green)] bg-[var(--chart-green)]" : "border-[var(--line)]",
                      !canToggle && "opacity-50",
                    )}
                    aria-hidden
                  >
                    {c.done && <Check className="h-3 w-3 text-white" />}
                  </span>
                  <span className={cn("min-w-0 flex-1 break-words", c.done && "text-[var(--ink-soft)] line-through")}>{c.text}</span>
                  {group && shared && !everyoneShares && (
                    <span className="mt-0.5 shrink-0 rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[10px] text-[var(--ink-soft)]">ช่วยกันทำ</span>
                  )}
                  {ownerName && (
                    <span className="mt-0.5 max-w-[8rem] shrink-0 truncate rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[11px] text-[var(--ink-soft)]" title={ownerName}>
                      {ownerName}
                    </span>
                  )}
                </button>
              );
            })}
            {noItemOwners.map((uid) => {
              const mine = uid === me;
              const partDone = doneIds.includes(uid);
              return (
                <button
                  key={uid}
                  type="button"
                  onClick={() => mine && toggleAssigneeChecklist(task.id, uid)}
                  disabled={!mine}
                  aria-pressed={partDone}
                  title={!mine ? "ติ๊กได้เฉพาะเจ้าของส่วนนี้" : undefined}
                  className={cn("flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm", mine ? "hover:bg-[var(--bg-soft)]" : "cursor-not-allowed")}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      partDone ? "border-[var(--chart-green)] bg-[var(--chart-green)]" : "border-[var(--line)]",
                      !mine && "opacity-50",
                    )}
                    aria-hidden
                  >
                    {partDone && <Check className="h-3 w-3 text-white" />}
                  </span>
                  <span className="min-w-0 flex-1 text-[var(--ink-soft)]">
                    {partDone ? "ส่วนนี้เสร็จแล้ว" : mine ? "ไม่มีรายการ — ติ๊กเมื่อทำส่วนของคุณเสร็จ" : "ไม่มีรายการ · ยังไม่เสร็จ"}
                  </span>
                  <span className="max-w-[8rem] shrink-0 truncate rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[11px] text-[var(--ink-soft)]">{getUser(uid)?.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
