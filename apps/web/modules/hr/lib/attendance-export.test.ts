import { describe, expect, it } from "vitest";
import {
  buildDailyLines,
  classifyDay,
  summarizeDays,
  type ExportAttendanceResult,
  type ExportContext,
} from "./attendance-export";

/** แถวผลลงเวลาแบบวันทำงานปกติ — ค่าตั้งต้นจาก Katawut 2 ก.ย. 2569 (08:11–17:05) */
function day(overrides: Partial<ExportAttendanceResult> = {}): ExportAttendanceResult {
  return {
    employment_id: "e1",
    work_date: "2026-09-02",
    actual_in_at: "2026-09-02T01:11:00Z",
    actual_out_at: "2026-09-02T10:05:00Z",
    late_minutes: 0,
    absence_minutes: 0,
    early_out_minutes: 0,
    worked_minutes: 534,
    ot_candidate_minutes: 0,
    is_rest_day: false,
    is_holiday: false,
    is_on_leave: false,
    ...overrides,
  };
}

function ctx(overrides: Partial<ExportContext> = {}): ExportContext {
  return {
    rules: { absenceThresholdMinutes: 240, missingPunchCountsAsAbsent: false },
    personOf: () => ({ code: "GL-010", name: "Katawut Nantaprom", timeZone: "Asia/Bangkok" }),
    leaveOf: () => undefined,
    overtimeOf: () => undefined,
    ...overrides,
  };
}

const dayOffLeave = { name: "Day-Off", dayOff: true };

describe("classifyDay", () => {
  it("treats a few minutes short from arriving inside the grace window as normal", () => {
    const d = classifyDay(day({ absence_minutes: 6 }), ctx());
    expect(d.status).toBe("ปกติ");
    expect(d.absent).toBe(false);
  });

  it("does not count a forgotten clock-out as absence", () => {
    const d = classifyDay(day({ actual_out_at: null, absence_minutes: 540, worked_minutes: 0 }), ctx());
    expect(d.status).toBe("ลืมสแกนออก");
    expect(d.absent).toBe(false);
  });

  it("counts a forgotten clock-out as absence when the company says so", () => {
    const d = classifyDay(
      day({ actual_out_at: null, absence_minutes: 540, worked_minutes: 0 }),
      ctx({ rules: { absenceThresholdMinutes: 240, missingPunchCountsAsAbsent: true } }),
    );
    expect(d.status).toBe("ขาดงาน · ลืมสแกนออก");
    expect(d.absent).toBe(true);
  });

  it("shows both a late arrival and a forgotten clock-out", () => {
    // Katawut 12 ก.ย. 2569 เข้า 08:22 ไม่มีเวลาออก
    const d = classifyDay(
      day({ actual_out_at: null, late_minutes: 8, absence_minutes: 540, worked_minutes: 0 }),
      ctx(),
    );
    expect(d.status).toBe("ลืมสแกนออก · มาสาย");
  });

  it("marks a workday with no scans as absent", () => {
    const d = classifyDay(
      day({ actual_in_at: null, actual_out_at: null, absence_minutes: 540, worked_minutes: 0 }),
      ctx(),
    );
    expect(d.status).toBe("ขาดงาน");
    expect(d.absent).toBe(true);
  });

  it("does not report absence on a day off, even from old results", () => {
    // ผลเก่าก่อนแก้ตัวคำนวณ: Day-Off ขึ้นขาด 60 นาทีทุกวัน
    const d = classifyDay(
      day({
        actual_in_at: null,
        actual_out_at: null,
        absence_minutes: 60,
        worked_minutes: 0,
        is_on_leave: true,
      }),
      ctx({ leaveOf: () => dayOffLeave }),
    );
    expect(d.status).toBe("Day-Off");
    expect(d.kind).toBe("dayoff");
    expect(d.absent).toBe(false);
  });

  it("shows work and overtime state on a day off", () => {
    // Pacharapol 5 ก.ย. 2569 — Day-Off แต่มาทำงาน
    const worked = day({ is_on_leave: true, ot_candidate_minutes: 539, worked_minutes: 539 });

    const pending = classifyDay(worked, ctx({ leaveOf: () => dayOffLeave }));
    expect(pending.status).toBe("Day-Off · มาทำงาน · OT รออนุมัติ");
    expect(pending.otPending).toBe(true);

    const approved = classifyDay(
      worked,
      ctx({
        leaveOf: () => dayOffLeave,
        overtimeOf: () => ({ status: "FINAL_APPROVED", approved_minutes: 480 }),
      }),
    );
    expect(approved.status).toBe("Day-Off · มาทำงาน · OT อนุมัติแล้ว");
    expect(approved.otApprovedMinutes).toBe(480);
    expect(approved.otPending).toBe(false);
  });
});

describe("summarizeDays", () => {
  it("counts only real absences, not short days or forgotten punches", () => {
    const c = ctx();
    const s = summarizeDays(
      [
        day({ work_date: "2026-09-01" }),
        day({ work_date: "2026-09-02", absence_minutes: 6 }),
        day({ work_date: "2026-09-03", absence_minutes: 11 }),
        day({ work_date: "2026-09-12", actual_out_at: null, late_minutes: 8, absence_minutes: 540, worked_minutes: 0 }),
        day({ work_date: "2026-09-08", actual_in_at: null, actual_out_at: null, absence_minutes: 540, worked_minutes: 0 }),
      ].map((r) => classifyDay(r, c)),
    );

    expect(s.absentDays).toBe(1);
    expect(s.missingPunchCount).toBe(1);
    expect(s.lateCount).toBe(1);
    expect(s.workedDays).toBe(4);
  });
});

describe("buildDailyLines", () => {
  it("puts the header on the first line and pads the date", () => {
    const [header, row] = buildDailyLines([day()], ctx());
    expect(header?.startsWith("รหัสพนักงาน,")).toBe(true);
    expect(row).toContain('"02/09/2569"');
    expect(row).toContain('"08:11"');
    expect(row).toContain('"17:05"');
  });
});
