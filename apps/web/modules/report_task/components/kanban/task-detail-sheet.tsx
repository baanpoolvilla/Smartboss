"use client";

import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/modules/report_task/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/modules/report_task/components/ui/alert-dialog";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Separator } from "@/modules/report_task/components/ui/separator";
import { Button } from "@/modules/report_task/components/ui/button";
import { Textarea } from "@/modules/report_task/components/ui/textarea";
import { Input } from "@/modules/report_task/components/ui/input";
import { Label } from "@/modules/report_task/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/report_task/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/modules/report_task/components/ui/tooltip";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { PenaltyChip } from "@/modules/report_task/components/shared/penalty-chip";
import { canEditRecord, canRemoveReaction, canSeePenaltyStatus, canToggleOwnChecklistItem } from "@/modules/report_task/lib/permissions";
import { todayIso } from "@/modules/report_task/lib/now";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useStickerStore } from "@/modules/report_task/store/sticker-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { getUser, getDepartment, users, canManage, isOwner, departmentIdsOf } from "@/modules/report_task/lib/directory";
import { statusMeta, priorityMeta, taskStatusOrder, taskPriorityOrder } from "@/modules/report_task/lib/task-meta";
import { formatDate, formatDateTime, relativeTime } from "@/modules/report_task/lib/format";
import { cn } from "@/modules/report_task/lib/utils";
import {
  Calendar,
  Paperclip,
  History,
  Send,
  FileText,
  Building2,
  X,
  Check,
  UserPlus,
  Plus,
  Trash2,
  ListTodo,
  Loader2,
} from "lucide-react";
import type { Attachment, Sticker, TaskPriority, TaskStatus } from "@/modules/report_task/types";
import { showStickerToast } from "@/modules/report_task/lib/sticker-toast";
import { StickerConfirmDialog } from "@/modules/report_task/components/shared/sticker-confirm-dialog";
import { uploadTaskAttachment } from "@/modules/report_task/lib/task-attachment-upload";
import { useAttachmentSettingsStore } from "@/modules/report_task/store/attachment-settings-store";
import { toast } from "sonner";

const toDateInput = (iso: string) => iso.slice(0, 10);

/** Highlight @mentions inside a comment so tagged people stand out. */
function renderMentions(text: string) {
  return text.split(/(@\S+)/g).map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} className="font-medium text-[var(--brand-green-dark)]">{part}</span>
    ) : (
      part
    )
  );
}

export function TaskDetailSheet({
  taskId,
  onOpenChange,
}: {
  taskId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === taskId));
  const moveTask = useTaskStore((s) => s.moveTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const removeTask = useTaskStore((s) => s.removeTask);
  const setAssignees = useTaskStore((s) => s.setAssignees);
  const reviseDueDate = useTaskStore((s) => s.reviseDueDate);
  const reviseAssigneeDueDate = useTaskStore((s) => s.reviseAssigneeDueDate);
  const addComment = useTaskStore((s) => s.addComment);
  const removeComment = useTaskStore((s) => s.removeComment);
  const addAttachment = useTaskStore((s) => s.addAttachment);
  const removeAttachment = useTaskStore((s) => s.removeAttachment);
  const addChecklistItem = useTaskStore((s) => s.addChecklistItem);
  const toggleChecklistItem = useTaskStore((s) => s.toggleChecklistItem);
  const removeChecklistItem = useTaskStore((s) => s.removeChecklistItem);
  const addReaction = useTaskStore((s) => s.addReaction);
  const removeReaction = useTaskStore((s) => s.removeReaction);
  const stickers = useStickerStore((s) => s.stickers);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const attachmentSettings = useAttachmentSettingsStore((s) => s.settings);

  const [comment, setComment] = useState("");
  const [commentAttachments, setCommentAttachments] = useState<Attachment[]>([]);
  const [commentUploading, setCommentUploading] = useState(false);
  const [taskAttachUploading, setTaskAttachUploading] = useState(false);
  const taskFileInputRef = useRef<HTMLInputElement>(null);
  const commentFileInputRef = useRef<HTMLInputElement>(null);
  const [newChecklistItem, setNewChecklistItem] = useState("");
  const [newChecklistOwnerId, setNewChecklistOwnerId] = useState("");
  // Per-assignee due-date edits are staged locally and only commit (see
  // reviseAssigneeDueDate) once the row's confirm button is clicked — picking
  // a date alone doesn't change anything yet, so a stray click can't silently
  // revise someone's date and notify them.
  const [stagedAssigneeDates, setStagedAssigneeDates] = useState<Record<string, string>>({});
  const [revising, setRevising] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [reason, setReason] = useState("");
  // Collapsed by default — a task can end up with a large co-assignee list,
  // and rendering every chip would blow up the sheet's height. Reset during
  // render (not an effect) when the task being viewed changes — the standard
  // "adjusting state on prop change" pattern.
  const [assigneesExpanded, setAssigneesExpanded] = useState(false);
  // Title/description are staged locally and only reach the store when
  // "บันทึก" is clicked — same reset-on-task-switch pattern as
  // assigneesExpanded above, so switching tasks can't leak one task's
  // unsaved draft into another's fields.
  const [draftTitle, setDraftTitle] = useState(task?.title ?? "");
  const [draftDescription, setDraftDescription] = useState(task?.description ?? "");
  const [lastTaskId, setLastTaskId] = useState(task?.id);
  const [pendingSticker, setPendingSticker] = useState<Sticker | null>(null);
  if (task?.id !== lastTaskId) {
    setLastTaskId(task?.id);
    setAssigneesExpanded(false);
    setDraftTitle(task?.title ?? "");
    setDraftDescription(task?.description ?? "");
    setNewChecklistOwnerId(task?.assigneeIds[0] ?? "");
    setStagedAssigneeDates({});
  }

  if (!task) return null;

  const mainFieldsDirty = draftTitle !== task.title || draftDescription !== task.description;
  function saveMainFields() {
    if (!task) return;
    updateTask(task.id, { title: draftTitle.trim() || task.title, description: draftDescription });
    toast.success("บันทึกการแก้ไขแล้ว");
  }
  const assignees = task.assigneeIds.map(getUser).filter(Boolean);
  // A group task tracks each assignee's own completion separately, derived
  // from their own checklist items (see task-completion.ts) — show it
  // explicitly here so anyone opening the task, including someone who isn't
  // an assignee (a lead or the CEO), can see exactly who's done and who
  // isn't without having to ask.
  const isShared = task.taskMode === "group";
  const iAmAssignee = task.assigneeIds.includes(viewingAsUserId);
  const completedCount = task.completedAssigneeIds?.length ?? 0;
  const assignedBy = getUser(task.assignedById);
  const departmentNames = task.departmentIds.map((id) => getDepartment(id)?.name).filter(Boolean);
  // Only the person who assigned/created the task, or a department head over
  // it, can edit its core definition (title, description, priority,
  // assignees, dates). Everyone else can still execute it: status,
  // checklist, comments, attachments, reactions.
  const canEditMain = canEditRecord(task.assignedById, task.departmentIds, viewingAsUserId);
  const lockedTitle = "แก้ไขได้เฉพาะผู้สร้างงาน";
  // canEditMain (and canSeeTask/canDockPenalty) fall back to the viewer's own
  // department-head match once they're no longer the assigner — a non-owner
  // reassigning "มอบหมายโดย" away from themselves, or removing the last
  // teammate from their own department, can silently vote themselves out of
  // a task with no way back short of the owner or the new assignee handing
  // it back. Only checked for non-owners; the owner can always edit/see it.
  const owner = isOwner(viewingAsUserId);
  const reassigningWouldLockMeOut = (nextAssignedById: string) =>
    !owner && !canEditRecord(nextAssignedById, task.departmentIds, viewingAsUserId);
  const removingAssigneeWouldLockMeOut = (nextAssigneeIds: string[]) =>
    !owner && !canEditRecord(task.assignedById, departmentIdsOf(nextAssigneeIds), viewingAsUserId);
  // "หัวร้อน" is a reprimand, not peer feedback — only the department head
  // can hand it out. Other stickers stay open to everyone.
  const pickableStickers = canManage(viewingAsUserId) ? stickers : stickers.filter((s) => s.id !== "angry");

  function confirmDelete() {
    if (!task) return;
    onOpenChange(false);
    removeTask(task.id);
    toast.success(`ลบงาน "${task.title}" แล้ว`);
  }

  function toggleAssignee(userId: string) {
    if (!task) return;
    const next = task.assigneeIds.includes(userId)
      ? task.assigneeIds.filter((id) => id !== userId)
      : [...task.assigneeIds, userId];
    if (next.length === 0) return; // keep at least one
    if (removingAssigneeWouldLockMeOut(next)) return;
    setAssignees(task.id, next);
  }

  // Planner behaviour: Enter adds the item and keeps the field ready for the next.
  function commitChecklistItem(ownerId: string) {
    if (!task || !newChecklistItem.trim() || !ownerId) return;
    addChecklistItem(task.id, newChecklistItem.trim(), ownerId);
    setNewChecklistItem("");
  }

  /** Real upload (mirrors the comment-attachment flow below) — replaced the
   * old mock that just faked a "1.2 MB PDF" without ever touching the server. */
  async function handleTaskFilesSelected(files: FileList | null) {
    if (!task || !files || files.length === 0) return;
    const remaining = attachmentSettings.maxFilesPerTask - task.attachments.length;
    if (remaining <= 0) {
      toast.error(`แนบไฟล์ได้สูงสุด ${attachmentSettings.maxFilesPerTask} ไฟล์ต่องาน`);
      return;
    }
    const picked = Array.from(files).slice(0, remaining);
    if (picked.length < files.length) {
      toast.error(`แนบได้อีกแค่ ${remaining} ไฟล์ (จำกัด ${attachmentSettings.maxFilesPerTask} ไฟล์ต่องาน)`);
    }
    setTaskAttachUploading(true);
    for (const file of picked) {
      try {
        const att = await uploadTaskAttachment(file, viewingAsUserId);
        addAttachment(task.id, att);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "อัปโหลดไฟล์ไม่สำเร็จ");
      }
    }
    setTaskAttachUploading(false);
  }

  function submitRevision() {
    // Re-checked here, not just at the button that opens this form — the
    // form can outlive the permission that opened it (e.g. the viewer
    // switches identity mid-edit without closing the sheet), and a hidden
    // button alone doesn't stop a submit that's already on screen.
    if (!newDate || !reason.trim() || !task || !canEditMain) return;
    reviseDueDate(task.id, new Date(newDate).toISOString(), reason.trim(), viewingAsUserId);
    setRevising(false);
    setNewDate("");
    setReason("");
  }

  function submitComment() {
    if ((!comment.trim() && commentAttachments.length === 0) || !task) return;
    addComment(task.id, comment.trim(), viewingAsUserId, commentAttachments);
    setComment("");
    setCommentAttachments([]);
  }

  async function handleCommentFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const remaining = attachmentSettings.maxFilesPerComment - commentAttachments.length;
    if (remaining <= 0) {
      toast.error(`แนบไฟล์ได้สูงสุด ${attachmentSettings.maxFilesPerComment} ไฟล์ต่อความคิดเห็น`);
      return;
    }
    const picked = Array.from(files).slice(0, remaining);
    if (picked.length < files.length) {
      toast.error(`แนบได้อีกแค่ ${remaining} ไฟล์ (จำกัด ${attachmentSettings.maxFilesPerComment} ไฟล์ต่อความคิดเห็น)`);
    }
    setCommentUploading(true);
    for (const file of picked) {
      try {
        const att = await uploadTaskAttachment(file, viewingAsUserId);
        setCommentAttachments((prev) => [...prev, att]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "อัปโหลดไฟล์ไม่สำเร็จ");
      }
    }
    setCommentUploading(false);
  }

  function removeCommentAttachment(id: string) {
    setCommentAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function handleReact(sticker: Sticker) {
    if (!task) return;
    setPendingSticker(sticker);
  }

  function confirmSticker() {
    if (!task || !pendingSticker) return;
    addReaction(task.id, pendingSticker.id, viewingAsUserId);
    showStickerToast(pendingSticker, task.title);
    setPendingSticker(null);
  }

  return (
    <>
    <Dialog open={!!taskId} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-5xl h-[88vh] max-h-[88vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="border-b border-[var(--line)] px-6 py-4 space-y-2 shrink-0">
          {/* pr-10 keeps this row clear of the dialog's own absolute close (X)
              button, which otherwise overlaps the delete button here. */}
          <div className="flex items-center gap-2 pr-10">
            <Badge variant="outline" className={cn("text-[10px]", priorityMeta[task.priority].badgeClass)}>
              {priorityMeta[task.priority].label}
            </Badge>
            <span className="text-xs text-[var(--ink-soft)]">{task.id}</span>
            <Badge variant="secondary" className="text-[10px] ml-auto">
              {canEditMain ? "แก้ไขได้" : `สร้างโดย ${assignedBy?.name ?? "—"}`}
            </Badge>
            {canEditMain && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-[var(--ink-soft)] hover:bg-red-50 hover:text-[var(--chart-red)]"
                title="ลบงาน"
                aria-label="ลบงาน"
                onClick={() => setConfirmDeleteOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <DialogTitle className="sr-only">{task.title}</DialogTitle>
          {/* Editable title (creator only) — staged in draftTitle, see saveMainFields */}
          <Input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            disabled={!canEditMain}
            title={!canEditMain ? lockedTitle : undefined}
            className="text-lg font-semibold border-0 border-b border-transparent hover:border-[var(--line)] focus-visible:border-[var(--brand-green)] rounded-none px-0 shadow-none focus-visible:ring-0 disabled:opacity-100 disabled:cursor-default"
          />
        </DialogHeader>

        {/* Two-pane body, MS-Planner-style: task details on the left, a
            persistent comments/chat rail on the right — stacked on small
            screens since there's no room for two columns there. */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 min-w-0 min-h-0">
          {/* Editable description (creator only) — staged in draftDescription */}
          <div className="space-y-1">
            <Label className="text-xs text-[var(--ink-soft)]">รายละเอียด</Label>
            <Textarea
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              rows={3}
              placeholder="เพิ่มรายละเอียดงาน..."
              className="resize-none disabled:opacity-100 disabled:cursor-default"
              disabled={!canEditMain}
              title={!canEditMain ? lockedTitle : undefined}
            />
            {canEditMain && mainFieldsDirty && (
              <div className="flex items-center justify-end gap-2 pt-0.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraftTitle(task.title);
                    setDraftDescription(task.description);
                  }}
                >
                  ยกเลิก
                </Button>
                <Button size="sm" className="bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white" onClick={saveMainFields}>
                  บันทึกชื่อ/รายละเอียด
                </Button>
              </div>
            )}
          </div>

          {/* A group task's completion is derived from each person's own
              checklist section below — no separate manual toggle here
              anymore, the checklist itself is the completion surface. */}
          {isShared && iAmAssignee && (
            <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] p-3">
              <p className="text-xs font-medium text-[var(--ink-soft)]">
                {completedCount}/{task.assigneeIds.length} คนเสร็จแล้ว — ติ๊กเช็คลิสต์ของคุณให้ครบด้านล่างเพื่อปิดส่วนของคุณ
              </p>
            </div>
          )}

          {/* Status + priority */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--ink-soft)]">สถานะ</Label>
              {/* A shared task's "เสร็จสิ้น" is only ever reached automatically
                  once every assignee marks their own part done (see the
                  ผู้รับผิดชอบ list above) — letting this dropdown set/unset
                  "done" directly on a shared task bypassed that and could
                  leave completedAssigneeIds and status disagreeing (e.g.
                  everyone marked done but the status got forced back to
                  "กำลังทำ" here, without going through the "เปิดงานใหม่"
                  correction flow that actually resets who's done). So for a
                  shared task: "done" isn't a selectable option here, and once
                  it IS done, the dropdown locks — "เปิดงานใหม่" is the only
                  sanctioned way out. */}
              <Select
                value={task.status}
                onValueChange={(v) => v && moveTask(task.id, v as TaskStatus)}
                disabled={isShared && task.status === "done"}
              >
                <SelectTrigger className="w-full" title={isShared && task.status === "done" ? "งานนี้มีผู้รับผิดชอบหลายคน — กด \"เปิดงานใหม่\" ด้านบนเพื่อแก้ไขแทน" : undefined}>
                  <SelectValue>
                    <span className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", statusMeta[task.status]?.dot)} />
                      {statusMeta[task.status]?.label}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {taskStatusOrder
                    .filter((s) => !isShared || s !== "done")
                    .map((s) => (
                      <SelectItem key={s} value={s}>
                        <span className="flex items-center gap-2">
                          <span className={cn("h-2 w-2 rounded-full", statusMeta[s].dot)} />
                          {statusMeta[s].label}
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {isShared && (
                <p className="text-[10px] text-[var(--ink-soft)]">
                  งานนี้ปิดอัตโนมัติเมื่อทุกคนมาร์คเสร็จในรายชื่อผู้รับผิดชอบด้านบน
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--ink-soft)]">ความสำคัญ</Label>
              <Select
                value={task.priority}
                onValueChange={(v) => v && updateTask(task.id, { priority: v as TaskPriority })}
                disabled={!canEditMain}
              >
                <SelectTrigger className="w-full" title={!canEditMain ? lockedTitle : undefined}>
                  <SelectValue>{priorityMeta[task.priority]?.label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {taskPriorityOrder.map((p) => (
                    <SelectItem key={p} value={p}>{priorityMeta[p].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Assignees (add / remove — creator only) */}
          <div className="space-y-1.5">
            <Label className="text-xs text-[var(--ink-soft)]">ผู้รับผิดชอบ ({assignees.length})</Label>
            <div className="flex flex-wrap gap-1.5 items-center">
              {(() => {
                const ASSIGNEES_COLLAPSED_COUNT = 10;
                const visible = assigneesExpanded ? assignees : assignees.slice(0, ASSIGNEES_COLLAPSED_COUNT);
                const hiddenCount = assignees.length - visible.length;
                return (
                  <>
                    {visible.map((a) => {
                      const done = isShared && (task.completedAssigneeIds ?? []).includes(a!.id);
                      const isMe = a!.id === viewingAsUserId;
                      return (
                        <span
                          key={a!.id}
                          className={cn(
                            "flex items-center gap-1.5 rounded-full pl-0.5 pr-1 py-0.5 group",
                            isShared ? (done ? "bg-green-50" : "bg-[var(--bg-soft)]") : "bg-[var(--bg-soft)]"
                          )}
                        >
                          <div className="relative shrink-0">
                            <Avatar className="h-5 w-5">
                              <AvatarFallback className="text-[9px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{a!.avatar}</AvatarFallback>
                            </Avatar>
                            {done && (
                              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[var(--brand-green)] ring-2 ring-white flex items-center justify-center">
                                <Check className="h-1.5 w-1.5 text-white" strokeWidth={4} />
                              </span>
                            )}
                          </div>
                          <span className="text-xs truncate max-w-[100px]">{a!.name}</span>
                          {/* Read-only here — marking YOUR OWN part done lives in the
                              dedicated "ส่วนของฉัน" field above, not here, so there's
                              one obvious place to do it instead of two. */}
                          {isShared && (
                            <span className={cn("text-[10px] shrink-0", done ? "text-[var(--brand-green-dark)] font-medium" : "text-[var(--ink-soft)]")}>
                              {isMe && done ? "ฉันเสร็จแล้ว" : isMe ? "ฉันยังไม่เสร็จ" : done ? "เสร็จแล้ว" : "ยังไม่เสร็จ"}
                            </span>
                          )}
                          {canEditMain && (() => {
                            const isLastAssignee = assignees.length === 1;
                            const locked = !isLastAssignee && removingAssigneeWouldLockMeOut(assignees.filter((x) => x!.id !== a!.id).map((x) => x!.id));
                            const blocked = isLastAssignee || locked;
                            return (
                              <button
                                onClick={() => !blocked && toggleAssignee(a!.id)}
                                disabled={blocked}
                                className={cn("px-0.5", blocked ? "text-[var(--ink-soft)] opacity-40 cursor-not-allowed" : "text-[var(--ink-soft)] hover:text-[var(--chart-red)]")}
                                aria-label={`นำ ${a!.name} ออกจากผู้รับผิดชอบ`}
                                title={
                                  isLastAssignee
                                    ? "นำออกไม่ได้ — งานต้องมีผู้รับผิดชอบอย่างน้อย 1 คน"
                                    : locked
                                      ? "นำออกไม่ได้ — จะทำให้คุณแก้/เห็นงานนี้เองไม่ได้อีก"
                                      : undefined
                                }
                              >
                                <X className="h-3 w-3" />
                              </button>
                            );
                          })()}
                        </span>
                      );
                    })}
                    {(hiddenCount > 0 || assigneesExpanded) && assignees.length > ASSIGNEES_COLLAPSED_COUNT && (
                      <button
                        onClick={() => setAssigneesExpanded((v) => !v)}
                        className="text-xs font-medium text-[var(--brand-green-dark)] hover:underline px-1"
                      >
                        {assigneesExpanded ? "ย่อกลับ" : `+${hiddenCount} คน`}
                      </button>
                    )}
                  </>
                );
              })()}
              {canEditMain && (
              <Popover>
                <PopoverTrigger
                  render={
                    <button className="flex items-center gap-1 rounded-full border border-dashed border-[var(--line)] px-2 py-1 text-xs text-[var(--ink-soft)] hover:border-[var(--brand-green)] hover:text-[var(--brand-green-dark)]">
                      <UserPlus className="h-3.5 w-3.5" /> เพิ่มคน
                    </button>
                  }
                />
                <PopoverContent align="start" className="w-64 p-1 max-h-64 overflow-y-auto">
                  {users.map((u) => {
                    const selected = task.assigneeIds.includes(u.id);
                    return (
                      <button
                        key={u.id}
                        onClick={() => toggleAssignee(u.id)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-soft)] text-left"
                      >
                        <span className={cn("h-4 w-4 rounded border flex items-center justify-center shrink-0", selected ? "bg-[var(--brand-green)] border-[var(--brand-green)]" : "border-[var(--line)]")}>
                          {selected && <Check className="h-3 w-3 text-white" />}
                        </span>
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="text-[9px] bg-[var(--bg-soft)]">{u.avatar}</AvatarFallback>
                        </Avatar>
                        <span className="flex-1 text-sm truncate">{u.name}</span>
                        <span className="text-[10px] text-[var(--ink-soft)] shrink-0">{getDepartment(u.departmentId)?.name}</span>
                      </button>
                    );
                  })}
                </PopoverContent>
              </Popover>
              )}
            </div>
          </div>

          {/* Assigned by (editable, single) + departments (auto) */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-lg px-3 py-2">
            <span className="flex items-center gap-1.5">
              มอบหมายโดย
              {/* Reassigning "created by" changes who canEditRecord/canSeeTask
                  treat as the owner going forward — letting a plain creator
                  (not a manager) hand that off arbitrarily could lock them
                  out of their own task or spoof authorship, so only a
                  manager gets the picker; a plain creator sees it read-only. */}
              {canManage(viewingAsUserId) ? (
                <Popover>
                  <PopoverTrigger
                    render={
                      <button className="flex items-center gap-1.5 rounded-full bg-white border border-[var(--line)] pl-0.5 pr-2 py-0.5 hover:border-[var(--brand-green)]">
                        <Avatar className="h-5 w-5">
                          <AvatarFallback className="text-[8px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{assignedBy?.avatar}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-[var(--ink)]">{assignedBy?.name}</span>
                      </button>
                    }
                  />
                  <PopoverContent align="start" className="w-60 p-1 max-h-64 overflow-y-auto">
                    {users.map((u) => {
                      const locked = u.id !== task.assignedById && reassigningWouldLockMeOut(u.id);
                      return (
                      <button
                        key={u.id}
                        disabled={locked}
                        onClick={() => !locked && updateTask(task.id, { assignedById: u.id })}
                        title={locked ? "เปลี่ยนไม่ได้ — จะทำให้คุณแก้/เห็นงานนี้เองไม่ได้อีก" : undefined}
                        className={cn(
                          "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left",
                          locked ? "opacity-40 cursor-not-allowed" : "hover:bg-[var(--bg-soft)]"
                        )}
                      >
                        <span className={cn("h-4 w-4 rounded-full border flex items-center justify-center shrink-0", u.id === task.assignedById ? "bg-[var(--brand-green)] border-[var(--brand-green)]" : "border-[var(--line)]")}>
                          {u.id === task.assignedById && <Check className="h-3 w-3 text-white" />}
                        </span>
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="text-[9px] bg-[var(--bg-soft)]">{u.avatar}</AvatarFallback>
                        </Avatar>
                        <span className="flex-1 text-sm truncate">{u.name}</span>
                      </button>
                      );
                    })}
                  </PopoverContent>
                </Popover>
              ) : (
                <span className="flex items-center gap-1.5 rounded-full bg-white border border-[var(--line)] pl-0.5 pr-2 py-0.5">
                  <Avatar className="h-5 w-5">
                    <AvatarFallback className="text-[8px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{assignedBy?.avatar}</AvatarFallback>
                  </Avatar>
                  <span className="font-medium text-[var(--ink)]">{assignedBy?.name}</span>
                </span>
              )}
            </span>
            <span className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" />
              <span className="font-medium text-[var(--ink)]">{departmentNames.join(", ")}</span>
            </span>
          </div>

          {/* Dates (start date: creator only) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--ink-soft)] flex items-center gap-1"><Calendar className="h-3 w-3" /> วันเริ่มต้น</Label>
              {canEditMain ? (
                <DatePickerField
                  value={toDateInput(task.startDate)}
                  onChange={(v) => updateTask(task.id, { startDate: new Date(v).toISOString() })}
                />
              ) : (
                <div className="flex items-center h-9 px-1 text-sm">{formatDate(task.startDate)}</div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--ink-soft)] flex items-center gap-1"><Calendar className="h-3 w-3" /> กำหนดส่ง</Label>
              <div className="flex items-center gap-1.5 h-9 px-1 text-sm">
                {formatDate(task.dueDate)}
              </div>
            </div>
          </div>

          {/* Group task: per-assignee due-date override — falls back to the
              shared due date above for anyone not listed here. */}
          {isShared && (
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--ink-soft)]">กำหนดส่งแยกรายคน</Label>
              <div className="space-y-1">
                {task.assigneeIds.map((uid) => {
                  const u = getUser(uid);
                  const effective = task.assigneeDueDates?.[uid] ?? toDateInput(task.dueDate);
                  const staged = stagedAssigneeDates[uid];
                  const dirty = staged !== undefined && staged !== effective;
                  return (
                    <div key={uid} className="flex items-center gap-2">
                      <Avatar className="h-5 w-5 shrink-0">
                        <AvatarFallback className="text-[9px] bg-[var(--bg-soft)]">{u?.avatar}</AvatarFallback>
                      </Avatar>
                      <span className="text-xs flex-1 truncate">{u?.name}</span>
                      {canEditMain ? (
                        <>
                          <DatePickerField
                            value={staged ?? effective}
                            minDate={toDateInput(task.startDate)}
                            onChange={(v) => setStagedAssigneeDates((s) => ({ ...s, [uid]: v }))}
                            className="h-8 text-xs w-36"
                          />
                          {/* Picking a date only stages it — nothing is saved,
                              logged, or notified to the assignee until this
                              confirm is clicked, so a stray date pick can't
                              silently revise + notify someone. */}
                          {dirty && (
                            <>
                              <Button
                                size="icon-sm"
                                variant="outline"
                                className="h-8 w-8 shrink-0 border-[var(--brand-green)] text-[var(--brand-green-dark)] hover:bg-[var(--accent)]"
                                title="ยืนยันกำหนดส่งใหม่"
                                aria-label={`ยืนยันกำหนดส่งใหม่ของ ${u?.name}`}
                                onClick={() => {
                                  reviseAssigneeDueDate(task.id, uid, staged, viewingAsUserId);
                                  setStagedAssigneeDates((s) => {
                                    const next = { ...s };
                                    delete next[uid];
                                    return next;
                                  });
                                }}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="h-8 w-8 shrink-0 text-[var(--ink-soft)] hover:text-[var(--chart-red)]"
                                title="ยกเลิก"
                                aria-label={`ยกเลิกการแก้ไขกำหนดส่งของ ${u?.name}`}
                                onClick={() =>
                                  setStagedAssigneeDates((s) => {
                                    const next = { ...s };
                                    delete next[uid];
                                    return next;
                                  })
                                }
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </>
                      ) : (
                        <span className="text-xs">{formatDate(effective)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {task.missedDeadlineOnce && (
            <Badge variant="secondary" className="w-fit text-[10px] font-normal bg-red-50 text-[var(--chart-red)] gap-1">
              <History className="h-3 w-3" /> เลยกำหนด
            </Badge>
          )}

          <Separator />

          {/* Missed-deadline dock — a status, not a sticker. Every task is
              docked automatically the instant it goes overdue, nothing for
              a lead to click. An existing penalty always shows (see
              canSeePenaltyStatus); an offer to (re)dock one only shows to a
              viewer who could actually act on it. */}
          {!isShared && canSeePenaltyStatus(task, viewingAsUserId) && (
            <>
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">สถานะการหักคะแนน</h4>
                <p className="text-[11px] text-[var(--ink-soft)]">งานนี้กำหนดส่งตรงเวลา — เลยกำหนดจะหักคะแนนอัตโนมัติ</p>
                <PenaltyChip task={task} className="h-7 text-xs px-2.5" />
              </div>
              <Separator />
            </>
          )}

          {/* Group task: each assignee is judged (and docked) against their
              own effective due date — see task-penalty-sweep.ts — so the
              dock shows per person instead of one chip for the whole task. */}
          {isShared && Object.keys(task.penalties ?? {}).length > 0 && (
            <>
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">สถานะการหักคะแนน (รายคน)</h4>
                <div className="space-y-1">
                  {Object.entries(task.penalties ?? {}).map(([uid, p]) => (
                    <div key={uid} className="flex items-center justify-between text-xs rounded-lg bg-[var(--bg-soft)] px-3 py-1.5">
                      <span className="font-medium">{getUser(uid)?.name ?? uid}</span>
                      <span className="text-[var(--chart-red)] font-semibold">−{Math.abs(p.points)} คะแนน</span>
                    </div>
                  ))}
                </div>
              </div>
              <Separator />
            </>
          )}

          {/* Reactions / sticker scoring */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">ให้สติกเกอร์งานนี้</h4>
            <div className="flex flex-wrap gap-1.5">
              {pickableStickers.map((s) => (
                <Tooltip key={s.id}>
                  <TooltipTrigger
                    render={
                      <button
                        onClick={() => handleReact(s)}
                        className="flex items-center gap-1 rounded-full border border-[var(--line)] bg-white pl-2 pr-2.5 py-1 text-sm hover:border-[var(--brand-green)] hover:bg-[var(--accent)] transition-colors"
                      >
                        <span>{s.emoji}</span>
                        <span className="text-xs text-[var(--ink-soft)]">{s.label}</span>
                      </button>
                    }
                  />
                  <TooltipContent>{s.points > 0 ? `+${s.points}` : s.points} คะแนน</TooltipContent>
                </Tooltip>
              ))}
            </div>

            {task.reactions.length > 0 && (
              <div className="space-y-1.5">
                {task.reactions.map((r) => {
                  const sticker = stickers.find((s) => s.id === r.stickerId);
                  const by = getUser(r.byUserId);
                  const canRemove = canRemoveReaction(r.byUserId, task.departmentIds, viewingAsUserId);
                  return (
                    <div key={r.id} className="flex items-center gap-2.5 text-sm rounded-lg bg-[var(--bg-soft)] px-3 py-2">
                      <span className="text-base">{sticker?.emoji ?? "🏷️"}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate">
                          <span className="font-medium">{by?.name}</span>{" "}
                          <span className="text-[var(--ink-soft)]">ติด{sticker?.label ?? "สติกเกอร์"}</span>
                        </p>
                        <p className="text-[10px] text-[var(--ink-soft)]">{relativeTime(r.createdAt)}</p>
                      </div>
                      {sticker && sticker.points !== 0 && (
                        <span className={cn("text-xs font-semibold tabular-nums", sticker.points < 0 ? "text-[var(--chart-red)]" : "text-[var(--brand-green-dark)]")}>
                          {sticker.points > 0 ? `+${sticker.points}` : sticker.points}
                        </span>
                      )}
                      {canRemove && (
                        <button onClick={() => removeReaction(task.id, r.id)} className="text-[var(--ink-soft)] hover:text-[var(--chart-red)]" aria-label="ลบสติกเกอร์">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Separator />

          {/* Revision tracking — the whole-task "แก้ไขกำหนดส่ง" button/form
              (and its "กำหนดส่งเดิม"/task.revisions history) only apply to a
              single shared due date, which doesn't make sense once a group
              task has per-assignee due dates — editing there happens through
              "กำหนดส่งแยกรายคน" above instead, one person at a time. */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold flex items-center gap-1.5">
                <History className="h-4 w-4" /> ประวัติการแก้ไขกำหนดส่ง
              </h4>
              {!isShared && !revising && canEditMain && (
                <Button size="sm" variant="outline" onClick={() => setRevising(true)}>แก้ไขกำหนดส่ง</Button>
              )}
            </div>

            {!isShared && (
              <div className="text-sm flex items-center justify-between rounded-lg bg-[var(--bg-soft)] px-3 py-2">
                <span className="text-[var(--ink-soft)]">กำหนดส่งเดิม</span>
                <span className="font-medium">{formatDate(task.originalDueDate)}</span>
              </div>
            )}

            {!isShared && task.revisions.map((r) => (
              <div key={r.revisionNumber} className="text-sm rounded-lg border border-[var(--line)] px-3 py-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">รอบแก้ไข #{r.revisionNumber}</span>
                  <span className="text-xs text-[var(--ink-soft)]">{formatDate(r.revisedAt)}</span>
                </div>
                <p className="text-xs text-[var(--ink-soft)]">
                  {formatDate(r.previousDate)} → <span className="font-medium text-[var(--ink)]">{formatDate(r.newDate)}</span>
                </p>
                <p className="text-xs text-[var(--ink-soft)] italic">&quot;{r.reason}&quot; — {getUser(r.revisedBy)?.name}</p>
              </div>
            ))}

            {/* Per-assignee due-date edits (see กำหนดส่งแยกรายคน above) — only
                the first-ever date and the latest revision, not every round
                in between, since this is a quick per-person nudge rather than
                a formal re-plan like the whole-task revisions above. */}
            {Object.entries(task.assigneeDueDateRevisions ?? {}).map(([uid, r]) => (
              <div key={uid} className="text-sm rounded-lg border border-[var(--line)] px-3 py-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">กำหนดส่งของ {getUser(uid)?.name ?? uid}</span>
                  <span className="text-xs text-[var(--ink-soft)]">{formatDate(r.revisedAt)}</span>
                </div>
                <p className="text-xs text-[var(--ink-soft)]">
                  เดิม {formatDate(r.originalDate)} → ล่าสุด <span className="font-medium text-[var(--ink)]">{formatDate(r.latestDate)}</span>
                </p>
                <p className="text-xs text-[var(--ink-soft)] italic">แก้โดย {getUser(r.revisedBy)?.name}</p>
              </div>
            ))}

            {(isShared || task.revisions.length === 0) && Object.keys(task.assigneeDueDateRevisions ?? {}).length === 0 && !revising && (
              <p className="text-xs text-[var(--ink-soft)]">ยังไม่มีการแก้ไขกำหนดส่ง</p>
            )}

            {!isShared && revising && canEditMain && (
              <div className="rounded-lg border border-[var(--line)] p-3 space-y-2.5">
                <div className="space-y-1.5">
                  <Label className="text-xs">กำหนดส่งใหม่</Label>
                  <DatePickerField value={newDate} minDate={task ? toDateInput(task.startDate) : undefined} onChange={setNewDate} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rev-reason" className="text-xs">เหตุผล</Label>
                  <Textarea id="rev-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ทำไมกำหนดส่งถึงเปลี่ยน?" />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="ghost" onClick={() => setRevising(false)}>ยกเลิก</Button>
                  <Button
                    size="sm"
                    className="bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white"
                    onClick={submitRevision}
                    disabled={!newDate || !reason.trim()}
                  >
                    บันทึกการแก้ไข
                  </Button>
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Checklist (Planner-style) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold flex items-center gap-1.5">
                <ListTodo className="h-4 w-4" /> เช็คลิสต์
                {task.checklist.length > 0 && (
                  <span className="text-xs font-normal text-[var(--ink-soft)]">
                    {task.checklist.filter((c) => c.done).length}/{task.checklist.length}
                  </span>
                )}
              </h4>
              {task.checklist.length > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={task.showChecklistOnCard}
                    onChange={(e) => updateTask(task.id, { showChecklistOnCard: e.target.checked })}
                    className="accent-[var(--brand-green)]"
                  />
                  แสดงบนการ์ด
                </label>
              )}
            </div>

            {(() => {
              const checklistOwnerIds = isShared ? task.assigneeIds : [task.assigneeIds[0]!];
              const renderItem = (c: (typeof task.checklist)[number]) => {
                const canToggle = canToggleOwnChecklistItem(c, viewingAsUserId);
                return (
                  <div key={c.id} className="flex items-center gap-2 group rounded-md px-1 py-0.5 hover:bg-[var(--bg-soft)]">
                    <button
                      onClick={() => canToggle && toggleChecklistItem(task.id, c.id)}
                      disabled={!canToggle}
                      className={cn(
                        "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                        c.done ? "bg-[var(--brand-green)] border-[var(--brand-green)]" : "border-[var(--line)]",
                        canToggle ? "hover:border-[var(--brand-green)]" : "opacity-50 cursor-not-allowed"
                      )}
                      title={!canToggle ? "ติ๊กได้เฉพาะเจ้าของรายการนี้" : undefined}
                      aria-label={c.done ? `ทำเครื่องหมาย "${c.text}" ว่ายังไม่เสร็จ` : `ทำเครื่องหมาย "${c.text}" ว่าเสร็จแล้ว`}
                    >
                      {c.done && <Check className="h-3 w-3 text-white" />}
                    </button>
                    <span className={cn("flex-1 text-sm", c.done && "line-through text-[var(--ink-soft)]")}>{c.text}</span>
                    {canEditMain && (
                      <button
                        onClick={() => removeChecklistItem(task.id, c.id)}
                        className="text-[var(--ink-soft)] hover:text-[var(--chart-red)] opacity-0 group-hover:opacity-100"
                        aria-label={`ลบรายการ "${c.text}"`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              };

              if (!isShared) {
                return task.checklist.map(renderItem);
              }
              // Group task: one sub-section per assignee, so it's clear at a
              // glance whose part is whose.
              return checklistOwnerIds.map((ownerId) => {
                const items = task.checklist.filter((c) => c.ownerId === ownerId);
                const owner = getUser(ownerId);
                return (
                  <div key={ownerId} className="space-y-0.5">
                    <p className="text-xs font-medium text-[var(--ink-soft)] px-1 pt-1">
                      เช็คลิสต์ของ {owner?.name ?? ownerId}{" "}
                      {items.length > 0 && (
                        <span className="font-normal">({items.filter((c) => c.done).length}/{items.length})</span>
                      )}
                    </p>
                    {items.length === 0 && <p className="text-xs text-[var(--ink-soft)] px-1">ยังไม่มีรายการ</p>}
                    {items.map(renderItem)}
                  </div>
                );
              });
            })()}

            {canEditMain && (
              <div className="flex items-center gap-2 px-1 pt-1">
                {/* Adding only ever happens on an explicit press — Enter or
                    the button — never on blur, which used to add whatever was
                    half-typed the instant focus left the field. */}
                <Input
                  value={newChecklistItem}
                  onChange={(e) => setNewChecklistItem(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && commitChecklistItem(isShared ? newChecklistOwnerId : task.assigneeIds[0]!)}
                  placeholder="เพิ่มรายการ..."
                  className="h-8 text-sm border-0 border-b border-[var(--line)] rounded-none px-0 shadow-none focus-visible:ring-0 focus-visible:border-[var(--brand-green)] flex-1"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0"
                  disabled={!newChecklistItem.trim()}
                  onClick={() => commitChecklistItem(isShared ? newChecklistOwnerId : task.assigneeIds[0]!)}
                >
                  <Plus className="h-3.5 w-3.5" /> ตกลง
                </Button>
                {isShared && (
                  <Select value={newChecklistOwnerId || task.assigneeIds[0]!} onValueChange={(v) => v && setNewChecklistOwnerId(v)}>
                    <SelectTrigger className="w-32 h-8 text-xs shrink-0">
                      <SelectValue>{getUser(newChecklistOwnerId || task.assigneeIds[0]!)?.name ?? "ผู้รับผิดชอบ"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {task.assigneeIds.map((uid) => (
                        <SelectItem key={uid} value={uid}>{getUser(uid)?.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Attachments (add / remove) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold flex items-center gap-1.5">
                <Paperclip className="h-4 w-4" /> ไฟล์แนบ ({task.attachments.length})
              </h4>
              <Button size="sm" variant="outline" disabled={taskAttachUploading} onClick={() => taskFileInputRef.current?.click()}>
                {taskAttachUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} แนบไฟล์
              </Button>
              <input
                ref={taskFileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleTaskFilesSelected(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {task.attachments.length === 0 && <p className="text-xs text-[var(--ink-soft)]">ไม่มีไฟล์แนบ</p>}
            {task.attachments.map((a) => {
              // Whoever uploaded it (or whoever can edit the task's core
              // fields) can remove it — same self-scoping as comments below,
              // rather than anyone who can open the task deleting anyone
              // else's file.
              const canRemove = a.uploadedBy === viewingAsUserId || canEditMain;
              const src = a.url ?? a.dataUrl;
              return (
                <div key={a.id} className="flex items-center gap-2.5 text-sm rounded-lg border border-[var(--line)] px-3 py-2">
                  {a.type === "รูปภาพ" && src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt={a.name} className="h-8 w-8 rounded object-cover shrink-0" />
                  ) : (
                    <FileText className="h-4 w-4 text-[var(--ink-soft)] shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    {src ? (
                      <a href={src} target="_blank" rel="noreferrer" className="truncate font-medium block hover:underline">
                        {a.name}
                      </a>
                    ) : (
                      <p className="truncate font-medium">{a.name}</p>
                    )}
                    <p className="text-xs text-[var(--ink-soft)]">{a.type} · {a.size}</p>
                  </div>
                  {canRemove && (
                    <button
                      onClick={() => removeAttachment(task.id, a.id)}
                      className="text-[var(--ink-soft)] hover:text-[var(--chart-red)]"
                      aria-label={`ลบไฟล์แนบ ${a.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-[10px] text-[var(--ink-soft)] pt-1">
            สร้างเมื่อ {formatDateTime(task.createdAt)} · อัปเดต {relativeTime(task.updatedAt)}
          </p>
        </div>

        {/* Chat rail — comments, always visible, not buried at the bottom of a long scroll */}
        <div className="w-full md:w-[320px] shrink-0 border-t md:border-t-0 md:border-l border-[var(--line)] flex flex-col overflow-hidden min-h-0 bg-[var(--bg-soft)]/30">
          <div className="px-4 py-3 border-b border-[var(--line)] shrink-0">
            <h4 className="text-sm font-semibold">ความคิดเห็น ({task.comments.length})</h4>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
            {task.comments.map((c) => {
              const author = getUser(c.authorId);
              const mine = c.authorId === viewingAsUserId;
              return (
                <div key={c.id} className={cn("flex gap-2.5 group", mine && "flex-row-reverse")}>
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarFallback className={cn("text-[10px]", mine ? "bg-[var(--brand-green)] text-[var(--ink)]" : "bg-[var(--bg-soft)]")}>
                      {author?.avatar}
                    </AvatarFallback>
                  </Avatar>
                  <div className={cn("min-w-0 max-w-[78%] rounded-lg px-3 py-2", mine ? "bg-[var(--accent)]" : "bg-white")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">{mine ? "คุณ" : author?.name}</span>
                      <span className="text-[10px] text-[var(--ink-soft)]">{relativeTime(c.createdAt)}</span>
                    </div>
                    {c.message && <p className="text-sm mt-0.5 whitespace-pre-wrap break-words">{renderMentions(c.message)}</p>}
                    {c.attachments && c.attachments.length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {c.attachments.map((a) => {
                          const src = a.url ?? a.dataUrl;
                          return a.type === "รูปภาพ" && src ? (
                            <a key={a.id} href={src} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={src} alt={a.name} className="max-h-32 rounded-lg border border-[var(--line)]" />
                            </a>
                          ) : (
                            <a
                              key={a.id}
                              href={src}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1.5 text-xs bg-white/60 rounded-md px-2 py-1 hover:underline"
                            >
                              <FileText className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{a.name}</span>
                            </a>
                          );
                        })}
                      </div>
                    )}
                    {mine && (
                      <button
                        onClick={() => removeComment(task.id, c.id)}
                        className="text-[10px] text-[var(--ink-soft)] hover:text-[var(--chart-red)] mt-1 opacity-0 group-hover:opacity-100"
                      >
                        ลบ
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {task.comments.length === 0 && (
              <p className="text-xs text-[var(--ink-soft)] text-center py-6">เริ่มการสนทนาเกี่ยวกับงานนี้</p>
            )}
          </div>

          <div className="border-t border-[var(--line)] p-3 flex flex-col gap-2 shrink-0 bg-white">
            {commentAttachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {commentAttachments.map((a) => (
                  <span key={a.id} className="flex items-center gap-1.5 text-xs bg-[var(--bg-soft)] rounded-md pl-2 pr-1 py-1">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--ink-soft)]" />
                    <span className="truncate max-w-[140px]">{a.name}</span>
                    <button
                      onClick={() => removeCommentAttachment(a.id)}
                      className="text-[var(--ink-soft)] hover:text-[var(--chart-red)]"
                      aria-label={`เอา ${a.name} ออก`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <Button
                size="icon"
                variant="outline"
                className="shrink-0"
                disabled={commentUploading}
                onClick={() => commentFileInputRef.current?.click()}
                title="แนบไฟล์/รูปภาพ"
                aria-label="แนบไฟล์/รูปภาพ"
              >
                {commentUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </Button>
              <input
                ref={commentFileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleCommentFilesSelected(e.target.files);
                  e.target.value = "";
                }}
              />
              <Textarea
                placeholder="แสดงความคิดเห็น..."
                rows={1}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="min-h-9 resize-none bg-white"
              />
              <Button
                size="icon"
                className="bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white shrink-0"
                onClick={submitComment}
                aria-label="ส่งความคิดเห็น"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
        </div>
      </DialogContent>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบงานนี้?</AlertDialogTitle>
            <AlertDialogDescription>
              ลบงาน &quot;{task.title}&quot; ออกจากระบบ — ย้อนกลับไม่ได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--chart-red)] hover:bg-red-700 text-white"
              onClick={confirmDelete}
            >
              ลบ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
    <StickerConfirmDialog
      open={!!pendingSticker}
      onOpenChange={(open) => !open && setPendingSticker(null)}
      sticker={pendingSticker}
      recipientName={assignees[0]?.name ?? "ผู้รับผิดชอบ"}
      taskTitle={task?.title ?? ""}
      onConfirm={confirmSticker}
    />
    </>
  );
}
