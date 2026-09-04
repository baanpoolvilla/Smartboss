"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/modules/report_task/components/ui/dialog";
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
import { Input } from "@/modules/report_task/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { getUser } from "@/modules/report_task/lib/directory";
import { usePracticeStore, practiceUsers } from "@/modules/report_task/store/practice-store";
import { usePracticeMissionStore } from "@/modules/report_task/store/practice-mission-store";
import { statusMeta, priorityMeta } from "@/modules/report_task/lib/task-meta";
import { cn } from "@/modules/report_task/lib/utils";
import type { TaskPriority, TaskStatus } from "@/modules/report_task/types";
import { Send } from "lucide-react";

const statusOrder: TaskStatus[] = ["todo", "in_progress", "done"];
const priorityOrder: TaskPriority[] = ["low", "medium", "high", "critical"];

/**
 * One dialog, two modes: creating a new practice task (taskId is null) or
 * viewing/editing an existing one — same as most real dialogs in this app
 * (e.g. new-task-dialog.tsx) rather than two near-duplicate components.
 */
export function PracticeTaskDialog({
  open,
  onOpenChange,
  taskId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string | null;
}) {
  const tasks = usePracticeStore((s) => s.tasks);
  const addTask = usePracticeStore((s) => s.addTask);
  const moveTask = usePracticeStore((s) => s.moveTask);
  const setAssignees = usePracticeStore((s) => s.setAssignees);
  const addComment = usePracticeStore((s) => s.addComment);
  const completeMission = usePracticeMissionStore((s) => s.complete);

  const task = taskId ? tasks.find((t) => t.id === taskId) : undefined;
  const isCreate = !task;

  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [comment, setComment] = useState("");

  // Reset the create form fresh every time the dialog re-opens — adjusted
  // during render (not an effect) per React's guidance for resetting state
  // on a prop/derived-value change, same pattern used in settings/page.tsx.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && isCreate) {
      setTitle("");
      setPriority("medium");
      setAssigneeId("");
    }
  }

  function handleCreate() {
    if (!title.trim()) return;
    addTask({ title: title.trim(), priority, assigneeIds: assigneeId ? [assigneeId] : [] });
    completeMission("create-task");
    onOpenChange(false);
  }

  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  function requestClose(nextOpen: boolean) {
    if (!nextOpen && isCreate && title.trim() !== "") {
      setConfirmDiscardOpen(true);
      return;
    }
    onOpenChange(nextOpen);
  }

  function handleAssign(id: string) {
    if (!task) return;
    setAssignees(task.id, [id]);
    completeMission("assign-member");
  }

  function handleStatus(status: TaskStatus) {
    if (!task) return;
    moveTask(task.id, status);
    completeMission("change-status");
    if (status === "done") completeMission("complete-task");
  }

  function handleComment() {
    if (!task || !comment.trim()) return;
    addComment(task.id, "usr-01", comment.trim());
    completeMission("add-comment");
    setComment("");
  }

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isCreate ? "สร้างงานใหม่" : task!.title}</DialogTitle>
        </DialogHeader>

        {isCreate ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-[var(--ink-soft)]">ชื่องาน</label>
              <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น ออกแบบโลโก้ใหม่" onKeyDown={(e) => e.key === "Enter" && handleCreate()} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--ink-soft)]">ความสำคัญ</label>
                <Select value={priority} onValueChange={(v) => v && setPriority(v as TaskPriority)}>
                  <SelectTrigger className="w-full"><SelectValue>{priorityMeta[priority].label}</SelectValue></SelectTrigger>
                  <SelectContent>
                    {priorityOrder.map((p) => (
                      <SelectItem key={p} value={p}>{priorityMeta[p].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--ink-soft)]">ผู้รับผิดชอบ</label>
                <Select value={assigneeId} onValueChange={(v) => v && setAssigneeId(v)}>
                  <SelectTrigger className="w-full"><SelectValue>{assigneeId ? getUser(assigneeId)?.name : "เลือกคน..."}</SelectValue></SelectTrigger>
                  <SelectContent>
                    {practiceUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-[var(--ink-soft)]">สถานะ</label>
              <div className="grid grid-cols-3 gap-1.5">
                {statusOrder.map((s) => {
                  const meta = statusMeta[s];
                  const active = task!.status === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleStatus(s)}
                      className={cn(
                        "flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                        active ? "border-[var(--brand-green)] bg-[var(--accent)] text-[var(--brand-green-dark)]" : "border-[var(--line)] hover:bg-[var(--bg-soft)]"
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-[var(--ink-soft)]">ผู้รับผิดชอบ</label>
              <Select value={task!.assigneeIds[0] ?? ""} onValueChange={(v) => v && handleAssign(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{task!.assigneeIds[0] ? getUser(task!.assigneeIds[0])?.name : "ยังไม่มีผู้รับผิดชอบ"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {practiceUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-[var(--ink-soft)]">ความคิดเห็น ({task!.comments.length})</label>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {task!.comments.map((c) => {
                  const author = getUser(c.authorId);
                  return (
                    <div key={c.id} className="flex items-start gap-2">
                      <Avatar className="h-6 w-6 shrink-0">
                        <AvatarImage src={author?.avatarUrl ?? undefined} alt={author?.name} />
                        <AvatarFallback className="text-[9px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{author?.avatar}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1 rounded-lg bg-[var(--bg-soft)] px-2.5 py-1.5">
                        <p className="text-xs font-medium">{author?.name}</p>
                        <p className="text-xs text-[var(--ink-soft)]">{c.message}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="แสดงความคิดเห็น..."
                  onKeyDown={(e) => e.key === "Enter" && handleComment()}
                />
                <Button variant="outline" size="icon" onClick={handleComment} aria-label="ส่งความคิดเห็น">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {isCreate && (
          <DialogFooter>
            <Button variant="outline" onClick={() => requestClose(false)}>ยกเลิก</Button>
            <Button disabled={!title.trim()} onClick={handleCreate}>สร้างงาน</Button>
          </DialogFooter>
        )}
      </DialogContent>

      <AlertDialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ทิ้งข้อมูลที่กรอกไว้?</AlertDialogTitle>
            <AlertDialogDescription>ยังไม่ได้บันทึก ถ้าปิดตอนนี้ข้อมูลที่กรอกไว้จะหายไป</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>กรอกต่อ</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--chart-red)] hover:bg-red-700 text-white"
              onClick={() => {
                setConfirmDiscardOpen(false);
                onOpenChange(false);
              }}
            >
              ทิ้งข้อมูล
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
