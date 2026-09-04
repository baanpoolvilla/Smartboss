"use client";

import { useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/modules/report_task/components/ui/dialog";
import { Button } from "@/modules/report_task/components/ui/button";
import { Input } from "@/modules/report_task/components/ui/input";
import { Textarea } from "@/modules/report_task/components/ui/textarea";
import { Switch } from "@/modules/report_task/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/report_task/components/ui/select";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { TimePickerField } from "@/modules/report_task/components/shared/time-picker-field";
import { AttendeePicker } from "@/modules/report_task/components/shared/attendee-picker";
import { useTodoStore } from "@/modules/report_task/store/todo-store";
import { useMeetingStore } from "@/modules/report_task/store/meeting-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useReminderSettingsStore } from "@/modules/report_task/store/reminder-settings-store";
import { todayIso } from "@/modules/report_task/lib/now";
import { cn } from "@/modules/report_task/lib/utils";
import { canManage, departmentIdsOf } from "@/modules/report_task/lib/directory";
import { X, Trash2, Bell } from "lucide-react";
import { toast } from "sonner";
import type { CalendarEvent, TodoItem } from "@/modules/report_task/types";
import { uuid } from "@/modules/report_task/lib/uuid";

// Exported so DeadlineReminderSettingsPanel's "สิ่งที่ต้องทำ" default picker
// offers the exact same choices this dialog's own per-item picker does —
// the company default is just what pre-fills the field below, so the two
// pickers having different options would be its own confusing surprise.
export const REMINDER_OPTIONS = [
  { value: "0", label: "ไม่แจ้งเตือน", minutes: 0 },
  { value: "15", label: "15 นาทีก่อน", minutes: 15 },
  { value: "30", label: "30 นาทีก่อน", minutes: 30 },
  { value: "60", label: "1 ชั่วโมงก่อน", minutes: 60 },
  { value: "180", label: "3 ชั่วโมงก่อน", minutes: 180 },
  { value: "1440", label: "1 วันก่อน", minutes: 1440 },
  { value: "4320", label: "3 วันก่อน", minutes: 4320 },
] as const;

export function AddTodoDialog({
  open,
  onOpenChange,
  defaultDate,
  editingTodo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate?: string;
  editingTodo?: TodoItem | null;
}) {
  const addTodo = useTodoStore((s) => s.addTodo);
  const updateTodo = useTodoStore((s) => s.updateTodo);
  const removeTodo = useTodoStore((s) => s.removeTodo);
  const addMeeting = useMeetingStore((s) => s.addMeeting);
  const notifyMany = useNotificationStore((s) => s.notifyMany);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const canCreateMeeting = canManage(viewingAsUserId);
  const todoReminderDefault = useReminderSettingsStore((s) => s.settings.todo);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate ?? todayIso());
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [isMeeting, setIsMeeting] = useState(false);
  const [meetAttendeeIds, setMeetAttendeeIds] = useState<string[]>([]);
  const [meetStart, setMeetStart] = useState("10:00");
  const [meetEnd, setMeetEnd] = useState("11:00");
  const [meetLocation, setMeetLocation] = useState("");
  const [meetOnline, setMeetOnline] = useState(false);
  const [reminderMinutes, setReminderMinutes] = useState(0);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTitle(editingTodo?.title ?? "");
      setDate(editingTodo?.date ?? defaultDate ?? todayIso());
      setTime(editingTodo?.time ?? "");
      setNote(editingTodo?.note ?? "");
      setIsMeeting(false);
      setMeetAttendeeIds([]);
      setMeetStart("10:00");
      setMeetEnd("11:00");
      setMeetLocation("");
      setMeetOnline(false);
      // A brand-new to-do pre-fills from the company default set in
      // settings (แจ้งเตือนใกล้ถึงกำหนด ▸ สิ่งที่ต้องทำ) instead of always
      // landing on "ไม่แจ้งเตือน" — still just a starting point, changeable
      // right here same as before, and editing an existing item keeps
      // showing whatever that item was actually saved with.
      setReminderMinutes(editingTodo?.reminderMinutes ?? (todoReminderDefault.enabled ? todoReminderDefault.defaultLeadMinutes : 0));
    }
  }

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    const trimmedNote = note.trim();

    if (isMeeting && canCreateMeeting) {
      const meetDeptIds = departmentIdsOf(meetAttendeeIds);
      const meeting: CalendarEvent = {
        id: `meet-${uuid()}`,
        title: trimmed,
        type: "meeting",
        start: `${date}T${meetStart}:00`,
        end: `${date}T${meetEnd}:00`,
        allDay: false,
        departmentId: meetDeptIds[0],
        departmentIds: meetDeptIds,
        attendeeIds: meetAttendeeIds,
        createdById: viewingAsUserId,
        location: meetOnline ? "ออนไลน์ (Teams/Zoom)" : meetLocation.trim() || "ไม่ระบุสถานที่",
        description: trimmedNote || undefined,
        reminderMinutes: reminderMinutes || undefined,
      };
      addMeeting(meeting);
      if (meetAttendeeIds.length > 0) {
        notifyMany(meetAttendeeIds, viewingAsUserId, `แท็กคุณในประชุม "${trimmed}"`);
      }
      toast.success("สร้างประชุมเรียบร้อยแล้ว");
      onOpenChange(false);
      return;
    }

    if (editingTodo) {
      updateTodo(editingTodo.id, {
        title: trimmed,
        date,
        time: time || undefined,
        note: trimmedNote || undefined,
        reminderMinutes: reminderMinutes || undefined,
      });
    } else {
      addTodo({
        id: `todo-${uuid()}`,
        userId: viewingAsUserId,
        date,
        title: trimmed,
        done: false,
        createdAt: new Date().toISOString(),
        time: time || undefined,
        note: trimmedNote || undefined,
        reminderMinutes: reminderMinutes || undefined,
      });
    }
    onOpenChange(false);
  }

  function handleDelete() {
    if (!editingTodo) return;
    removeTodo(editingTodo.id);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogClose render={<Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" />}>
          <X />
          <span className="sr-only">Close</span>
        </DialogClose>
        <DialogHeader>
          <DialogTitle>{editingTodo ? "แก้ไขสิ่งที่ต้องทำ" : isMeeting ? "สร้างประชุม" : "เพิ่มสิ่งที่ต้องทำ"}</DialogTitle>
          <DialogDescription>
            {isMeeting
              ? "นัดประชุมพร้อมเลือกผู้เข้าร่วมได้จากที่นี่เลย"
              : "รายการสั้น ๆ ที่ผูกกับวันที่ — ติ๊กเสร็จหรือลากย้ายวันได้จากตัวปฏิทินเลย"}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            placeholder={isMeeting ? "หัวข้อประชุม…" : "ต้องทำอะไร…"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isMeeting) submit();
            }}
          />

          <Textarea
            placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="resize-none"
          />

          {!editingTodo && canCreateMeeting && (
            // `<div>`, not `<label>` — a native <label> forwards its own
            // click to the first form control inside it (Switch renders as
            // `<button role="switch">`, which qualifies), so tapping the
            // switch itself fired the toggle twice: once directly, once
            // forwarded — flipping it on then immediately back off, which
            // read as the switch just not responding to taps at all.
            <div
              role="button"
              tabIndex={0}
              onClick={() => setIsMeeting((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setIsMeeting((v) => !v);
                }
              }}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] px-3 py-2 cursor-pointer"
            >
              <span className="text-sm font-medium">เป็นการประชุม</span>
              <Switch checked={isMeeting} onCheckedChange={setIsMeeting} onClick={(e) => e.stopPropagation()} />
            </div>
          )}

          {isMeeting ? (
            <>
              {/* flex-wrap (item 3's own consistency check) — date +
                  2 required time fields side by side can't shrink below
                  ~330px combined, wider than a narrow phone; wrapping the
                  two time fields onto their own row keeps every field at a
                  usable width instead of getting crushed. */}
              <div className="flex flex-wrap gap-2">
                <DatePickerField value={date} onChange={setDate} className="flex-1 min-w-[140px]" />
                <div className="flex gap-2 w-full sm:w-auto">
                  <TimePickerField value={meetStart} onChange={setMeetStart} className="flex-1 sm:w-[100px] sm:flex-none" aria-label="เวลาเริ่ม" />
                  <TimePickerField value={meetEnd} onChange={setMeetEnd} className="flex-1 sm:w-[100px] sm:flex-none" aria-label="เวลาสิ้นสุด" />
                </div>
              </div>
              <AttendeePicker value={meetAttendeeIds} onChange={setMeetAttendeeIds} placeholder="เลือกแผนก/ผู้เข้าร่วม..." />
              <div className="flex items-center gap-2">
                <Input
                  placeholder="สถานที่ประชุม…"
                  value={meetLocation}
                  onChange={(e) => setMeetLocation(e.target.value)}
                  disabled={meetOnline}
                  className="flex-1"
                />
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--ink-soft)] cursor-pointer">
                  <Switch checked={meetOnline} onCheckedChange={setMeetOnline} />
                  ออนไลน์
                </label>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <DatePickerField value={date} onChange={setDate} className="flex-1 min-w-[140px]" />
              <TimePickerField value={time} onChange={setTime} className="w-full sm:w-[110px] sm:shrink-0" aria-label="เวลา (ไม่บังคับ)" />
            </div>
          )}

          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 shrink-0 text-[var(--ink-soft)]" />
            <Select
              value={String(reminderMinutes)}
              onValueChange={(v) => v && setReminderMinutes(Number(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {REMINDER_OPTIONS.find((o) => o.minutes === reminderMinutes)?.label ?? "ไม่แจ้งเตือน"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REMINDER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex gap-2">
          {editingTodo && (
            <Button
              variant="outline"
              className="text-[var(--chart-red)] border-[var(--chart-red)]/30 hover:bg-red-50"
              onClick={handleDelete}
            >
              <Trash2 className="h-4 w-4" /> ลบ
            </Button>
          )}
          <Button
            className={cn(
              "bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white",
              editingTodo ? "flex-1" : "w-full"
            )}
            disabled={!title.trim() || (isMeeting && meetEnd <= meetStart)}
            onClick={submit}
          >
            {editingTodo ? "บันทึก" : isMeeting ? "สร้างประชุม" : "เพิ่มสิ่งที่ต้องทำ"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
