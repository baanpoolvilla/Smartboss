"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/modules/report_task/components/ui/tooltip";
import { Button } from "@/modules/report_task/components/ui/button";
import { Input } from "@/modules/report_task/components/ui/input";
import { Label } from "@/modules/report_task/components/ui/label";
import { Switch } from "@/modules/report_task/components/ui/switch";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { TimePickerField } from "@/modules/report_task/components/shared/time-picker-field";
import { AttendeePicker } from "@/modules/report_task/components/shared/attendee-picker";
import { getUser, getDepartment, departmentIdsOf } from "@/modules/report_task/lib/directory";
import { departmentsLabel } from "@/modules/report_task/lib/department-label";
import { canEditRecord } from "@/modules/report_task/lib/permissions";
import { eventTypeLabels } from "@/modules/report_task/lib/calendar-colors";
import { useLeaveTypeStore } from "@/modules/report_task/store/leave-type-store";
import { useEventColorStore } from "@/modules/report_task/store/event-color-store";
import { useMeetingStore } from "@/modules/report_task/store/meeting-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { formatDate, addDays } from "@/modules/report_task/lib/format";
import type { CalendarEvent } from "@/modules/report_task/types";
import { Calendar, MapPin, User, Trash2, Pencil, Clock, Building2, Paperclip, FileText } from "lucide-react";
import { toast } from "sonner";

export function EventDetailDialog({
  event,
  onOpenChange,
}: {
  event: CalendarEvent | null;
  onOpenChange: (open: boolean) => void;
}) {
  const colors = useEventColorStore((s) => s.colors);
  const updateMeeting = useMeetingStore((s) => s.updateMeeting);
  const removeMeeting = useMeetingStore((s) => s.removeMeeting);
  const leaveTypes = useLeaveTypeStore((s) => s.types);
  const notifyMany = useNotificationStore((s) => s.notifyMany);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const [editing, setEditing] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // Collapsed by default — a company-wide meeting can invite hundreds of
  // people, and rendering every chip would blow up the dialog's height.
  // Reset during render (not an effect) when the event being viewed changes
  // — the standard "adjusting state on prop change" pattern.
  const [attendeesExpanded, setAttendeesExpanded] = useState(false);
  const [lastEventId, setLastEventId] = useState(event?.id);
  if (event?.id !== lastEventId) {
    setLastEventId(event?.id);
    setAttendeesExpanded(false);
  }

  if (!event) return null;
  const user = event.userId ? getUser(event.userId) : undefined;
  const department = event.departmentId ? getDepartment(event.departmentId) : undefined;
  const color = colors[event.type];
  // Holidays are org-wide (no personal owner) — everyone can manage them.
  // Meetings/leave are locked to whoever created them, or the head of a
  // department the record touches — including a meeting with no recorded
  // creator (seeded before that field existed), which falls through to the
  // department-head check rather than being open to everyone.
  const isOwner =
    event.type === "meeting" &&
    canEditRecord(event.createdById, event.departmentIds ?? [event.departmentId], viewingAsUserId);
  /*
   * Meetings only. Leave and holidays are read-only mirrors of workforce (see
   * app/api/report-task/store/[key]/route.ts — those two keys refuse writes),
   * so an edit here never reached the database: the PUT came back 409, which
   * the sync layer reads as "someone saved first", so it merged and retried
   * silently and the edit vanished at the next poll with a success toast
   * still on screen. Pointing at /hr is the honest answer.
   */
  const editable = event.type === "meeting" && isOwner;

  function close(open: boolean) {
    if (!open) setEditing(false);
    onOpenChange(open);
  }

  function confirmDelete() {
    if (!event) return;
    // Only meetings reach here — see `editable`, which gates both footer buttons.
    removeMeeting(event.id);
    toast.success("ลบรายการแล้ว");
    close(false);
  }

  function handleSave(patch: Partial<CalendarEvent>) {
    if (!event) return;
    if (event.type === "meeting") {
      updateMeeting(event.id, patch);
      const before = new Set(event.attendeeIds ?? []);
      const newlyAdded = (patch.attendeeIds ?? []).filter((id) => !before.has(id));
      if (newlyAdded.length > 0) {
        const actor = getUser(viewingAsUserId);
        notifyMany(newlyAdded, viewingAsUserId, `${actor?.name} แท็กคุณในประชุม "${patch.title ?? event.title}"`, event.id);
      }
    }
    toast.success("บันทึกการแก้ไขแล้ว");
    setEditing(false);
  }

  return (
    <Dialog open={!!event} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <Badge variant="outline" className="w-fit text-[10px] mb-1" style={{ borderColor: color, color }}>
            {eventTypeLabels[event.type]}
            {event.leaveType ? ` · ${leaveTypes.find((t) => t.id === event.leaveType)?.label ?? "ลา"}` : ""}
          </Badge>
          <DialogTitle>{editing ? "แก้ไขรายการ" : event.title}</DialogTitle>
          {!editing && (
            <DialogDescription className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {formatDate(event.start)}
              {event.end &&
                (() => {
                  // Leave/holiday store `end` exclusive (the day *after* the
                  // last actual day) — show the inclusive last day instead,
                  // and only as a range once that's actually a different day
                  // (otherwise a single-day holiday's own end-of-range
                  // marker reads as if it were itself a second day).
                  const exclusiveEnd = event.type === "leave" || event.type === "holiday";
                  const lastDay = exclusiveEnd ? addDays(event.end, -1) : event.end;
                  return lastDay.slice(0, 10) !== event.start.slice(0, 10) ? ` — ${formatDate(lastDay)}` : "";
                })()}
            </DialogDescription>
          )}
        </DialogHeader>

        {editing ? (
          <EventEditForm key={event.id} event={event} onSave={handleSave} onCancel={() => setEditing(false)} />
        ) : (
          <>
            <div className="space-y-3 text-sm">
              {user && (
                <div className="flex items-center gap-2.5">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user.avatarUrl ?? undefined} alt={user.name} />
                    <AvatarFallback className="text-[10px] bg-[var(--accent)] text-[var(--brand-green-dark)]">
                      {user.avatar}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{user.name}</p>
                    <p className="text-xs text-[var(--ink-soft)]">{user.role}</p>
                  </div>
                </div>
              )}
              {department && !user && event.type !== "meeting" && (
                <div className="flex items-center gap-2 text-[var(--ink-soft)]">
                  <User className="h-4 w-4" /> {department.name}
                </div>
              )}
              {event.type === "meeting" && event.attendeeIds && event.attendeeIds.length > 0 && (() => {
                // Overlapping avatars read as one glanceable cluster instead of a
                // wall of named pills — names show on hover, and the full list
                // is one click away rather than always taking up space.
                const ATTENDEES_PREVIEW_COUNT = 8;
                const attendees = event.attendeeIds.map((id) => getUser(id)).filter((u): u is NonNullable<typeof u> => !!u);
                const preview = attendees.slice(0, ATTENDEES_PREVIEW_COUNT);
                const overflow = attendees.length - preview.length;
                return (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-[var(--ink-soft)] shrink-0" />
                      <span className="text-[var(--ink-soft)]">ผู้เข้าร่วม {attendees.length} คน</span>
                    </div>
                    <div className="flex items-center gap-2 pl-6">
                      <AvatarGroup>
                        {preview.map((u) => (
                          <Tooltip key={u.id}>
                            <TooltipTrigger
                              render={
                                <Avatar size="sm">
                                  <AvatarImage src={u.avatarUrl ?? undefined} alt={u.name} />
                                  <AvatarFallback className="text-[9px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{u.avatar}</AvatarFallback>
                                </Avatar>
                              }
                            />
                            <TooltipContent>{u.name}</TooltipContent>
                          </Tooltip>
                        ))}
                        {overflow > 0 && <AvatarGroupCount>+{overflow}</AvatarGroupCount>}
                      </AvatarGroup>
                      <button
                        onClick={() => setAttendeesExpanded((v) => !v)}
                        className="text-xs font-medium text-[var(--brand-green-dark)] hover:underline"
                      >
                        {attendeesExpanded ? "ซ่อนรายชื่อ" : "ดูรายชื่อทั้งหมด"}
                      </button>
                    </div>
                    {attendeesExpanded && (
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 pl-6 pt-0.5 text-xs text-[var(--ink)]">
                        {attendees.map((u) => (
                          <p key={u.id} className="truncate">{u.name}</p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              {event.type === "meeting" && (event.departmentIds?.length ?? 0) > 0 && (
                <div className="flex items-center gap-2 text-[var(--ink-soft)]">
                  <Building2 className="h-4 w-4" />
                  แผนก:{" "}
                  <span className="font-medium text-[var(--ink)]">{departmentsLabel(event.departmentIds!)}</span>
                </div>
              )}
              {!event.allDay && (
                <div className="flex items-center gap-2 text-[var(--ink-soft)]">
                  <Clock className="h-4 w-4" />
                  {new Date(event.start).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false }).replace(":", ".")}
                  {event.end ? ` - ${new Date(event.end).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false }).replace(":", ".")}` : ""}
                </div>
              )}
              {event.location && (
                <div className="flex items-center gap-2 text-[var(--ink-soft)]">
                  <MapPin className="h-4 w-4" /> {event.location}
                </div>
              )}
              {event.description && <p className="text-[var(--ink-soft)]">{event.description}</p>}
              {event.attachments && event.attachments.length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)]">
                    <Paperclip className="h-3.5 w-3.5" /> ไฟล์แนบ ({event.attachments.length})
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {event.attachments.map((a) =>
                      a.url ?? a.dataUrl ? (
                        // Images are the only attachments actually stored (see
                        // buildAttachments in new-task-dialog.tsx) — the image
                        // src doubles as a download link.
                        <a
                          key={a.id}
                          href={a.url ?? a.dataUrl}
                          download={a.name}
                          target="_blank"
                          rel="noreferrer"
                          title={`${a.name} · ${a.size} · คลิกเพื่อดู/ดาวน์โหลด`}
                          className="block"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={a.url ?? a.dataUrl}
                            alt={a.name}
                            className="h-20 w-full object-cover rounded-lg border border-[var(--line)] cursor-pointer hover:opacity-90 transition-opacity"
                          />
                        </a>
                      ) : (
                        // Non-image attachments have no real file behind them —
                        // there's no upload backend, only metadata (name/size).
                        // Say so on click instead of a silent dead click.
                        <button
                          key={a.id}
                          type="button"
                          title={a.name}
                          onClick={() => toast.info(`"${a.name}" เป็นข้อมูลไฟล์แนบที่บันทึกไว้ ยังไม่มีระบบเก็บไฟล์จริงให้เปิด/ดาวน์โหลด`)}
                          className="h-20 flex flex-col items-center justify-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] px-1 text-center hover:border-[var(--brand-green)] transition-colors"
                        >
                          <FileText className="h-4 w-4 text-[var(--ink-soft)]" />
                          <span className="text-[10px] text-[var(--ink-soft)] truncate w-full">{a.name}</span>
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}
              {!editable && (
                <p className="text-xs text-[var(--ink-soft)]">
                  {event.type === "leave" ? (
                    <>
                      วันลามาจากโมดูลบุคคล — แก้ไข/ยกเลิกได้ที่{" "}
                      <a href="/hr/leave" className="underline hover:text-[var(--ink)]">
                        ปฏิทินวันหยุด (ฝ่ายบุคคล)
                      </a>{" "}
                      เพื่อให้ผ่านสายอนุมัติและตรงกับที่ใช้คิดเงินเดือน
                    </>
                  ) : event.type === "holiday" ? (
                    <>
                      วันหยุดบริษัทตั้งค่าที่{" "}
                      <a href="/hr/holidays" className="underline hover:text-[var(--ink)]">
                        โมดูลบุคคล
                      </a>{" "}
                      — ปฏิทินนี้แสดงผลอย่างเดียว
                    </>
                  ) : event.type === "google" ? (
                    "นำเข้าจากปฏิทินภายนอก — ดูอย่างเดียว แก้ไข/ลบจากในนี้ไม่ได้"
                  ) : (
                    "แก้ไขได้เฉพาะผู้สร้างรายการนี้"
                  )}
                </p>
              )}
            </div>

            {editable && (
              <DialogFooter className="sm:justify-between">
                <Button variant="outline" className="text-[var(--chart-red)] border-red-200 hover:bg-red-50" onClick={() => setConfirmDeleteOpen(true)}>
                  <Trash2 className="h-4 w-4" /> ลบ
                </Button>
                <Button className="bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white" onClick={() => setEditing(true)}>
                  <Pencil className="h-4 w-4" /> แก้ไข
                </Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบรายการนี้?</AlertDialogTitle>
            <AlertDialogDescription>
              ลบ &quot;{event.title}&quot; ออกจากปฏิทิน — ย้อนกลับไม่ได้
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
  );
}

/** Keyed by event.id so its fields initialize cleanly per event (no effects). */
function EventEditForm({
  event,
  onSave,
  onCancel,
}: {
  event: CalendarEvent;
  onSave: (patch: Partial<CalendarEvent>) => void;
  onCancel: () => void;
}) {
  const isLeave = event.type === "leave";
  const isHoliday = event.type === "holiday";
  const isMeeting = event.type === "meeting";
  const [title, setTitle] = useState(event.title);
  const [attendeeIds, setAttendeeIds] = useState<string[]>(event.attendeeIds ?? []);
  const [startDate, setStartDate] = useState(event.start.slice(0, 10));
  // Leave end is stored exclusive, so show the inclusive last day.
  const [endDate, setEndDate] = useState(
    isLeave && event.end ? addDays(event.end, -1) : event.end?.slice(0, 10) ?? event.start.slice(0, 10)
  );
  const [allDay, setAllDay] = useState(!!event.allDay);
  const timed = !event.allDay && event.start.includes("T");
  const [startTime, setStartTime] = useState(timed ? event.start.slice(11, 16) : "10:00");
  const [endTime, setEndTime] = useState(timed && event.end ? event.end.slice(11, 16) : "11:00");

  function save() {
    if (!title.trim()) {
      toast.error("กรุณากรอกหัวข้อ");
      return;
    }
    if (isLeave) {
      if (endDate < startDate) {
        toast.error("วันสิ้นสุดต้องไม่ก่อนวันเริ่ม");
        return;
      }
      onSave({ title: title.trim(), start: startDate, end: addDays(endDate, 1), allDay: true });
      return;
    }
    if (isHoliday) {
      onSave({ title: title.trim(), start: startDate, end: startDate, allDay: true });
      return;
    }
    // meeting
    if (!allDay && endTime <= startTime) {
      toast.error("เวลาสิ้นสุดต้องหลังเวลาเริ่ม");
      return;
    }
    const attendeeDeptIds = departmentIdsOf(attendeeIds);
    onSave(
      allDay
        ? { title: title.trim(), start: startDate, end: startDate, allDay: true, attendeeIds, departmentIds: attendeeDeptIds, departmentId: attendeeDeptIds[0] }
        : {
            title: title.trim(),
            start: `${startDate}T${startTime}:00`,
            end: `${startDate}T${endTime}:00`,
            allDay: false,
            attendeeIds,
            departmentIds: attendeeDeptIds,
            departmentId: attendeeDeptIds[0],
          }
    );
  }

  return (
    <>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-[var(--ink-soft)]">หัวข้อ</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        {isMeeting && (
          <div className="space-y-1.5">
            <Label className="text-xs text-[var(--ink-soft)]">ผู้เข้าร่วม ({attendeeIds.length} คน)</Label>
            <AttendeePicker value={attendeeIds} onChange={setAttendeeIds} />
            <p className="text-[11px] text-[var(--ink-soft)] flex items-center gap-1 pt-0.5 flex-wrap">
              <Building2 className="h-3 w-3" /> แผนก:{" "}
              <span className="font-medium text-[var(--ink)]">{departmentsLabel(departmentIdsOf(attendeeIds))}</span>{" "}
              (ตามผู้เข้าร่วม)
            </p>
          </div>
        )}

        {isLeave ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--ink-soft)]">วันเริ่ม</Label>
              <DatePickerField value={startDate} onChange={(v) => { setStartDate(v); if (endDate < v) setEndDate(v); }} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--ink-soft)]">วันสิ้นสุด</Label>
              <DatePickerField value={endDate} onChange={setEndDate} />
            </div>
          </div>
        ) : isHoliday ? (
          <div className="space-y-1.5">
            <Label className="text-xs text-[var(--ink-soft)]">วันที่</Label>
            <DatePickerField value={startDate} onChange={setStartDate} />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg bg-[var(--bg-soft)] px-3 py-2.5">
              <span className="text-sm">ทั้งวัน</span>
              <Switch checked={allDay} onCheckedChange={setAllDay} />
            </div>
            {allDay ? (
              <div className="space-y-1.5">
                <Label className="text-xs text-[var(--ink-soft)]">วันที่</Label>
                <DatePickerField value={startDate} onChange={setStartDate} />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5 col-span-1">
                  <Label className="text-xs text-[var(--ink-soft)]">วันที่</Label>
                  <DatePickerField value={startDate} onChange={setStartDate} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-[var(--ink-soft)]">เริ่ม</Label>
                  <TimePickerField value={startTime} onChange={setStartTime} className="w-full" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-[var(--ink-soft)]">สิ้นสุด</Label>
                  <TimePickerField value={endTime} onChange={setEndTime} className="w-full" />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>ยกเลิก</Button>
        <Button className="bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white" onClick={save}>
          บันทึก
        </Button>
      </DialogFooter>
    </>
  );
}
