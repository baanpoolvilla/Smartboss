"use client";

import { useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/modules/report_task/components/ui/dialog";
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
import { Checkbox } from "@/modules/report_task/components/ui/checkbox";
import { Label } from "@/modules/report_task/components/ui/label";
import { Textarea } from "@/modules/report_task/components/ui/textarea";
import { Switch } from "@/modules/report_task/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/modules/report_task/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { TimePickerField } from "@/modules/report_task/components/shared/time-picker-field";
import { AttendeePicker } from "@/modules/report_task/components/shared/attendee-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/report_task/components/ui/select";
import { departmentIdsOf, getDepartment, getUser, users, canManage } from "@/modules/report_task/lib/directory";
import { departmentsLabel } from "@/modules/report_task/lib/department-label";
import { taskPriorityOrder, priorityMeta } from "@/modules/report_task/lib/task-meta";
import { useLeaveTypeStore } from "@/modules/report_task/store/leave-type-store";
import { computeMonthlyLeaveStatus } from "@/modules/report_task/lib/leave-quota";
import { countryHolidayGrantResolver } from "@/modules/report_task/lib/holiday-grant";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useMeetingStore } from "@/modules/report_task/store/meeting-store";
import { useLeaveStore } from "@/modules/report_task/store/leave-store";
import { useHolidayStore, THAI_SOURCE } from "@/modules/report_task/store/holiday-store";
import { useRoutineDayOffStore } from "@/modules/report_task/store/routine-dayoff-store";
import { expandRule, projectedRoutineQuotaTotal, quotaForDepartment, weekdayLabelTh, WEEKDAY_SHORT_TH } from "@/modules/report_task/lib/routine-dayoff";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useProjectTopicStore } from "@/modules/report_task/store/project-topic-store";
import type { Attachment, CalendarEvent, ChecklistItem, LeaveType, Task, TaskPriority } from "@/modules/report_task/types";
import { cn } from "@/modules/report_task/lib/utils";
import { todayIso } from "@/modules/report_task/lib/now";
import { formatFileSize, formatDate } from "@/modules/report_task/lib/format";
import { uploadTaskAttachment } from "@/modules/report_task/lib/task-attachment-upload";
import {
  Type,
  User,
  Building2,
  Flag,
  Clock,
  CalendarDays,
  AlignLeft,
  Users,
  MapPin,
  Video,
  ListChecks,
  Check,
  Plane,
  Tag,
  Repeat,
  AlarmClockOff,
  CalendarSearch,
  CalendarOff,
  Paperclip,
  Image as ImageIcon,
  FileText,
  X,
  Loader2,
  Star,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { AttachMenu } from "@/modules/report_task/components/shared/attach-menu";
import { uuid } from "@/modules/report_task/lib/uuid";

type ItemType = "task" | "meeting" | "leave" | "dayoff";

/**
 * Shift a YYYY-MM-DD date forward by `days` — used by the "กำหนดส่งไว +N วัน"
 * quick-pick buttons. Built and mutated entirely via UTC (construction +
 * setUTC*), matching how date-only fields are anchored elsewhere — mixing
 * local setDate() with a UTC read back (toISOString) rolls the result a day
 * off for non-zero UTC offsets.
 */
function shiftDate(dateStr: string, days: number) {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function hhmm(iso: string) {
  return new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * Scheduling-assistant-style availability, one row per attendee — meeting
 * overlaps are checked against the exact picked time; leave/holiday/routine
 * days off block the whole day (none of those record partial-day hours as
 * structured data, only as free text in the title, so "touches this date"
 * is the best signal available).
 */
function attendeeAvailabilityFor(params: {
  attendeeIds: string[];
  date: string;
  start: string;
  end: string;
  allDay: boolean;
  existingMeetings: CalendarEvent[];
  existingLeaves: CalendarEvent[];
  leaveTypes: { id: string; label: string }[];
  holidays: CalendarEvent[];
  routinePickedDates: Record<string, string[]>;
  routineRules: { id: string; userId: string; weekday: number; startDate: string; endDate?: string }[];
  routineRuleExceptions: Record<string, string>;
}): { userId: string; name: string; busy: boolean; reasons: string[] }[] {
  const {
    attendeeIds,
    date,
    start,
    end,
    allDay,
    existingMeetings,
    existingLeaves,
    leaveTypes,
    holidays,
    routinePickedDates,
    routineRules,
    routineRuleExceptions,
  } = params;
  if (attendeeIds.length === 0 || !date) return [];
  const newStart = new Date(allDay ? `${date}T00:00:00` : `${date}T${start}:00`);
  const newEnd = new Date(allDay ? `${date}T23:59:59` : `${date}T${end}:00`);
  const timeValid = newEnd > newStart;

  return attendeeIds.map((uid) => {
    const reasons: string[] = [];
    if (timeValid) {
      for (const m of existingMeetings) {
        if (!m.attendeeIds?.includes(uid)) continue;
        const mStart = new Date(m.start);
        const mEnd = new Date(m.end ?? m.start);
        if (mStart >= newEnd || mEnd <= newStart) continue;
        reasons.push(`ประชุม "${m.title}" ${m.allDay ? "ทั้งวัน" : `${hhmm(m.start)}-${hhmm(m.end ?? m.start)}`}`);
      }
    }
    for (const l of existingLeaves) {
      if (l.userId !== uid) continue;
      if (date < l.start.slice(0, 10) || date >= (l.end ?? l.start).slice(0, 10)) continue;
      reasons.push(leaveTypes.find((t) => t.id === l.leaveType)?.label ?? l.leaveType ?? "ลา");
    }
    const attendeeDeptId = getUser(uid)?.departmentId;
    for (const h of holidays) {
      if (date < h.start.slice(0, 10) || date >= h.end.slice(0, 10)) continue;
      if (h.departmentIds && h.departmentIds.length > 0 && !h.departmentIds.includes(attendeeDeptId ?? "")) continue;
      reasons.push(h.title);
    }
    const hasRoutineDayOff =
      (routinePickedDates[uid] ?? []).includes(date) ||
      routineRules.some((r) => r.userId === uid && expandRule(r, routineRuleExceptions, date.slice(0, 7)).includes(date));
    if (hasRoutineDayOff) reasons.push("วันหยุดประจำ");

    return { userId: uid, name: getUser(uid)?.name ?? "คนหนึ่ง", busy: reasons.length > 0, reasons };
  });
}

/**
 * Turn picked File objects into real, uploaded Attachment records (same
 * /api/report-task/uploads path as the task detail sheet's attach flow —
 * see task-attachment-upload.ts). A single bad file (unsupported type, over
 * the org's size limit) shouldn't block creating the task/meeting with
 * everything else that did upload, so failures are toasted individually and
 * just dropped from the result instead of rejecting the whole batch.
 */
async function buildAttachments(files: File[], uploadedBy: string): Promise<Attachment[]> {
  const results: Attachment[] = [];
  for (const file of files) {
    try {
      results.push(await uploadTaskAttachment(file, uploadedBy));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `แนบไฟล์ "${file.name}" ไม่สำเร็จ`);
    }
  }
  return results;
}

const typeMeta: Record<ItemType, { label: string; icon: React.ElementType }> = {
  task: { label: "งาน", icon: ListChecks },
  meeting: { label: "ประชุม", icon: Users },
  leave: { label: "วันลา", icon: Plane },
  dayoff: { label: "วันหยุดประจำ", icon: CalendarOff },
};

// One field row with an Outlook-style leading icon.
function Row({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon className="h-4.5 w-4.5 text-[var(--ink-soft)] mt-2 shrink-0" />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

export function NewTaskDialog({
  open,
  onOpenChange,
  defaultType = "task",
  allowedTypes: allowedTypesProp = ["task", "meeting"],
  defaultDate,
  defaultTitle,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultType?: ItemType;
  allowedTypes?: ItemType[];
  /** Pre-fill the date fields (YYYY-MM-DD), e.g. when opened from a calendar day. */
  defaultDate?: string;
  /** Pre-fill the title field — e.g. "เปิดเป็นงาน" from a report post seeds it with the post's title. */
  defaultTitle?: string;
  /** Fires with the new task's id right after a task (not meeting/leave) is created — lets a caller that opened this dialog for a specific purpose (e.g. linking a report post to the task it spawned) follow up without guessing the id. */
  onCreated?: (taskId: string) => void;
}) {
  const addTask = useTaskStore((s) => s.addTask);
  const addMeeting = useMeetingStore((s) => s.addMeeting);
  const existingMeetings = useMeetingStore((s) => s.meetings);
  const addLeave = useLeaveStore((s) => s.addLeave);
  const existingLeaves = useLeaveStore((s) => s.leaves);
  const holidays = useHolidayStore((s) => s.holidays);
  const routinePickedDates = useRoutineDayOffStore((s) => s.pickedDates);
  const routineRules = useRoutineDayOffStore((s) => s.rules);
  const routineRuleExceptions = useRoutineDayOffStore((s) => s.ruleExceptions);
  const addRoutinePickedDate = useRoutineDayOffStore((s) => s.addPickedDate);
  const addRoutineRule = useRoutineDayOffStore((s) => s.addRule);
  const routineCompanyQuota = useRoutineDayOffStore((s) => s.companyMonthlyQuota);
  const routineUseDeptOverrides = useRoutineDayOffStore((s) => s.useDepartmentOverrides);
  const routineDeptQuotas = useRoutineDayOffStore((s) => s.departmentQuotas);
  const notifyMany = useNotificationStore((s) => s.notifyMany);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const projectTopics = useProjectTopicStore((s) => s.topics);
  const addProjectTopic = useProjectTopicStore((s) => s.addTopic);
  const [selectedTopicId, setSelectedTopicId] = useState<string>("none");
  const [creatingTopic, setCreatingTopic] = useState(false);
  const [newTopicName, setNewTopicName] = useState("");
  const leaveTypes = useLeaveTypeStore((s) => s.types);
  const assignedByUser = getUser(viewingAsUserId)!;
  // Scheduling a meeting pulls other people's calendars into it — a
  // department head/owner call, not something a regular employee can do.
  const allowedTypes = canManage(viewingAsUserId) ? allowedTypesProp : allowedTypesProp.filter((t) => t !== "meeting");
  // Who a task can be assigned to: anyone in the company, regardless of who's
  // creating it or which department they're in — cross-team hand-offs are a
  // normal part of how work moves here ("เอาให้ทุกคนแอดงานได้").
  const pickableAssignees = users;

  // When opened from a calendar day, dates start on that day (remounted via key
  // in the parent, so the initializers below pick it up cleanly).
  const initialDate = defaultDate ?? todayIso();

  const [rawType, setItemType] = useState<ItemType>(defaultType);
  // Clamp to the currently-allowed types (e.g. leave only on the leave calendar).
  const itemType: ItemType = allowedTypes.includes(rawType) ? rawType : allowedTypes[0]!;

  // Shared
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  // Task fields — department auto-derives from the primary (first) assignee.
  // Starts empty rather than defaulting to someone (previously always
  // users[0], not even the person creating the task) — auto-assigning is
  // presumptuous, and picking a name is a deliberate call every time.
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [startDate, setStartDate] = useState(initialDate);
  const [dueDate, setDueDate] = useState(initialDate);
  const [dueTime, setDueTime] = useState("");
  // Hidden behind "+ ใส่เวลา" by default — most tasks don't set one, so it
  // stays out of the way until asked for. `dueTime` already being set (rare
  // here since this dialog always starts blank, but kept for consistency)
  // keeps it open instead of hiding a value the user just typed.
  const [showDueTime, setShowDueTime] = useState(false);
  const derivedDepartmentIds = departmentIdsOf(assigneeIds);

  // "หัวข้อโปรเจค" ในตัวเลือกขั้นสูงด้านล่าง — เดิมเป็นลิสต์รวมทั้งบริษัทเสมอ
  // ("PV-5th", "Sales Report -A/R", "MM", "tttt" ปนกันหมดไม่ว่าใครเปิดฟอร์ม)
  // ProjectTopic เองไม่มีฟิลด์แผนกให้ผูกไว้ (เป็น tag กลาง ใช้ข้ามแผนกได้ตั้งใจ
  // — ดู project-topic-store.ts) จึงต้องอนุมานว่า "หัวข้อนี้แผนกไหนเคยใช้บ้าง"
  // จากงานที่มีอยู่จริงแทน: มีงานที่ departmentIds ตรงกับแผนกที่ derive มาจาก
  // ผู้รับผิดชอบที่เลือกไว้ และหัวข้อนั้น ๆ ก็ถือว่า "อยู่ในแผนกนี้" ("เลือกก่อนว่า
  // แผนกไหน แล้ว filter ว่าแผนกนั้นมีโปรเจคอะไร") ยังไม่เลือกผู้รับผิดชอบเลย
  // (derivedDepartmentIds ว่าง) ก็โชว์ทุกหัวข้อเหมือนเดิม ไม่บังคับให้เลือกคนก่อน
  const allTasksForTopicScope = useTaskStore((s) => s.tasks);
  const departmentTopicIds = useMemo(() => {
    if (derivedDepartmentIds.length === 0) return null;
    const ids = new Set<string>();
    for (const t of allTasksForTopicScope) {
      if (t.projectTopicId && t.departmentIds.some((d) => derivedDepartmentIds.includes(d))) ids.add(t.projectTopicId);
    }
    return ids;
    // derivedDepartmentIds is a fresh array every render (departmentIdsOf(assigneeIds)),
    // but its contents only actually change when assigneeIds does — depend on that instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assigneeIds, allTasksForTopicScope]);
  // เผื่อคนเลือกหัวข้อไว้ก่อนแล้วค่อยเปลี่ยนผู้รับผิดชอบทีหลัง — ตัวที่เลือกไว้
  // แล้วยังต้องโผล่ในลิสต์เสมอ ต่อให้ไม่ตรงแผนกใหม่แล้วก็ตาม ไม่งั้นค่าที่เลือกไว้
  // จะหายไปจากตัวเลือกแบบไม่มีปี่มีขลุ่ย
  const visibleProjectTopics = departmentTopicIds
    ? projectTopics.filter((t) => departmentTopicIds.has(t.id) || t.id === selectedTopicId)
    : projectTopics;
  const departmentNamesForTopicHint =
    "แผนก" +
    derivedDepartmentIds
      .map((id) => getDepartment(id)?.name)
      .filter((name): name is string => !!name)
      .join("/");

  // งานเดี่ยว/งานกลุ่ม — explicit, chosen at creation (not re-derived from
  // assigneeIds.length later). Individual locks the assignee picker to one
  // person; group allows multi-select.
  const [taskMode, setTaskMode] = useState<"individual" | "group">("individual");
  // งานกลุ่ม: ปิดงานเมื่อครบทุกคน (ค่าเดิม) หรือคนใดคนหนึ่งเสร็จก็พอ
  const [completionRule, setCompletionRule] = useState<"all" | "any">("all");
  // ตัวเลือกขั้นสูง (เช็คลิสต์ · เดี่ยว/กลุ่ม · หัวข้อโปรเจค · ไฟล์แนบ) — เริ่มพับไว้ทุกครั้ง ไม่จำโหมดล่าสุด
  const [showAdvanced, setShowAdvanced] = useState(false);
  // ติ๊ก "มีเช็คลิสต์" ถึงจะเห็นช่องเพิ่มรายการ — ไม่ติ๊ก = ไม่มีเช็คลิสต์ ไม่กินที่
  const [useChecklist, setUseChecklist] = useState(false);
  // Point person on a group task — display-only label, optional even then.
  const [mainAssigneeId, setMainAssigneeId] = useState<string>("");
  // Staged files/images — uploaded for real (see buildAttachments) only once
  // the task is actually created, same as meetFiles below.
  const [taskFiles, setTaskFiles] = useState<File[]>([]);
  // Every task needs at least one checklist item — an assignee's part is
  // done once every item they own is checked (see task-completion.ts).
  const [checklistItems, setChecklistItems] = useState<{ id: string; text: string; ownerId: string }[]>([]);
  const [newChecklistText, setNewChecklistText] = useState("");
  const [newChecklistOwnerId, setNewChecklistOwnerId] = useState("");
  // Group-only, opt-in per-assignee due date override — sparse by design,
  // only people who diverge from the shared due date get an entry.
  const [useAssigneeDueDates, setUseAssigneeDueDates] = useState(false);
  const [assigneeDueDateOverrides, setAssigneeDueDateOverrides] = useState<Record<string, string>>({});

  // Meeting fields
  const [meetAttendeeIds, setMeetAttendeeIds] = useState<string[]>([]);
  // Department is derived from attendees — pick people, the department(s) follow.
  const meetDeptIds = departmentIdsOf(meetAttendeeIds);
  const [meetDate, setMeetDate] = useState(initialDate);
  const [meetStart, setMeetStart] = useState("10:00");
  const [meetEnd, setMeetEnd] = useState("11:00");
  const [meetLocation, setMeetLocation] = useState("");
  const [meetOnline, setMeetOnline] = useState(false);
  const [meetAllDay, setMeetAllDay] = useState(false);
  // Staged files/images — uploaded for real (see buildAttachments) only once
  // the meeting is actually created, so a cancelled dialog never uploads
  // anything.
  const [meetFiles, setMeetFiles] = useState<File[]>([]);

  // Scheduling-assistant-style availability, one row per attendee — replaces
  // the old "double-booking only" conflict check with the fuller picture
  // (meetings + leave + holiday + routine days off), same idea as Outlook's
  // Scheduling Assistant. Informational only — some overlaps are legitimate
  // (a quick sync during a standing block), so it warns rather than blocks.
  const attendeeAvailability = useMemo(
    () =>
      attendeeAvailabilityFor({
        attendeeIds: meetAttendeeIds,
        date: meetDate,
        start: meetStart,
        end: meetEnd,
        allDay: meetAllDay,
        existingMeetings,
        existingLeaves,
        leaveTypes,
        holidays,
        routinePickedDates,
        routineRules,
        routineRuleExceptions,
      }),
    [
      meetAttendeeIds,
      meetDate,
      meetStart,
      meetEnd,
      meetAllDay,
      existingMeetings,
      existingLeaves,
      leaveTypes,
      holidays,
      routinePickedDates,
      routineRules,
      routineRuleExceptions,
    ]
  );

  // Leave fields
  const [leaveUserId, setLeaveUserId] = useState(viewingAsUserId);
  const [leaveType, setLeaveType] = useState<LeaveType>(leaveTypes[0]?.id ?? "vacation");
  const [leaveStart, setLeaveStart] = useState(initialDate);
  const [leaveEnd, setLeaveEnd] = useState(initialDate);
  // A specific time range only makes sense for a single-day leave (e.g. a
  // half-day) — a multi-day request stays all-day regardless of this toggle.
  const [leaveAllDay, setLeaveAllDay] = useState(true);
  const [leaveStartTime, setLeaveStartTime] = useState("09:00");
  const [leaveEndTime, setLeaveEndTime] = useState("13:00");

  // Routine day-off fields — a second entry point into the same feature as
  // the calendar sidebar's "วันหยุดประจำของฉัน" card (same store actions,
  // same quota rules), for whoever doesn't have that sidebar open or just
  // expects every schedule item to be creatable from one dialog.
  const [dayoffDate, setDayoffDate] = useState(initialDate);
  const [dayoffRecurring, setDayoffRecurring] = useState(false);
  const [dayoffWeekdays, setDayoffWeekdays] = useState<Set<number>>(new Set());
  const [dayoffUntil, setDayoffUntil] = useState("");

  const myRoutinePicked = routinePickedDates[viewingAsUserId] ?? [];
  const myRoutineQuota = quotaForDepartment(
    getUser(viewingAsUserId)?.departmentId,
    routineCompanyQuota,
    routineDeptQuotas,
    routineUseDeptOverrides
  );
  const dayoffTargetMonth = dayoffDate.slice(0, 7);
  // Deduped by date (a rule's occurrence can land on the same date as a
  // manual pick, or two rules can overlap) — feeds both the displayed "used
  // this month" count and the recurring-rule quota preview below, so neither
  // one double-counts a day that's already accounted for.
  const myEffectiveDatesThisMonth = Array.from(
    new Set([
      ...myRoutinePicked.filter((d) => d.slice(0, 7) === dayoffTargetMonth),
      ...routineRules
        .filter((r) => r.userId === viewingAsUserId)
        .flatMap((r) => expandRule(r, routineRuleExceptions, dayoffTargetMonth)),
    ])
  );
  const myRoutineUsedThisMonth = myEffectiveDatesThisMonth.length;

  // Annual quota check — days already taken this year (of this type, by this
  // person) plus what this request would add, against the type's configured
  // quota (undefined quota = unlimited, nothing to check). Doesn't account
  // for existing half-day leaves precisely (they're stored as a normal 1-day
  // span with the hours only noted in the title) — close enough for a warning,
  // not exact accounting.
  const requestedLeaveDays = useMemo(() => {
    if (leaveStart === leaveEnd && !leaveAllDay) return 0.5;
    const days = Math.round((new Date(`${leaveEnd}T00:00:00Z`).getTime() - new Date(`${leaveStart}T00:00:00Z`).getTime()) / 86400000) + 1;
    return Math.max(days, 0);
  }, [leaveStart, leaveEnd, leaveAllDay]);
  const usedLeaveDays = useMemo(() => {
    const year = new Date(`${leaveStart}T00:00:00`).getFullYear();
    return existingLeaves
      .filter((l) => l.userId === leaveUserId && l.leaveType === leaveType && new Date(l.start).getFullYear() === year)
      .reduce((sum, l) => sum + Math.round((new Date(l.end).getTime() - new Date(l.start).getTime()) / 86400000), 0);
  }, [existingLeaves, leaveUserId, leaveType, leaveStart]);
  const activeLeaveType = leaveTypes.find((t) => t.id === leaveType);
  const leaveQuota = activeLeaveType?.quotaMode === "annual" ? activeLeaveType.annualQuota : undefined;
  const leaveExceedsQuota = leaveQuota !== undefined && usedLeaveDays + requestedLeaveDays > leaveQuota;

  // Monthly accrual status — as of the leave's start month, including this
  // request's days as if already taken, so the banner reflects what balance
  // would remain after submitting.
  const monthlyStatus = useMemo(() => {
    if (activeLeaveType?.quotaMode !== "monthly") return null;
    const usage = existingLeaves
      .filter((l) => l.userId === leaveUserId && l.leaveType === leaveType)
      .map((l) => ({
        date: l.start,
        days: Math.round((new Date(l.end).getTime() - new Date(l.start).getTime()) / 86400000),
      }));
    usage.push({ date: leaveStart, days: requestedLeaveDays });
    const grant =
      activeLeaveType.monthlySource === "country"
        ? countryHolidayGrantResolver(holidays, activeLeaveType.holidayCountryCode ?? THAI_SOURCE, activeLeaveType.monthlyGrantOverrides)
        : activeLeaveType.monthlyGrant ?? 0;
    return computeMonthlyLeaveStatus(grant, activeLeaveType.expiryMonths, usage, new Date(`${leaveStart}T00:00:00`));
  }, [activeLeaveType, existingLeaves, leaveUserId, leaveType, leaveStart, requestedLeaveDays, holidays]);
  const monthlyExceeds = monthlyStatus !== null && monthlyStatus.availableNow < 0;

  // Mirrors handleSubmit's toast-and-return checks below, minus the toasts —
  // used to visibly disable the submit button instead of only rejecting the
  // click after the fact (report composer already does this; this dialog
  // didn't, which read as inconsistent between the two forms).
  const canSubmit = useMemo(() => {
    if (itemType !== "leave" && itemType !== "dayoff" && !title.trim()) return false;
    if (itemType === "task" && assigneeIds.length === 0) return false;
    if (itemType === "task" && dueDate < startDate) return false;
    if (itemType === "meeting" && !meetAllDay && meetEnd <= meetStart) return false;
    if (itemType === "leave") {
      if (leaveEnd < leaveStart) return false;
      if (leaveStart === leaveEnd && !leaveAllDay && leaveEndTime <= leaveStartTime) return false;
      const newEndExclusive = new Date(`${leaveEnd}T00:00:00Z`);
      newEndExclusive.setUTCDate(newEndExclusive.getUTCDate() + 1);
      const overlap = existingLeaves.some(
        (l) => l.userId === leaveUserId && leaveStart < l.end.slice(0, 10) && l.start < newEndExclusive.toISOString().slice(0, 10)
      );
      if (overlap || leaveExceedsQuota || monthlyExceeds) return false;
    }
    return true;
  }, [
    itemType,
    title,
    assigneeIds,
    checklistItems,
    dueDate,
    startDate,
    meetAllDay,
    meetEnd,
    meetStart,
    leaveEnd,
    leaveStart,
    leaveAllDay,
    leaveEndTime,
    leaveStartTime,
    existingLeaves,
    leaveUserId,
    leaveExceedsQuota,
    monthlyExceeds,
  ]);

  function reset() {
    setTitle("");
    setDescription("");
    setAssigneeIds([]);
    setPriority("medium");
    setStartDate(initialDate);
    setDueDate(initialDate);
    setTaskMode("individual");
    setShowAdvanced(false);
    setMainAssigneeId("");
    setTaskFiles([]);
    setChecklistItems([]);
    setUseChecklist(false);
    setNewChecklistText("");
    setNewChecklistOwnerId("");
    setUseAssigneeDueDates(false);
    setAssigneeDueDateOverrides({});
    setMeetAttendeeIds([]);
    setMeetDate(initialDate);
    setMeetStart("10:00");
    setMeetEnd("11:00");
    setMeetLocation("");
    setMeetOnline(false);
    setMeetAllDay(false);
    setMeetFiles([]);
    setLeaveUserId(viewingAsUserId);
    setLeaveType(leaveTypes[0]?.id ?? "vacation");
    setLeaveStart(initialDate);
    setLeaveEnd(initialDate);
    setLeaveAllDay(true);
    setLeaveStartTime("09:00");
    setLeaveEndTime("13:00");
    setDayoffDate(initialDate);
    setDayoffRecurring(false);
    setDayoffWeekdays(new Set());
    setDayoffUntil("");
  }

  async function createTask() {
    // ไฟล์ที่แนบตอนสั่งงานเป็นของผู้สั่งงานเสมอ (แม้สั่งงานให้ตัวเอง) — ไม่ให้ไปนับเป็น "ไฟล์ส่งงาน"
    const attachments = (await buildAttachments(taskFiles, viewingAsUserId)).map((a) => ({ ...a, role: "brief" as const }));
    const now = new Date().toISOString();
    const checklist: ChecklistItem[] = checklistItems.map((c) => ({
      id: `task-chk-${uuid()}`,
      text: c.text,
      done: false,
      ownerId: c.ownerId || assigneeIds[0],
    }));
    // Only keep overrides for assignees still picked and whose date actually
    // diverges from the shared due date — keeps the field sparse.
    const assigneeDueDates =
      taskMode === "group"
        ? Object.fromEntries(
            Object.entries(assigneeDueDateOverrides).filter(
              ([uid, d]) => assigneeIds.includes(uid) && d && d !== dueDate
            )
          )
        : {};
    const task: Task = {
      // Two people creating a task in the same millisecond would otherwise
      // collide, and with the file-backed store's whole-collection
      // write-through, a colliding id means one task silently overwrites
      // the other.
      id: `task-${uuid()}`,
      title: title.trim(),
      description: description.trim(),
      status: "todo",
      priority,
      taskMode,
      assigneeIds,
      ...(taskMode === "group" && mainAssigneeId && assigneeIds.includes(mainAssigneeId) ? { mainAssigneeId } : {}),
      ...(taskMode === "group" && assigneeIds.length > 1 && completionRule === "any" ? { completionRule: "any" as const } : {}),
      assignedById: viewingAsUserId,
      departmentIds: derivedDepartmentIds,
      startDate: new Date(startDate).toISOString(),
      dueDate: new Date(dueDate).toISOString(),
      originalDueDate: new Date(dueDate).toISOString(),
      ...(dueTime ? { dueTime } : {}),
      ...(Object.keys(assigneeDueDates).length > 0 ? { assigneeDueDates } : {}),
      attachments,
      comments: [],
      revisions: [],
      reactions: [],
      checklist,
      completedAssigneeIds: [],
      showChecklistOnCard: false,
      ...(selectedTopicId !== "none" ? { projectTopicId: selectedTopicId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    addTask(task);
    toast.success("สร้างงานเรียบร้อยแล้ว");
    onCreated?.(task.id);
  }

  async function createMeeting() {
    const attachments = await buildAttachments(meetFiles, viewingAsUserId);
    const meeting: CalendarEvent = {
      id: `meet-${uuid()}`,
      title: title.trim(),
      type: "meeting",
      start: meetAllDay ? meetDate : `${meetDate}T${meetStart}:00`,
      end: meetAllDay ? meetDate : `${meetDate}T${meetEnd}:00`,
      allDay: meetAllDay,
      departmentId: meetDeptIds[0],
      departmentIds: meetDeptIds,
      attendeeIds: meetAttendeeIds,
      createdById: viewingAsUserId,
      location: meetOnline ? "ออนไลน์ (Teams/Zoom)" : meetLocation.trim() || "ไม่ระบุสถานที่",
      description: description.trim(),
      attachments,
    };
    addMeeting(meeting);
    if (meetAttendeeIds.length > 0) {
      notifyMany(meetAttendeeIds, viewingAsUserId, `${assignedByUser.name} แท็กคุณในประชุม "${title.trim()}"`);
    }
    toast.success("สร้างประชุมเรียบร้อยแล้ว");
  }

  function createLeave() {
    const user = getUser(leaveUserId);
    // FullCalendar's all-day end is exclusive, so add a day to the end date.
    // UTC throughout — see shiftDate above for why.
    const endExclusive = new Date(`${leaveEnd}T00:00:00Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    // A half-day (specific time range) only applies to a single-day leave —
    // stays `allDay: true`/date-only in storage either way (every date-range
    // check elsewhere — inRange, isPastEvent, the leave sidebar — assumes
    // that shape), the chosen hours just ride along in the title so it's
    // still informative without adding a second time representation to sort out.
    const isHalfDay = !leaveAllDay && leaveStart === leaveEnd;
    const leaveLabel = leaveTypes.find((t) => t.id === leaveType)?.label ?? "ลา";
    const leave: CalendarEvent = {
      id: `leave-${uuid()}`,
      title: `${user?.name.split(" ")[0]} - ${leaveLabel}${isHalfDay ? ` (${leaveStartTime}-${leaveEndTime})` : ""}`,
      type: "leave",
      start: leaveStart,
      end: endExclusive.toISOString().slice(0, 10),
      allDay: true,
      userId: leaveUserId,
      leaveType,
      description: description.trim(),
    };
    addLeave(leave);
    toast.success("บันทึกวันลาเรียบร้อยแล้ว");
  }

  // Same two flows as the calendar sidebar's "วันหยุดประจำของฉัน" card — a
  // one-off pick, or a weekly recurring rule — reusing the exact same store
  // actions and quota logic so behavior can't drift between the two entry
  // points.
  function createDayoffOnce() {
    if (myRoutineUsedThisMonth >= myRoutineQuota) {
      toast.error(`ครบโควตา ${myRoutineQuota} วัน/เดือนของเดือนนี้แล้ว`);
      return;
    }
    if (myRoutinePicked.includes(dayoffDate)) {
      toast.error("เลือกวันนี้ไว้แล้ว");
      return;
    }
    addRoutinePickedDate(viewingAsUserId, dayoffDate);
    toast.success("เพิ่มวันหยุดประจำแล้ว");
  }

  function createDayoffRecurring() {
    if (dayoffWeekdays.size === 0) {
      toast.error("เลือกวันในสัปดาห์อย่างน้อย 1 วัน");
      return;
    }
    if (dayoffUntil && dayoffUntil < dayoffDate) {
      toast.error("วันที่สิ้นสุดต้องอยู่หลังวันเริ่ม");
      return;
    }
    const myExistingRules = routineRules.filter((r) => r.userId === viewingAsUserId);
    const alreadyCovered = Array.from(dayoffWeekdays).filter((weekday) => myExistingRules.some((r) => r.weekday === weekday));
    if (alreadyCovered.length > 0) {
      toast.error(`มีรูทีนวัน${alreadyCovered.map(weekdayLabelTh).join(", ")}อยู่แล้ว เลือกวันอื่นหรือลบรูทีนเดิมก่อน`);
      return;
    }
    const projectedTotal = projectedRoutineQuotaTotal(
      Array.from(dayoffWeekdays),
      dayoffDate,
      dayoffUntil || undefined,
      dayoffTargetMonth,
      myEffectiveDatesThisMonth
    );
    if (projectedTotal > myRoutineQuota) {
      toast.error(`รูทีนนี้จะทำให้เดือนนี้เกินโควตา ${myRoutineQuota} วัน/เดือน (จะมี ${projectedTotal} วัน)`);
      return;
    }
    dayoffWeekdays.forEach((weekday) => addRoutineRule(viewingAsUserId, weekday, "กำหนดเอง", dayoffDate, undefined, dayoffUntil || undefined));
    toast.success(`ตั้งวันหยุดประจำทำซ้ำทุก${Array.from(dayoffWeekdays).map(weekdayLabelTh).join(", ")} แล้ว`);
  }

  function toggleAssignee(userId: string) {
    if (taskMode === "individual") {
      setAssigneeIds((prev) => (prev[0] === userId ? [] : [userId]));
      return;
    }
    setAssigneeIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  function changeTaskMode(mode: "individual" | "group") {
    setTaskMode(mode);
    if (mode === "individual" && assigneeIds.length > 1) {
      setAssigneeIds((prev) => prev.slice(0, 1));
    }
    setUseAssigneeDueDates(false);
    setAssigneeDueDateOverrides({});
    setCompletionRule("all");
  }

  function addChecklistDraft() {
    const text = newChecklistText.trim();
    if (!text) return;
    const ownerId = taskMode === "individual" ? (assigneeIds[0] ?? "") : newChecklistOwnerId || assigneeIds[0] || "";
    setChecklistItems((prev) => [...prev, { id: `draft-${uuid()}`, text, ownerId }]);
    setNewChecklistText("");
  }

  function removeChecklistDraft(id: string) {
    setChecklistItems((prev) => prev.filter((c) => c.id !== id));
  }

  // Any of these being filled in means closing the dialog would throw away
  // real work, so a plain click on "ยกเลิก"/overlay/Esc must be confirmed.
  const isDirty =
    title.trim() !== "" ||
    description.trim() !== "" ||
    assigneeIds.length > 0 ||
    checklistItems.length > 0 ||
    (itemType === "meeting" && meetLocation.trim() !== "");

  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  function requestClose(nextOpen: boolean) {
    if (!nextOpen && isDirty) {
      setConfirmDiscardOpen(true);
      return;
    }
    onOpenChange(nextOpen);
  }

  function discardAndClose() {
    setConfirmDiscardOpen(false);
    onOpenChange(false);
  }

  function confirmCreateProjectTopic() {
    const name = newTopicName.trim();
    if (!name) return;
    const id = addProjectTopic(name);
    setSelectedTopicId(id);
    setNewTopicName("");
    setCreatingTopic(false);
    toast.success(`สร้างหัวข้อโปรเจค "${name}" แล้ว`);
  }

  async function handleSubmit() {
    // A ref (not just the `submitting` state used for the button's disabled
    // look) so two clicks dispatched before React re-renders still can't
    // both get past this point — state only becomes visible on the next
    // render, a ref is visible to the very next synchronous call.
    if (submittingRef.current) return;
    if (itemType !== "leave" && itemType !== "dayoff" && !title.trim()) {
      toast.error(itemType === "task" ? "กรุณากรอกชื่องาน" : "กรุณากรอกหัวข้อประชุม");
      return;
    }
    if (itemType === "task" && assigneeIds.length === 0) {
      toast.error("กรุณาเลือกผู้รับผิดชอบอย่างน้อย 1 คน");
      return;
    }
    if (itemType === "task" && dueDate < startDate) {
      toast.error("กำหนดส่งต้องไม่ก่อนวันเริ่มต้น");
      return;
    }
    if (itemType === "meeting" && !meetAllDay && meetEnd <= meetStart) {
      toast.error("เวลาสิ้นสุดต้องหลังเวลาเริ่ม");
      return;
    }
    if (itemType === "leave" && leaveEnd < leaveStart) {
      toast.error("วันสิ้นสุดต้องไม่ก่อนวันเริ่ม");
      return;
    }
    if (itemType === "leave" && leaveStart === leaveEnd && !leaveAllDay && leaveEndTime <= leaveStartTime) {
      toast.error("เวลาสิ้นสุดต้องหลังเวลาเริ่ม");
      return;
    }
    if (itemType === "leave") {
      // Same-person date-range overlap — computed the same exclusive-end way
      // createLeave() stores it (see endExclusive there), so a leave that
      // butts right up against an existing one (ends the day it starts) isn't
      // flagged as an overlap.
      const newEndExclusive = new Date(`${leaveEnd}T00:00:00Z`);
      newEndExclusive.setUTCDate(newEndExclusive.getUTCDate() + 1);
      const overlap = existingLeaves.some(
        (l) => l.userId === leaveUserId && leaveStart < l.end.slice(0, 10) && l.start < newEndExclusive.toISOString().slice(0, 10)
      );
      if (overlap) {
        toast.error("ช่วงวันนี้มีการลาอยู่แล้ว");
        return;
      }
      if (leaveExceedsQuota) {
        toast.error(`เกินโควตาวันลาต่อปี (คงเหลือ ${Math.max(leaveQuota! - usedLeaveDays, 0)} วัน)`);
        return;
      }
      if (monthlyExceeds) {
        toast.error(`เกินโควตาวันลาคงเหลือ (ขาดอยู่ ${Math.abs(monthlyStatus!.availableNow)} วัน)`);
        return;
      }
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (itemType === "meeting") await createMeeting();
      else if (itemType === "task") await createTask();
      else if (itemType === "leave") createLeave();
      else if (dayoffRecurring) createDayoffRecurring();
      else createDayoffOnce();
      reset();
      onOpenChange(false);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  // เช็คลิสต์ (ไม่บังคับ)
  const checklistOn = useChecklist || checklistItems.length > 0;
  const renderChecklistRow = () => (
      <Row icon={ListChecks}>
        <div className="space-y-1.5">
          <label className="flex w-fit cursor-pointer items-center gap-2 py-1.5 text-sm">
            <Checkbox
              checked={checklistOn}
              onCheckedChange={(v) => {
                setUseChecklist(!!v);
                // เอาติ๊กออก = ไม่มีเช็คลิสต์ — ล้างรายการที่พิมพ์ค้างไว้ด้วย ไม่ให้ส่งไปโดยที่มองไม่เห็น
                if (!v) {
                  setChecklistItems([]);
                  setNewChecklistText("");
                }
              }}
              aria-label="มีเช็คลิสต์"
            />
            <span className="font-medium">มีเช็คลิสต์</span>
            {checklistOn ? (
              <span className="text-xs text-[var(--ink-soft)]">({checklistItems.length}{taskMode === "group" ? " · แยกตามคน" : ""})</span>
            ) : (
              <span className="text-xs text-[var(--ink-soft)]">ไม่บังคับ — ไม่ติ๊ก = ไม่มีเช็คลิสต์</span>
            )}
          </label>
          {checklistOn && (
          <div className="flex items-center gap-1.5">
            <Input
              value={newChecklistText}
              onChange={(e) => setNewChecklistText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addChecklistDraft();
                }
              }}
              placeholder="เพิ่มรายการเช็คลิสต์..."
              className="flex-1"
            />
            {taskMode === "group" && assigneeIds.length > 1 && (
              <Select value={newChecklistOwnerId || assigneeIds[0]!} onValueChange={(v) => v && setNewChecklistOwnerId(v)}>
                <SelectTrigger className="w-32 shrink-0">
                  <SelectValue>{getUser(newChecklistOwnerId || assigneeIds[0]!)?.name ?? "ผู้รับผิดชอบ"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {assigneeIds.map((uid) => (
                    <SelectItem key={uid} value={uid}>{getUser(uid)?.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button type="button" size="sm" variant="outline" onClick={addChecklistDraft} className="shrink-0">
              เพิ่ม
            </Button>
          </div>
          )}
          {checklistOn && checklistItems.length > 0 && (
            <div className="space-y-1 pt-1">
              {checklistItems.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 text-xs">
                  <span className="flex-1 truncate">{c.text}</span>
                  {taskMode === "group" && (
                    <span className="text-[10px] text-[var(--ink-soft)] shrink-0">{getUser(c.ownerId)?.name}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeChecklistDraft(c.id)}
                    className="text-[var(--ink-soft)] hover:text-[var(--chart-red)] shrink-0"
                    aria-label={`ลบ ${c.text}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Row>
  );

  // งานกลุ่ม: หัวหน้าหลัก + วันครบกำหนดแยกรายคน (ไม่บังคับ) — อยู่ในตัวเลือกขั้นสูง
  const renderGroupExtras = () => {
    const validMainAssigneeId = mainAssigneeId && assigneeIds.includes(mainAssigneeId) ? mainAssigneeId : "";
    return (
      <Row icon={Star}>
        <div className="space-y-1">
          <Label className="text-xs text-[var(--ink-soft)]">งานกลุ่ม (ไม่บังคับ)</Label>
          <div className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] p-2.5">
            {assigneeIds.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs text-[var(--ink-soft)]">หัวหน้าหลัก</span>
                <Select value={validMainAssigneeId || "none"} onValueChange={(v) => setMainAssigneeId(v === "none" ? "" : v ?? "")}>
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue placeholder="ไม่ระบุ">
                      {validMainAssigneeId ? getUser(validMainAssigneeId)?.name : "ไม่ระบุ"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">ไม่ระบุ</SelectItem>
                    {assigneeIds.map((uid) => (
                      <SelectItem key={uid} value={uid}>{getUser(uid)?.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {assigneeIds.length > 0 && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs">ตั้งวันครบกำหนดแยกรายคน</span>
                  <Switch checked={useAssigneeDueDates} onCheckedChange={setUseAssigneeDueDates} />
                </div>
                {useAssigneeDueDates && (
                  <div className="space-y-1.5">
                    {assigneeIds.map((uid) => {
                      const u = getUser(uid);
                      return (
                        <div key={uid} className="flex items-center gap-2">
                          <Avatar className="h-5 w-5 shrink-0">
                            <AvatarImage src={u?.avatarUrl ?? undefined} alt={u?.name} />
                            <AvatarFallback className="text-[8px] bg-white">{u?.avatar}</AvatarFallback>
                          </Avatar>
                          <span className="min-w-0 flex-1 truncate text-xs">{u?.name}</span>
                          <DatePickerField
                            value={assigneeDueDateOverrides[uid] ?? dueDate}
                            minDate={startDate || todayIso()}
                            onChange={(v) => setAssigneeDueDateOverrides((prev) => ({ ...prev, [uid]: v }))}
                            className="h-8 w-36 text-xs"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
            {assigneeIds.length === 0 && (
              <p className="text-[10px] text-[var(--ink-soft)]">เลือกผู้รับผิดชอบก่อน แล้วตัวเลือกจะขึ้นที่นี่</p>
            )}
          </div>
        </div>
      </Row>
    );
  };

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto overflow-x-hidden p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 space-y-3">
          <DialogTitle>
            {allowedTypes.length === 1
              ? (itemType === "leave" ? "บันทึกวันลา" : `สร้าง${typeMeta[itemType].label}`)
              : "สร้างรายการใหม่"}
          </DialogTitle>
          {/* Outlook-style type toggle (only the allowed types) */}
          {allowedTypes.length > 1 && (
            <div className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] p-1 w-fit">
              {allowedTypes.map((t) => {
                const Icon = typeMeta[t].icon;
                return (
                  <button
                    key={t}
                    onClick={() => setItemType(t)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
                      itemType === t ? "bg-white shadow-sm text-[var(--ink)]" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                    )}
                  >
                    <Icon className="h-4 w-4" /> {typeMeta[t].label}
                  </button>
                );
              })}
            </div>
          )}
        </DialogHeader>

        <div className="px-5 py-4 space-y-3 border-t border-[var(--line)] min-w-0">
          {/* Title (task/meeting) */}
          {itemType !== "leave" && itemType !== "dayoff" && (
            <Row icon={Type}>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={itemType === "task" ? "เพิ่มชื่องาน" : "เพิ่มหัวข้อประชุม"}
                className="text-base font-medium border-0 border-b border-[var(--line)] rounded-none px-0 shadow-none focus-visible:ring-0 focus-visible:border-[var(--brand-green)]"
              />
            </Row>
          )}

          {/* Description (shared) — right under the title, before the rest of the fields */}
          {itemType !== "dayoff" && (
            <Row icon={AlignLeft}>
              <div className="space-y-1">
                <Label className="text-xs text-[var(--ink-soft)]">
                  {itemType === "leave" ? "หมายเหตุ" : "รายละเอียด"}
                </Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder={itemType === "task" ? "ต้องทำอะไรบ้าง?" : itemType === "meeting" ? "วาระการประชุม / บันทึก" : "เหตุผลการลา (ถ้ามี)"}
                />
              </div>
            </Row>
          )}

          {itemType === "task" && (
            <>
              {/* เช็คลิสต์ (ไม่บังคับ) — อยู่ใต้รายละเอียดเสมอ (แบบธรรมดา) ไม่ย้ายไปมาตามโหมด */}
              {renderChecklistRow()}
              <Row icon={User}>
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="shrink-0 space-y-1">
                  <Label className="text-xs text-[var(--ink-soft)]">ประเภทงาน</Label>
                  <div className="inline-flex h-9 w-fit items-center gap-0.5 rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] p-0.5">
                    {(["individual", "group"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => changeTaskMode(m)}
                        className={cn(
                          "h-full rounded-md px-3 text-sm font-medium transition-colors",
                          taskMode === m ? "bg-white shadow-sm text-[var(--ink)]" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                        )}
                      >
                        {m === "individual" ? "งานเดี่ยว" : "งานกลุ่ม"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="min-w-[220px] flex-1 space-y-1">
                  <Label className="text-xs text-[var(--ink-soft)]">
                    ผู้รับผิดชอบ {taskMode === "group" ? "(เลือกได้หลายคน)" : "(เลือก 1 คน)"} · {assigneeIds.length} คน
                  </Label>
                  <Popover>
                    <PopoverTrigger
                      render={
                        <button className="w-full flex items-center gap-1.5 flex-wrap border border-[var(--line)] rounded-lg px-2 py-1.5 min-h-9 text-left hover:border-[var(--brand-green)] transition-colors">
                          {assigneeIds.length === 0 ? (
                            <span className="text-sm text-[var(--ink-soft)]">เลือกผู้รับผิดชอบ...</span>
                          ) : (
                            <>
                              {/* Capped, not the full list — this is a closed trigger
                                  (opening it shows everyone); a co-assign of the whole
                                  company shouldn't blow the button up to match. */}
                              {assigneeIds.slice(0, 6).map((id) => {
                                const u = getUser(id);
                                return (
                                  <span key={id} className="flex items-center gap-1 bg-[var(--bg-soft)] rounded-full pl-0.5 pr-2 py-0.5 text-xs">
                                    <Avatar className="h-4 w-4">
                                      <AvatarImage src={u?.avatarUrl ?? undefined} alt={u?.name} />
                                      <AvatarFallback className="text-[8px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{u?.avatar}</AvatarFallback>
                                    </Avatar>
                                    {u?.name}
                                  </span>
                                );
                              })}
                              {assigneeIds.length > 6 && (
                                <span className="text-xs font-medium text-[var(--ink-soft)] px-1">
                                  +{assigneeIds.length - 6} คน
                                </span>
                              )}
                            </>
                          )}
                        </button>
                      }
                    />
                    <PopoverContent align="start" className="w-64 p-1 max-h-64 overflow-y-auto">
                      {pickableAssignees.map((u) => {
                        const selected = assigneeIds.includes(u.id);
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
                              <AvatarImage src={u.avatarUrl ?? undefined} alt={u.name} />
                              <AvatarFallback className="text-[9px] bg-[var(--bg-soft)]">{u.avatar}</AvatarFallback>
                            </Avatar>
                            <span className="flex-1 text-sm truncate">{u.name}</span>
                            <span className="text-[10px] text-[var(--ink-soft)] shrink-0">{getDepartment(u.departmentId)?.name}</span>
                          </button>
                        );
                      })}
                    </PopoverContent>
                  </Popover>
                  <p className="text-[11px] text-[var(--ink-soft)] flex items-center gap-1 pt-0.5 flex-wrap">
                    <Building2 className="h-3 w-3" /> แผนก:{" "}
                    <span className="font-medium text-[var(--ink)]">
                      {derivedDepartmentIds.map((id) => getDepartment(id)?.name).join(", ") || "—"}
                    </span>{" "}
                    (ตามผู้รับผิดชอบ)
                  </p>
                </div>
                </div>
              </Row>

              {/* งานกลุ่ม: บรรทัดเดียว (ปิดงานเมื่อ ...) — หัวหน้าหลัก/วันครบกำหนดรายคนอยู่ในตัวเลือกขั้นสูง */}
              {taskMode === "group" && (() => {
                return (
                  <div className="ml-[30px] -mt-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="shrink-0 text-xs text-[var(--ink-soft)]">ปิดงานเมื่อ</span>
                      <div
                        className="inline-grid min-w-[200px] flex-1 grid-cols-2 gap-0.5 rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] p-0.5 sm:flex-none"
                        title="ครบทุกคน: ทุกคนต้องทำส่วนของตัวเองครบ · คนใดคนหนึ่ง: ใครครบก่อน งานปิดทันที"
                      >
                        {([
                          { v: "all", label: "ครบทุกคน" },
                          { v: "any", label: "คนใดคนหนึ่ง" },
                        ] as const).map((o) => (
                          <button
                            key={o.v}
                            type="button"
                            onClick={() => setCompletionRule(o.v)}
                            className={cn(
                              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                              completionRule === o.v ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                            )}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {completionRule === "any" && (
                      <p className="text-[10px] leading-snug text-[var(--ink-soft)]">ใครทำส่วนของตัวเองครบก่อน งานปิดทันที (ที่เหลือไม่ถูกหักคะแนน)</p>
                    )}

                  </div>
                );
              })()}

              <Row icon={CalendarDays}>
                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3">
                  <div className="space-y-1">
                    <Label className="flex items-center gap-1 text-xs text-[var(--ink-soft)]">
                      <Flag className="h-3 w-3" /> ความสำคัญ
                    </Label>
                    <Select value={priority} onValueChange={(v) => v && setPriority(v as TaskPriority)}>
                      <SelectTrigger className="w-full">
                        <SelectValue>{priorityMeta[priority]?.label ?? ""}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {taskPriorityOrder.map((p) => <SelectItem key={p} value={p}>{priorityMeta[p].label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-[var(--ink-soft)]">วันเริ่มต้น</Label>
                    <DatePickerField
                      value={startDate}
                      minDate={todayIso()}
                      onChange={(v) => {
                        setStartDate(v);
                        // Due date can't trail behind a start date that just moved past it.
                        if (dueDate < v) setDueDate(v);
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-[var(--ink-soft)]">กำหนดส่ง</Label>
                    <DatePickerField value={dueDate} minDate={startDate || todayIso()} onChange={setDueDate} />
                  </div>
                </div>
                {/* กำหนดส่งไว + เวลากำหนดส่ง อยู่แถวเดียวกัน ตัวเล็ก ๆ ประหยัดที่ */}
                <div className="flex items-center justify-between gap-x-3 gap-y-1 mt-1.5 flex-wrap">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] text-[var(--ink-soft)]">กำหนดส่งไว:</span>
                    {[
                      { label: "3 วัน", days: 3 },
                      { label: "7 วัน", days: 7 },
                      { label: "14 วัน", days: 14 },
                      { label: "30 วัน", days: 30 },
                    ].map((p) => (
                      <button
                        key={p.days}
                        type="button"
                        onClick={() => setDueDate(shiftDate(startDate || todayIso(), p.days))}
                        className="rounded border border-[var(--line)] px-1.5 text-[10px] leading-4 text-[var(--ink-soft)] hover:border-[var(--brand-green)] hover:text-[var(--brand-green-dark)] transition-colors shrink-0"
                      >
                        +{p.label}
                      </button>
                    ))}
                  </div>
                  {/* Optional — unset means "แจ้งเตือนก่อนกำหนด" (Settings ▸
                      แจ้งเตือน) can only count whole days, since there's no
                      actual moment to count hours/minutes back from
                      without this. Hidden behind a toggle instead of always
                      showing — see `showDueTime`'s own comment. */}
                  {showDueTime || dueTime ? (
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <TimePickerField
                        value={dueTime}
                        onChange={setDueTime}
                        className="w-full sm:w-[130px]"
                        aria-label="เวลากำหนดส่ง (ไม่บังคับ)"
                        title="เวลากำหนดส่ง (ไม่บังคับ) — ใส่ไว้ถ้าอยากตั้งแจ้งเตือนล่วงหน้าเป็นชั่วโมง/นาทีได้"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setDueTime("");
                          setShowDueTime(false);
                        }}
                        className="shrink-0 text-[11px] text-[var(--ink-soft)] hover:text-[var(--chart-red)] transition-colors"
                      >
                        ล้างเวลา
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowDueTime(true)}
                      className="flex items-center gap-1 text-[11px] text-[var(--ink-soft)] hover:text-[var(--brand-green-dark)] transition-colors pt-0.5"
                    >
                      <Clock className="h-3 w-3" />+ ใส่เวลา
                    </button>
                  )}
                </div>
              </Row>

              {/* แบบธรรมดา = ชื่อ · รายละเอียด · ผู้รับผิดชอบ · วันที่ · กดปุ่มนี้ถึงจะเห็นช่องขั้นสูง (เช็คลิสต์ · เดี่ยว/กลุ่ม · หัวข้อโปรเจค · ไฟล์แนบ) — ไม่กดก็สร้างแบบเรียบง่ายด้วยค่าเริ่มต้นได้เลย */}
              {(() => {
                const topicName = selectedTopicId !== "none" ? projectTopics.find((t) => t.id === selectedTopicId)?.name : undefined;
                const usedSummary = [
                  topicName ?? "ไม่ระบุหัวข้อโปรเจค",
                  ...(taskMode === "group" && (mainAssigneeId || useAssigneeDueDates) ? ["ตั้งค่างานกลุ่มเพิ่มเติม"] : []),
                  ...(taskFiles.length > 0 ? [`ไฟล์แนบ ${taskFiles.length}`] : []),
                ].join(" · ");
                return (
                  <div className="ml-[30px] flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <button
                      type="button"
                      onClick={() => setShowAdvanced((v) => !v)}
                      aria-expanded={showAdvanced}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-[13px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--brand-green)] hover:text-[var(--brand-green-dark)]"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      {showAdvanced ? "ซ่อนตัวเลือกขั้นสูง" : "ตัวเลือกขั้นสูง"}
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAdvanced && "rotate-180")} />
                    </button>
                    {!showAdvanced && (
                      <span className="text-[11px] leading-snug text-[var(--ink-soft)]">ค่าที่ใช้: {usedSummary}</span>
                    )}
                  </div>
                );
              })()}

              {showAdvanced && (
                <div className="space-y-3 border-t border-dashed border-[var(--line)] pt-3">
                  <p className="ml-[30px] text-[11px] font-semibold tracking-wide text-[var(--ink-soft)]">ตัวเลือกขั้นสูง</p>
                  <Row icon={Tag}>
                    <div className="space-y-1 flex-1">
                      <Label className="text-xs text-[var(--ink-soft)]">หัวข้อโปรเจค</Label>
                      {creatingTopic ? (
                        <div className="flex items-center gap-2">
                          <Input
                            autoFocus
                            value={newTopicName}
                            onChange={(e) => setNewTopicName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && confirmCreateProjectTopic()}
                            placeholder="ชื่อหัวข้อโปรเจค"
                            className="flex-1"
                          />
                          <Button type="button" size="sm" disabled={!newTopicName.trim()} onClick={confirmCreateProjectTopic}>
                            ตกลง
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setCreatingTopic(false);
                              setNewTopicName("");
                            }}
                          >
                            ยกเลิก
                          </Button>
                        </div>
                      ) : (
                        <Select
                          value={selectedTopicId}
                          onValueChange={(v) => {
                            if (!v) return;
                            if (v === "__create__") setCreatingTopic(true);
                            else setSelectedTopicId(v);
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="ไม่ระบุหัวข้อโปรเจค">
                              {selectedTopicId === "none"
                                ? "ไม่ระบุหัวข้อโปรเจค"
                                : (projectTopics.find((t) => t.id === selectedTopicId)?.name ?? "ไม่ระบุหัวข้อโปรเจค")}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">ไม่ระบุหัวข้อโปรเจค</SelectItem>
                            {visibleProjectTopics.map((t) => (
                              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                            ))}
                            <SelectItem value="__create__">+ สร้างหัวข้อใหม่...</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      {departmentTopicIds && !creatingTopic && (
                        <p className="text-[11px] text-[var(--ink-soft)]">
                          แสดงเฉพาะหัวข้อที่{departmentNamesForTopicHint}เคยใช้ — ถ้ายังไม่มีที่ต้องการ กด &quot;+ สร้างหัวข้อใหม่&quot; ได้เลย
                        </p>
                      )}
                    </div>
                  </Row>
                  {taskMode === "group" && renderGroupExtras()}
                  <Row icon={Paperclip}>
                    <div className="space-y-2">
                      <Label className="text-xs text-[var(--ink-soft)]">
                        ไฟล์แนบ / รูปภาพ{taskFiles.length > 0 ? ` (${taskFiles.length})` : ""}
                      </Label>
                      <AttachMenu
                        onFiles={(picked) => setTaskFiles((prev) => [...prev, ...picked])}
                        label="แนบไฟล์หรือรูปภาพ"
                        className="rounded-lg border border-dashed border-[var(--line)] px-3 py-1.5 hover:border-[var(--brand-green)] hover:text-[var(--brand-green-dark)] transition-colors"
                      />

                      {taskFiles.length > 0 && (
                        <div className="space-y-1.5">
                          {taskFiles.map((f, i) => {
                            const isImage = f.type.startsWith("image/");
                            return (
                              <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 text-xs">
                                {isImage ? (
                                  <ImageIcon className="h-3.5 w-3.5 text-[var(--ink-soft)] shrink-0" />
                                ) : (
                                  <FileText className="h-3.5 w-3.5 text-[var(--ink-soft)] shrink-0" />
                                )}
                                <span className="flex-1 truncate">{f.name}</span>
                                <span className="text-[var(--ink-soft)] shrink-0">{formatFileSize(f.size)}</span>
                                <button
                                  type="button"
                                  onClick={() => setTaskFiles((prev) => prev.filter((_, idx) => idx !== i))}
                                  className="text-[var(--ink-soft)] hover:text-[var(--chart-red)] shrink-0"
                                  aria-label={`ลบไฟล์ ${f.name}`}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </Row>
                </div>
              )}
            </>
          )}

          {itemType === "meeting" && (
            <>
              <Row icon={Users}>
                <div className="space-y-1">
                  <Label className="text-xs text-[var(--ink-soft)]">ผู้เข้าร่วม ({meetAttendeeIds.length} คน)</Label>
                  <AttendeePicker value={meetAttendeeIds} onChange={setMeetAttendeeIds} />
                  <p className="text-[11px] text-[var(--ink-soft)] flex items-center gap-1 pt-0.5 flex-wrap">
                    <Building2 className="h-3 w-3" /> แผนก:{" "}
                    <span className="font-medium text-[var(--ink)]">{departmentsLabel(meetDeptIds)}</span>{" "}
                    (ตามผู้เข้าร่วม)
                  </p>
                </div>
              </Row>

              {/* All-day toggle (Outlook-style) */}
              <Row icon={Clock}>
                <div className="flex items-center justify-between rounded-lg bg-[var(--bg-soft)] px-3 py-2.5">
                  <span className="text-sm">ทั้งวัน</span>
                  <Switch checked={meetAllDay} onCheckedChange={setMeetAllDay} />
                </div>
              </Row>

              <Row icon={CalendarDays}>
                {meetAllDay ? (
                  <div className="space-y-1">
                    <Label className="text-xs text-[var(--ink-soft)]">วันที่</Label>
                    <DatePickerField value={meetDate} minDate={todayIso()} onChange={setMeetDate} />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1 col-span-1">
                      <Label className="text-xs text-[var(--ink-soft)]">วันที่</Label>
                      <DatePickerField value={meetDate} minDate={todayIso()} onChange={setMeetDate} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-[var(--ink-soft)]">เริ่ม</Label>
                      <TimePickerField value={meetStart} onChange={setMeetStart} className="w-full" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-[var(--ink-soft)]">สิ้นสุด</Label>
                      <TimePickerField value={meetEnd} onChange={setMeetEnd} className="w-full" />
                    </div>
                  </div>
                )}
              </Row>

              {/* Scheduling assistant (Outlook-style) — per-attendee free/busy
                  for the picked date, not just a plain meeting-clash warning. */}
              {attendeeAvailability.length > 0 && (
                <Row icon={CalendarSearch}>
                  <div className="rounded-lg border border-[var(--line)] p-2.5 space-y-1.5">
                    <p className="text-xs font-medium text-[var(--ink-soft)]">ความพร้อมของผู้เข้าร่วม ({formatDate(meetDate)})</p>
                    {attendeeAvailability.map((a) => (
                      <div key={a.userId} className="flex items-start gap-2 text-xs">
                        <span
                          className={cn("h-2 w-2 rounded-full shrink-0 mt-0.5", a.busy ? "bg-[var(--chart-red)]" : "bg-[var(--brand-green)]")}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                        <span className={cn("shrink-0 text-right max-w-[60%]", a.busy ? "text-[var(--chart-red)]" : "text-[var(--brand-green-dark)]")}>
                          {a.busy ? a.reasons.join(", ") : "ว่าง"}
                        </span>
                      </div>
                    ))}
                  </div>
                </Row>
              )}

              <Row icon={MapPin}>
                <div className="space-y-1">
                  <Label className="text-xs text-[var(--ink-soft)]">สถานที่ / ห้องประชุม</Label>
                  <Input
                    value={meetLocation}
                    onChange={(e) => setMeetLocation(e.target.value)}
                    placeholder="เช่น ห้องประชุม A"
                    disabled={meetOnline}
                  />
                </div>
              </Row>

              <Row icon={Video}>
                <div className="flex items-center justify-between rounded-lg bg-[var(--bg-soft)] px-3 py-2.5">
                  <span className="text-sm">การประชุมออนไลน์ (Teams / Zoom)</span>
                  <Switch checked={meetOnline} onCheckedChange={setMeetOnline} />
                </div>
              </Row>

              <Row icon={Paperclip}>
                <div className="space-y-2">
                  <Label className="text-xs text-[var(--ink-soft)]">
                    ไฟล์แนบ / รูปภาพ{meetFiles.length > 0 ? ` (${meetFiles.length})` : ""}
                  </Label>
                  <AttachMenu
                    onFiles={(picked) => setMeetFiles((prev) => [...prev, ...picked])}
                    label="แนบไฟล์หรือรูปภาพ (ไม่จำกัดจำนวน)"
                    className="rounded-lg border border-dashed border-[var(--line)] px-3 py-1.5 hover:border-[var(--brand-green)] hover:text-[var(--brand-green-dark)] transition-colors"
                  />

                  {meetFiles.length > 0 && (
                    <div className="space-y-1.5">
                      {meetFiles.map((f, i) => {
                        const isImage = f.type.startsWith("image/");
                        return (
                          <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 text-xs">
                            {isImage ? (
                              <ImageIcon className="h-3.5 w-3.5 text-[var(--ink-soft)] shrink-0" />
                            ) : (
                              <FileText className="h-3.5 w-3.5 text-[var(--ink-soft)] shrink-0" />
                            )}
                            <span className="flex-1 truncate">{f.name}</span>
                            <span className="text-[var(--ink-soft)] shrink-0">{formatFileSize(f.size)}</span>
                            <button
                              type="button"
                              onClick={() => setMeetFiles((prev) => prev.filter((_, idx) => idx !== i))}
                              className="text-[var(--ink-soft)] hover:text-[var(--chart-red)] shrink-0"
                              aria-label={`ลบไฟล์ ${f.name}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Row>
            </>
          )}

          {itemType === "leave" && (
            <>
              <Row icon={User}>
                <div className="space-y-1">
                  <Label className="text-xs text-[var(--ink-soft)]">ผู้ลา</Label>
                  {canManage(viewingAsUserId) ? (
                    <Select value={leaveUserId} onValueChange={(v) => v && setLeaveUserId(v)}>
                      <SelectTrigger className="w-full">
                        <SelectValue>{getUser(leaveUserId)?.name ?? ""}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    // Only a manager can file a leave on someone else's behalf —
                    // everyone else can only ever file their own.
                    <div className="w-full flex items-center h-9 px-3 rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] text-sm text-[var(--ink-soft)]">
                      {getUser(viewingAsUserId)?.name}
                    </div>
                  )}
                </div>
              </Row>

              <Row icon={Plane}>
                <div className="space-y-1">
                  <Label className="text-xs text-[var(--ink-soft)]">ประเภทการลา</Label>
                  <Select value={leaveType} onValueChange={(v) => v && setLeaveType(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue>{leaveTypes.find((t) => t.id === leaveType)?.label ?? "เลือกประเภท"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {leaveTypes.map((lt) => <SelectItem key={lt.id} value={lt.id}>{lt.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </Row>

              <Row icon={CalendarDays}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-[var(--ink-soft)]">วันเริ่ม</Label>
                    <DatePickerField value={leaveStart} onChange={(v) => { setLeaveStart(v); if (leaveEnd < v) setLeaveEnd(v); }} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-[var(--ink-soft)]">วันสิ้นสุด</Label>
                    <DatePickerField value={leaveEnd} onChange={setLeaveEnd} />
                  </div>
                </div>
              </Row>

              {/* A time range only makes sense for a single-day leave (e.g. ลาครึ่งวัน). */}
              {leaveStart === leaveEnd && (
                <Row icon={Clock}>
                  <div className="flex items-center justify-between rounded-lg bg-[var(--bg-soft)] px-3 py-2.5">
                    <span className="text-sm">ทั้งวัน</span>
                    <Switch checked={leaveAllDay} onCheckedChange={setLeaveAllDay} />
                  </div>
                  {!leaveAllDay && (
                    <div className="grid grid-cols-2 gap-3 mt-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-[var(--ink-soft)]">เริ่ม</Label>
                        <TimePickerField value={leaveStartTime} onChange={setLeaveStartTime} className="w-full" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-[var(--ink-soft)]">สิ้นสุด</Label>
                        <TimePickerField value={leaveEndTime} onChange={setLeaveEndTime} className="w-full" />
                      </div>
                    </div>
                  )}
                </Row>
              )}

              {leaveQuota !== undefined && (
                <Row icon={AlarmClockOff}>
                  <div
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs",
                      leaveExceedsQuota ? "border-amber-200 bg-amber-50 text-amber-800" : "border-[var(--line)] bg-[var(--bg-soft)] text-[var(--ink-soft)]"
                    )}
                  >
                    {leaveExceedsQuota
                      ? `เกินโควตา — ใช้ไปแล้ว ${usedLeaveDays} วัน จากโควตา ${leaveQuota} วัน/ปี คำขอนี้ขอเพิ่ม ${requestedLeaveDays} วัน (เกิน ${usedLeaveDays + requestedLeaveDays - leaveQuota} วัน)`
                      : `ใช้ไปแล้ว ${usedLeaveDays} จากโควตา ${leaveQuota} วัน/ปี — คำขอนี้เหลือ ${leaveQuota - usedLeaveDays - requestedLeaveDays} วัน`}
                  </div>
                </Row>
              )}

              {monthlyStatus !== null && (
                <Row icon={AlarmClockOff}>
                  <div
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-xs space-y-2",
                      monthlyExceeds ? "border-amber-200 bg-amber-50" : "border-[var(--line)] bg-[var(--bg-soft)]"
                    )}
                  >
                    <div className="flex items-baseline gap-1.5">
                      <span className={cn("text-base font-semibold", monthlyExceeds ? "text-amber-800" : "text-[var(--ink)]")}>
                        {monthlyStatus.availableNow} วัน
                      </span>
                      <span className="text-[var(--ink-soft)]">คงเหลือ หลังหักคำขอนี้แล้ว</span>
                    </div>
                    {monthlyExceeds && (
                      <div className="text-amber-800">
                        คำขอนี้ขอ {requestedLeaveDays} วัน แต่มีวันคงเหลือไม่พอ (ขาดอยู่ {Math.abs(monthlyStatus.availableNow)} วัน)
                      </div>
                    )}

                    {/* This month's own grant + its own expiry date, stated
                        directly — no relative "in N months" math for the
                        reader to work out themselves. */}
                    <div className="pt-2 border-t border-[var(--line)] text-[var(--ink-soft)]">
                      เดือนนี้ได้ {monthlyStatus.grantedThisMonth} วัน
                      {monthlyStatus.thisMonthLastUsableKey && (
                        <> — ใช้ได้ถึงสิ้นเดือน{" "}
                          {new Date(`${monthlyStatus.thisMonthLastUsableKey}-01T00:00:00`).toLocaleDateString("th-TH-u-ca-gregory", {
                            month: "long",
                            year: "numeric",
                          })}
                        </>
                      )}
                      {" "}· ใช้ไปแล้ว {monthlyStatus.usedThisMonth} วัน
                    </div>

                    {monthlyStatus.nextExpiry &&
                      monthlyStatus.nextExpiry.amount > 0 &&
                      monthlyStatus.nextExpiry.lastUsableMonthKey !== monthlyStatus.thisMonthLastUsableKey && (
                        <div className="text-amber-700 flex items-start gap-1">
                          <span className="shrink-0">⏳</span>
                          <span>
                            ยอดสะสมเก่า {monthlyStatus.nextExpiry.amount} วัน ใช้ได้ถึงสิ้นเดือน{" "}
                            {new Date(`${monthlyStatus.nextExpiry.lastUsableMonthKey}-01T00:00:00`).toLocaleDateString("th-TH-u-ca-gregory", {
                              month: "long",
                              year: "numeric",
                            })}
                          </span>
                        </div>
                      )}
                  </div>
                </Row>
              )}
            </>
          )}

          {itemType === "dayoff" && (
            <>
              <Row icon={CalendarOff}>
                <div className="space-y-1">
                  <Label className="text-xs text-[var(--ink-soft)]">{dayoffRecurring ? "เริ่มวันที่" : "วันที่"}</Label>
                  <DatePickerField value={dayoffDate} onChange={setDayoffDate} minDate={todayIso()} />
                  <p className="text-[11px] text-[var(--ink-soft)]">
                    ใช้ไป {myRoutineUsedThisMonth}/{myRoutineQuota} วัน ของเดือน
                    {new Date(`${dayoffDate}T00:00:00`).toLocaleDateString("th-TH-u-ca-gregory", { month: "long", year: "numeric" })}
                  </p>
                </div>
              </Row>

              <Row icon={Repeat}>
                <div className="flex items-center justify-between rounded-lg bg-[var(--bg-soft)] px-3 py-2.5">
                  <span className="text-sm">ทำซ้ำทุกสัปดาห์</span>
                  <Switch checked={dayoffRecurring} onCheckedChange={setDayoffRecurring} />
                </div>
                {dayoffRecurring && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-1">
                      {WEEKDAY_SHORT_TH.map((label, day) => (
                        <button
                          key={day}
                          type="button"
                          onClick={() =>
                            setDayoffWeekdays((prev) => {
                              const next = new Set(prev);
                              if (next.has(day)) next.delete(day);
                              else next.add(day);
                              return next;
                            })
                          }
                          className={cn(
                            "h-7 w-7 rounded-full text-[11px] font-medium transition-colors shrink-0",
                            dayoffWeekdays.has(day)
                              ? "bg-[var(--brand-green)] text-[var(--ink)]"
                              : "bg-white border border-[var(--line)] text-[var(--ink-soft)] hover:text-[var(--ink)]"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)]">
                      <span className="shrink-0">ถึงวันที่ (ไม่บังคับ)</span>
                      <DatePickerField value={dayoffUntil} onChange={setDayoffUntil} minDate={dayoffDate} className="h-8 text-xs" />
                      {dayoffUntil && (
                        <button type="button" onClick={() => setDayoffUntil("")} title="ไม่กำหนดวันสิ้นสุด" aria-label="ล้างวันสิ้นสุด">
                          <X className="h-3.5 w-3.5 hover:text-[var(--ink)]" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </Row>
            </>
          )}

          {itemType === "task" && (
            <div className="flex items-center gap-2 text-xs text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-lg px-3 py-2">
              <Building2 className="h-3.5 w-3.5" />
              <span>มอบหมายโดย</span>
              <Avatar className="h-5 w-5">
                <AvatarImage src={assignedByUser.avatarUrl ?? undefined} alt={assignedByUser.name} />
                <AvatarFallback className="text-[8px] bg-white">{assignedByUser.avatar}</AvatarFallback>
              </Avatar>
              <span className="font-medium text-[var(--ink)]">{assignedByUser.name}</span>
              <span className="ml-auto text-[10px]">(สลับที่มุมขวาบน)</span>
            </div>
          )}
        </div>

        <DialogFooter className="px-5 py-4 border-t border-[var(--line)]">
          <Button variant="outline" onClick={() => requestClose(false)} disabled={submitting}>ยกเลิก</Button>
          <Button
            className="bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white"
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {itemType === "task"
              ? "สร้างงาน"
              : itemType === "meeting"
                ? "สร้างประชุม"
                : itemType === "dayoff"
                  ? "เพิ่มวันหยุดประจำ"
                  : "บันทึกวันลา"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ทิ้งข้อมูลที่กรอกไว้?</AlertDialogTitle>
            <AlertDialogDescription>
              ยังไม่ได้บันทึก ถ้าปิดตอนนี้ข้อมูลที่กรอกไว้ทั้งหมดจะหายไป
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>กรอกต่อ</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--chart-red)] hover:bg-red-700 text-white"
              onClick={discardAndClose}
            >
              ทิ้งข้อมูล
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
