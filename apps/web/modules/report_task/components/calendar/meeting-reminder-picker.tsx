"use client";

import { Bell } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * "เตือนก่อนเริ่ม" ของประชุม (27/10/2569) — เลือกเวลาเตือนก่อนเริ่ม + ติ๊กเตือนล่วงหน้า 1 วัน
 * ใช้ทั้งหน้า "สร้าง → ประชุม" (new-task-dialog) และปุ่ม + บนปฏิทิน (add-todo-dialog)
 * เก็บลงประชุมเป็น reminderMinutes (0 = ไม่เตือนก่อนเริ่ม) + remindDayBefore — reminder-sweep.ts อ่าน
 */
export const MEETING_REMINDER_CHOICES = [
  { minutes: 5, label: "5 นาที" },
  { minutes: 15, label: "15 นาที" },
  { minutes: 30, label: "30 นาที" },
  { minutes: 60, label: "1 ชม." },
  { minutes: 0, label: "ไม่เตือน" },
] as const;

/** ค่าเริ่มต้นจากตั้งค่าบริษัท — จุดเตือนที่ไม่ถึงวัน (ไม่มีก็ 15 นาที) · ล่วงหน้า 1 วันติ๊กไว้เสมอ */
export function defaultMeetingReminder(companyLeads: number[]): { minutes: number; dayBefore: boolean } {
  const sub = companyLeads.filter((m) => m > 0 && m < 1440).sort((a, b) => a - b);
  return { minutes: sub[0] ?? 15, dayBefore: true };
}

export function MeetingReminderPicker({
  minutes,
  dayBefore,
  onChange,
}: {
  minutes: number;
  dayBefore: boolean;
  onChange: (v: { minutes: number; dayBefore: boolean }) => void;
}) {
  const known = MEETING_REMINDER_CHOICES.some((c) => c.minutes === minutes);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)]">
        <Bell className="h-3.5 w-3.5" /> เตือนก่อนเริ่ม
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[...MEETING_REMINDER_CHOICES, ...(known ? [] : [{ minutes, label: `${minutes} นาที` }])].map((c) => (
          <button
            key={c.minutes}
            type="button"
            onClick={() => onChange({ minutes: c.minutes, dayBefore })}
            className={cn(
              "h-8 rounded-full border px-3 text-xs",
              c.minutes === minutes
                ? "border-[var(--brand-navy)] bg-[var(--bg-soft)] font-semibold text-[var(--ink)]"
                : "border-[var(--line)] text-[var(--ink-soft)] hover:text-[var(--ink)]"
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={dayBefore}
          onChange={(e) => onChange({ minutes, dayBefore: e.target.checked })}
          className="h-4 w-4"
        />
        เตือนล่วงหน้า 1 วันด้วย
      </label>
    </div>
  );
}
