"use client";

import { useState } from "react";
import { Switch } from "@/modules/report_task/components/ui/switch";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { Input } from "@/modules/report_task/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { useReminderSettingsStore } from "@/modules/report_task/store/reminder-settings-store";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { trackedTopicsOf } from "@/modules/report_task/lib/report-feed-compliance";
import { REMINDER_OPTIONS } from "@/modules/report_task/components/calendar/add-todo-dialog";
import { TimePickerField } from "@/modules/report_task/components/shared/time-picker-field";
import { Checkbox } from "@/modules/report_task/components/ui/checkbox";
import { cn } from "@/modules/report_task/lib/utils";
import { Bell, CheckSquare, ClipboardList, FileText, Lock, Plus, Users, X } from "lucide-react";

/** One removable "N วัน/นาทีก่อนกำหนด" chip + an inline "+ เพิ่มจุดแจ้งเตือน"
 *  field — shared by all three reminder types below, just with a different
 *  unit label and value range. Each type keeps its own sorted, deduped list
 *  (no point letting someone add "3 วัน" twice). */
function LeadPointsEditor({
  values,
  unit,
  max,
  onChange,
}: {
  values: number[];
  unit: string;
  max: number;
  onChange: (next: number[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function commitDraft() {
    const n = Math.round(Number(draft));
    setDraft("");
    if (!Number.isFinite(n) || n <= 0 || n > max || values.includes(n)) return;
    onChange([...values, n].sort((a, b) => b - a));
  }

  function remove(n: number) {
    onChange(values.filter((v) => v !== n));
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pl-[46px]">
      {values.length === 0 && <span className="text-xs text-[var(--ink-faint)]">ยังไม่มีจุดแจ้งเตือน</span>}
      {values.map((v) => (
        <span
          key={v}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] px-2.5 py-1 text-xs font-semibold"
        >
          {v} {unit}
          <button onClick={() => remove(v)} aria-label={`ลบจุดแจ้งเตือน ${v} ${unit}`} className="text-[var(--ink-faint)] hover:text-[var(--chart-red)]">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <span className="flex items-center gap-1 rounded-lg border border-dashed border-[var(--line-strong)] pl-2 pr-1 py-0.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && commitDraft()}
          placeholder="0"
          className="h-6 w-10 border-0 px-0 text-center text-xs shadow-none focus-visible:ring-0"
        />
        <span className="text-xs text-[var(--ink-soft)] pr-1">{unit}</span>
        <button
          onClick={commitDraft}
          aria-label="เพิ่มจุดแจ้งเตือน"
          className="h-5 w-5 rounded-md flex items-center justify-center text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  );
}

const LEAD_UNITS = [
  { key: "days", label: "วัน", minutesPer: 1440 },
  { key: "hours", label: "ชม.", minutesPer: 60 },
  { key: "minutes", label: "นาที", minutesPer: 1 },
] as const;

/** Formats a stored minute count back into whichever of วัน/ชม./นาที divides
 * it evenly, biggest unit first — a point actually added as "3 วัน" should
 * still read "3 วันก่อนกำหนด" later, not "4320 นาทีก่อนกำหนด". Falls back to
 * minutes for a value that doesn't land on a clean day/hour boundary (only
 * possible if it was added as an hour/minute point to begin with). */
function formatLeadMinutes(totalMinutes: number): string {
  for (const u of LEAD_UNITS) {
    if (totalMinutes % u.minutesPer === 0) return `${totalMinutes / u.minutesPer} ${u.label}`;
  }
  return `${totalMinutes} นาที`;
}

/** Task-only variant of LeadPointsEditor — a task's due date can have no
 * time-of-day at all (dueTime unset), which used to mean "X days before" was
 * the only lead time that made sense. Now that a task can optionally carry a
 * due *time*, this lets a new point be entered in วัน, ชม., or นาที instead
 * of forcing everything into days ("ไม่เอาฟีคแบบวันสิ เอาแบบอาจจะเป็น ชม.
 * ก็ได้") — everything is still stored as one flat list of minutes
 * underneath, same as meeting/report already do, just editable in whatever
 * unit reads clearest for that point. */
function MixedUnitLeadPointsEditor({ values, onChange }: { values: number[]; onChange: (next: number[]) => void }) {
  const [draft, setDraft] = useState("");
  const [unit, setUnit] = useState<(typeof LEAD_UNITS)[number]["key"]>("days");

  function commitDraft() {
    const n = Math.round(Number(draft));
    setDraft("");
    if (!Number.isFinite(n) || n <= 0) return;
    const minutesPer = LEAD_UNITS.find((u) => u.key === unit)!.minutesPer;
    const totalMinutes = n * minutesPer;
    if (totalMinutes > 30 * 1440 || values.includes(totalMinutes)) return;
    onChange([...values, totalMinutes].sort((a, b) => b - a));
  }

  function remove(v: number) {
    onChange(values.filter((x) => x !== v));
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pl-[46px]">
      {values.length === 0 && <span className="text-xs text-[var(--ink-faint)]">ยังไม่มีจุดแจ้งเตือน</span>}
      {values.map((v) => (
        <span
          key={v}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] px-2.5 py-1 text-xs font-semibold"
        >
          {formatLeadMinutes(v)}ก่อนกำหนด
          <button onClick={() => remove(v)} aria-label={`ลบจุดแจ้งเตือน ${formatLeadMinutes(v)}ก่อนกำหนด`} className="text-[var(--ink-faint)] hover:text-[var(--chart-red)]">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <span className="flex items-center gap-1 rounded-lg border border-dashed border-[var(--line-strong)] pl-2 pr-1 py-0.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && commitDraft()}
          placeholder="0"
          className="h-6 w-10 border-0 px-0 text-center text-xs shadow-none focus-visible:ring-0"
        />
        <Select value={unit} onValueChange={(v) => setUnit(v as typeof unit)}>
          <SelectTrigger className="h-6 w-16 border-0 px-1 text-xs shadow-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEAD_UNITS.map((u) => (
              <SelectItem key={u.key} value={u.key}>{u.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-[var(--ink-soft)] pr-1">ก่อนกำหนด</span>
        <button
          onClick={commitDraft}
          aria-label="เพิ่มจุดแจ้งเตือน"
          className="h-5 w-5 rounded-md flex items-center justify-center text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  );
}

function RecipientPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-[11px] font-medium rounded-full px-2.5 py-1 border transition-colors",
        active
          ? "bg-[var(--accent)] border-[var(--brand-green)]/50 text-[var(--brand-green-dark)]"
          : "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--brand-green)]/30"
      )}
    >
      {label}
    </button>
  );
}

/** Company-wide "แจ้งเตือนใกล้ถึงกำหนด" policy — งาน/ประชุม/รีพอต each get
 *  their own on/off, their own lead-time points (in whatever unit actually
 *  matches how that type is scheduled — days for a task's due date, minutes
 *  for a meeting/report cutoff), and who gets notified. Owner-only: this
 *  changes what every employee gets nudged about company-wide, not a
 *  personal preference like EmailNotificationSettingsPanel next to it. */
export function DeadlineReminderSettingsPanel() {
  const settings = useReminderSettingsStore((s) => s.settings);
  const setTaskSettings = useReminderSettingsStore((s) => s.setTaskSettings);
  const setMeetingSettings = useReminderSettingsStore((s) => s.setMeetingSettings);
  const setReportSettings = useReminderSettingsStore((s) => s.setReportSettings);
  const setTodoSettings = useReminderSettingsStore((s) => s.setTodoSettings);
  const setSubmissionLockSettings = useReminderSettingsStore((s) => s.setSubmissionLockSettings);
  const topics = useReportFeedStore((s) => s.topics);
  const updateTopicSettings = useReportFeedStore((s) => s.updateTopicSettings);
  // Only rooms that actually require a report — a category/organizing topic
  // or a room with no submission round configured has nothing for the
  // global lock to apply to in the first place, so listing it here would
  // just be a checkbox that does nothing either way.
  const lockableTopics = trackedTopicsOf(topics).slice().sort((a, b) => a.name.localeCompare(b.name, "th"));

  function toggleRecipient(setFn: (patch: Record<string, boolean>) => void, key: string, current: boolean) {
    setFn({ [key]: !current });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Bell className="h-4.5 w-4.5" /> แจ้งเตือนใกล้ถึงกำหนด
        </h2>
        <p className="text-sm text-[var(--ink-soft)] mt-0.5">
          ตั้งจุดแจ้งเตือนล่วงหน้าแยกตามประเภทงาน — หลายจุดต่อประเภทได้ (เช่น 3 วันก่อน แล้วแจ้งซ้ำอีกที 1 วันก่อน)
        </p>
      </div>

      <Badge variant="outline" className="w-fit text-[10px] font-normal bg-[var(--bg-soft)] text-[var(--ink-soft)] whitespace-normal">
        ตัวยิงแจ้งเตือนทำงานเมื่อมีคนเปิดแอปอยู่ (เช็คทุก 60 วินาที) เหมือนระบบหักคะแนนงานเลยกำหนดที่มีอยู่แล้ว —
        ยังไม่ใช่ cron ฝั่งเซิร์ฟเวอร์ที่ทำงานได้แม้ไม่มีใครเปิดแอปเลย
      </Badge>

      {/* งาน */}
      <div className="rounded-xl border border-[var(--line)] overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="h-8.5 w-8.5 rounded-lg flex items-center justify-center bg-blue-50 text-[var(--chart-blue)] shrink-0">
            <ClipboardList className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">งาน (Task)</p>
            <p className="text-[11px] text-[var(--ink-soft)]">
              แจ้งก่อนถึงกำหนดส่ง — งานที่ตั้งเวลากำหนดส่งไว้ (ไม่ใช่แค่วันที่) เลือกเป็นชั่วโมง/นาทีก่อนได้ด้วย
            </p>
          </div>
          <Switch checked={settings.task.enabled} onCheckedChange={(v) => setTaskSettings({ enabled: v })} />
        </div>
        <div className={cn("px-4 pb-3.5 space-y-2.5", !settings.task.enabled && "opacity-50 pointer-events-none")}>
          <MixedUnitLeadPointsEditor
            values={settings.task.leadMinutes}
            onChange={(leadMinutes) => setTaskSettings({ leadMinutes })}
          />
          <div className="flex flex-wrap items-center gap-2 pl-[46px]">
            <span className="text-[11px] text-[var(--ink-faint)]">แจ้งใคร:</span>
            <RecipientPill active={settings.task.notifyAssignee} label="ผู้รับผิดชอบ" onClick={() => toggleRecipient(setTaskSettings, "notifyAssignee", settings.task.notifyAssignee)} />
            <RecipientPill active={settings.task.notifyAssigner} label="คนมอบหมายงาน" onClick={() => toggleRecipient(setTaskSettings, "notifyAssigner", settings.task.notifyAssigner)} />
            <RecipientPill active={settings.task.notifyDeptHead} label="หัวหน้าแผนก" onClick={() => toggleRecipient(setTaskSettings, "notifyDeptHead", settings.task.notifyDeptHead)} />
          </div>
        </div>
      </div>

      {/* รีพอต */}
      <div className="rounded-xl border border-[var(--line)] overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="h-8.5 w-8.5 rounded-lg flex items-center justify-center bg-teal-50 text-teal-600 shrink-0">
            <FileText className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">รีพอต (รอบส่งประจำวัน/สัปดาห์/เดือน)</p>
            <p className="text-[11px] text-[var(--ink-soft)]">
              ค่าเริ่มต้น — ห้องไหนตั้งค่าของตัวเองไว้ (ในตั้งค่าห้อง) ใช้ค่านั้นแทน · จุดแจ้งเตือนแยกตามความถี่ของรอบ ตั้ง &quot;วัน&quot; ให้เฉพาะรายสัปดาห์/รายเดือนได้โดยไม่กระทบรายวัน
            </p>
          </div>
          <Switch checked={settings.report.enabled} onCheckedChange={(v) => setReportSettings({ enabled: v })} />
        </div>
        <div className={cn("px-4 pb-3.5 space-y-3", !settings.report.enabled && "opacity-50 pointer-events-none")}>
          <div className="space-y-1.5">
            <p className="pl-[46px] text-[11px] font-semibold text-[var(--ink)]">รายวัน</p>
            <MixedUnitLeadPointsEditor
              values={settings.report.leadMinutes}
              onChange={(leadMinutes) => setReportSettings({ leadMinutes })}
            />
          </div>
          <div className="space-y-1.5">
            <p className="pl-[46px] text-[11px] font-semibold text-[var(--ink)]">รายสัปดาห์</p>
            <MixedUnitLeadPointsEditor
              values={settings.report.weeklyLeadMinutes ?? settings.report.leadMinutes}
              onChange={(weeklyLeadMinutes) => setReportSettings({ weeklyLeadMinutes })}
            />
          </div>
          <div className="space-y-1.5">
            <p className="pl-[46px] text-[11px] font-semibold text-[var(--ink)]">รายเดือน</p>
            <MixedUnitLeadPointsEditor
              values={settings.report.monthlyLeadMinutes ?? settings.report.leadMinutes}
              onChange={(monthlyLeadMinutes) => setReportSettings({ monthlyLeadMinutes })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-[46px]">
            <span className="text-[11px] text-[var(--ink-faint)]">แจ้งใคร:</span>
            <RecipientPill active={settings.report.notifyPending} label="คนที่ยังไม่ส่งในห้อง" onClick={() => toggleRecipient(setReportSettings, "notifyPending", settings.report.notifyPending)} />
            <RecipientPill active={settings.report.notifyManagerSummary} label="หัวหน้าห้อง (สรุปรวม)" onClick={() => toggleRecipient(setReportSettings, "notifyManagerSummary", settings.report.notifyManagerSummary)} />
          </div>
        </div>
      </div>

      {/* ปิดรับรายงาน — a hard deadline, not a reminder: this is the only
          thing that actually blocks the composer's submit button once
          passed (see report-cutoff.ts's effectiveHardCutoffTime). Sits next
          to the รีพอต reminder card since both are about a room's daily
          report deadline, but they're independent — a room can remind at
          30 นาทีก่อน and still let people post all night if this is off. */}
      <div className="rounded-xl border border-[var(--line)] overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="h-8.5 w-8.5 rounded-lg flex items-center justify-center bg-rose-50 text-rose-600 shrink-0">
            <Lock className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">ปิดรับรายงาน (เวลาตัดรอบ)</p>
            <p className="text-[11px] text-[var(--ink-soft)]">
              เปิด — ทุกห้องปิดรับรายงานของวันนั้นพร้อมกันตามเวลานี้ (ส่งไม่ได้จริง ไม่ใช่แค่ขึ้นป้าย &quot;สาย&quot;) ปิด — แต่ละห้องตั้งเวลาปิดรับของตัวเองได้ที่หน้าตั้งค่าห้อง
            </p>
          </div>
          <Switch checked={settings.submissionLock.useGlobalCutoff} onCheckedChange={(v) => setSubmissionLockSettings({ useGlobalCutoff: v })} />
        </div>
        <div className="px-4 pb-3.5 pl-[46px]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <TimePickerField
              className="w-[104px] shrink-0"
              value={settings.submissionLock.time}
              onChange={(time) => setSubmissionLockSettings({ time: time || "23:59" })}
              aria-label="เวลาปิดรับรายงานมาตรฐาน"
            />
            <span className="text-[11px] text-[var(--ink-soft)]">
              {settings.submissionLock.useGlobalCutoff
                ? "น. — ใช้เวลานี้ปิดรับทุกห้องพร้อมกัน"
                : "น. — ค่ามาตรฐานที่ห้องใหม่จะได้เมื่อเปิดปิดรับของตัวเอง (ห้องเก่ายังใช้เวลาที่ตั้งไว้แต่เดิม)"}
            </span>
          </div>

          {/* Which rooms actually follow the shared time — off here means
              "ยกเว้น" (ReportTopic.hardCutoffExemptFromGlobal), which just
              falls through to that room's own hardCutoffTime instead (same
              field the room's own settings dialog edits — this list and
              that dialog both write it, so either place stays in sync).
              Only rooms with a real submission schedule show up — nothing
              to exempt in a room nobody's required to report into. */}
          {settings.submissionLock.useGlobalCutoff && lockableTopics.length > 0 && (
            <div className="mt-3 rounded-lg border border-[var(--line)]">
              <p className="border-b border-[var(--line)] bg-[var(--bg-soft)] px-3 py-1.5 text-[11px] font-medium text-[var(--ink-soft)]">
                ใช้เวลากลางกับห้อง — ปิดติ๊กเพื่อยกเว้นห้องนั้น ({lockableTopics.length} ห้องมีรอบส่ง)
              </p>
              <div className="max-h-52 overflow-y-auto p-1">
                {lockableTopics.map((t) => {
                  const usesGlobal = !t.hardCutoffExemptFromGlobal;
                  return (
                    <label
                      key={t.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-[var(--bg-soft)] cursor-pointer"
                    >
                      <Checkbox
                        checked={usesGlobal}
                        onCheckedChange={(v) =>
                          updateTopicSettings(t.id, {
                            hardCutoffExemptFromGlobal: v !== true,
                            hardCutoffTime: v !== true ? (t.hardCutoffTime || settings.submissionLock.time) : t.hardCutoffTime,
                          })
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">{t.name}</span>
                      {!usesGlobal && (
                        <span className="shrink-0 rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[10.5px] text-[var(--ink-faint)]">
                          ยกเว้น{t.hardCutoffTime ? ` · ${t.hardCutoffTime} น.` : " · ไม่ปิดรับ"}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ประชุม */}
      <div className="rounded-xl border border-[var(--line)] overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="h-8.5 w-8.5 rounded-lg flex items-center justify-center bg-violet-50 text-violet-600 shrink-0">
            <Users className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">ประชุม</p>
            <p className="text-[11px] text-[var(--ink-soft)]">แจ้งผู้เข้าร่วมก่อนถึงเวลานัด</p>
          </div>
          <Switch checked={settings.meeting.enabled} onCheckedChange={(v) => setMeetingSettings({ enabled: v })} />
        </div>
        <div className={cn("px-4 pb-3.5 space-y-2.5", !settings.meeting.enabled && "opacity-50 pointer-events-none")}>
          <LeadPointsEditor
            values={settings.meeting.leadMinutes}
            unit="นาทีก่อนเริ่ม"
            max={1440}
            onChange={(leadMinutes) => setMeetingSettings({ leadMinutes })}
          />
          <div className="flex flex-wrap items-center gap-2 pl-[46px]">
            <span className="text-[11px] text-[var(--ink-faint)]">แจ้งใคร:</span>
            <RecipientPill active={settings.meeting.notifyAttendees} label="ผู้เข้าร่วมทุกคน" onClick={() => toggleRecipient(setMeetingSettings, "notifyAttendees", settings.meeting.notifyAttendees)} />
          </div>
        </div>
      </div>

      {/* สิ่งที่ต้องทำ — personal, so no "แจ้งใคร" row (always just the
          owner) and no multi-point list (a to-do only ever fires once). This
          is only the *default* a new to-do's own reminder field pre-fills
          with in AddTodoDialog — each one still keeps its own value and can
          be changed or turned off right there, exactly as before. */}
      <div className="rounded-xl border border-[var(--line)] overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="h-8.5 w-8.5 rounded-lg flex items-center justify-center bg-amber-50 text-amber-600 shrink-0">
            <CheckSquare className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">สิ่งที่ต้องทำ (Personal to-do)</p>
            <p className="text-[11px] text-[var(--ink-soft)]">ค่าเริ่มต้นตอนสร้างสิ่งที่ต้องทำใหม่ — แต่ละอันยังปรับเองทีหลังได้เสมอ</p>
          </div>
          <Switch checked={settings.todo.enabled} onCheckedChange={(v) => setTodoSettings({ enabled: v })} />
        </div>
        <div className={cn("px-4 pb-3.5", !settings.todo.enabled && "opacity-50 pointer-events-none")}>
          <div className="pl-[46px]">
            <Select
              value={String(settings.todo.defaultLeadMinutes)}
              onValueChange={(v) => setTodoSettings({ defaultLeadMinutes: Number(v) })}
            >
              <SelectTrigger className="w-48">
                <SelectValue>
                  {REMINDER_OPTIONS.find((o) => o.minutes === settings.todo.defaultLeadMinutes)?.label ?? "ไม่แจ้งเตือน"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REMINDER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.minutes)}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
