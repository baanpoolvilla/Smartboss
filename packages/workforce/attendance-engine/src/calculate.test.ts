import { LocalDate, parseTimeOfDay, zonedTimeToUtc } from '@workforce/domain';
import { describe, expect, it } from 'vitest';
import { calculateAttendance } from './calculate';
import { REFERENCE_WORK_POLICY } from './index';
import type {
  AttendanceInput,
  ExceptionCode,
  Punch,
  ShiftDefinition,
  WorkPolicy,
} from './types';

const TZ = 'Asia/Bangkok';
const WORK_DATE = LocalDate.parse('2026-08-03');

const policy: WorkPolicy = { ...REFERENCE_WORK_POLICY };

const dayShift: ShiftDefinition = {
  id: 'shift-day',
  code: 'DAY',
  startMinutes: parseTimeOfDay('08:00'),
  endMinutes: parseTimeOfDay('17:00'),
  breaks: [
    { startMinutes: parseTimeOfDay('12:00'), durationMinutes: 60, paid: false, autoDeduct: true },
  ],
  restDay: false,
};

/** 22:00 → 06:00 ของวันถัดไป (spec §7.1 work_date = วันเริ่มกะ) */
const nightShift: ShiftDefinition = {
  id: 'shift-night',
  code: 'NIGHT',
  startMinutes: parseTimeOfDay('22:00'),
  endMinutes: parseTimeOfDay('06:00') + 1440,
  breaks: [],
  restDay: false,
};

const restDay: ShiftDefinition = {
  id: 'shift-rest',
  code: 'REST',
  startMinutes: 0,
  endMinutes: 0,
  breaks: [],
  restDay: true,
};

/** สร้าง punch ที่เวลาท้องถิ่นของวันทำงาน; `+HH:MM` = วันถัดไป */
function punch(time: string, overrides: Partial<Punch> = {}): Punch {
  const nextDay = time.startsWith('+');
  const minutes = parseTimeOfDay(nextDay ? time.slice(1) : time) + (nextDay ? 1440 : 0);
  return {
    eventId: `evt-${time}-${overrides.intent ?? 'AUTO'}`,
    at: zonedTimeToUtc(WORK_DATE, minutes, TZ),
    intent: 'AUTO',
    adjusted: false,
    trustedIntent: false,
    ignored: false,
    pendingReview: false,
    ...overrides,
  };
}

function run(overrides: Partial<AttendanceInput> = {}): ReturnType<typeof calculateAttendance> {
  return calculateAttendance({
    workDate: WORK_DATE,
    timeZone: TZ,
    policy,
    shift: dayShift,
    punches: [],
    holiday: null,
    leave: null,
    employmentActive: true,
    ...overrides,
  });
}

function codes(result: ReturnType<typeof calculateAttendance>): ExceptionCode[] {
  return result.exceptions.map((exception) => exception.code);
}

describe('normal day', () => {
  it('computes worked, paid and break minutes for a full day', () => {
    const result = run({ punches: [punch('07:55'), punch('17:05')] });

    expect(result.lateMinutes).toBe(0);
    expect(result.absenceMinutes).toBe(0);
    expect(result.earlyOutMinutes).toBe(0);
    // 07:55–17:05 = 550 นาที ลบพักกลางวัน 60 = 490
    expect(result.workedMinutes).toBe(490);
    expect(result.unpaidBreakMinutes).toBe(60);
    expect(result.exceptions).toEqual([]);
  });

  it('keeps late, absence and early-out as separate numbers', () => {
    // spec §7.2 ห้ามใช้แทนกัน — ระบบเดิมมีแค่ is_late จึงอธิบายการหักเงินไม่ได้
    const result = run({ punches: [punch('08:40'), punch('16:00')] });

    expect(result.lateMinutes).toBe(25); // เกิน grace 15 นาที
    expect(result.earlyOutMinutes).toBe(60);
    expect(result.workedMinutes).toBe(380);
    expect(result.absenceMinutes).toBe(100); // ต้องทำ 480, ทำได้ 380
  });
});

describe('late policy modes', () => {
  const arriveAt0820 = [punch('08:20'), punch('17:00')];

  it('STRICT counts every minute from the scheduled start', () => {
    const result = run({
      policy: { ...policy, lateMode: 'STRICT' },
      punches: arriveAt0820,
    });
    expect(result.lateMinutes).toBe(20);
  });

  it('GRACE forgives arrivals inside the window', () => {
    const result = run({ punches: [punch('08:10'), punch('17:00')] });
    expect(result.lateMinutes).toBe(0);
  });

  it('GRACE with EXCESS_OVER_GRACE charges only the minutes beyond the window', () => {
    const result = run({ punches: arriveAt0820 });
    expect(result.lateMinutes).toBe(5);
  });

  it('GRACE with FULL_FROM_SCHEDULED charges the whole delay', () => {
    // นโยบายสองแบบนี้ต่างกันเป็นเงินจริง จึงต้องเลือกอย่างชัดเจน ไม่ใช่ค่าโดยนัย
    const result = run({
      policy: { ...policy, graceDeduction: 'FULL_FROM_SCHEDULED' },
      punches: arriveAt0820,
    });
    expect(result.lateMinutes).toBe(20);
  });

  it('FLEX ignores arrival time inside the flexible window', () => {
    const result = run({
      policy: { ...policy, lateMode: 'FLEX' },
      punches: [punch('09:30'), punch('18:30')],
    });
    expect(result.lateMinutes).toBe(0);
    expect(result.earlyOutMinutes).toBe(0);
    expect(result.absenceMinutes).toBe(0);
  });

  it('FLEX charges lateness only after the window closes', () => {
    const result = run({
      policy: { ...policy, lateMode: 'FLEX' },
      punches: [punch('10:30'), punch('19:30')],
    });
    expect(result.lateMinutes).toBe(30);
  });

  it('FLEX measures shortfall by hours worked, not by clock time', () => {
    const result = run({
      policy: { ...policy, lateMode: 'FLEX' },
      punches: [punch('09:00'), punch('15:00')],
    });
    // ทำได้ 360 − พัก 60 = 300 จากที่ต้องได้ 480
    expect(result.workedMinutes).toBe(300);
    expect(result.absenceMinutes).toBe(180);
  });
});

describe('missing and duplicate punches', () => {
  it('raises MISSING_OUT for an open clock-in', () => {
    const result = run({ punches: [punch('08:00')] });
    expect(codes(result)).toContain('MISSING_OUT');
    expect(result.workedMinutes).toBe(0);
    expect(result.exceptions.find((e) => e.code === 'MISSING_OUT')?.blocking).toBe(true);
  });

  it('raises MISSING_IN for an orphan clock-out', () => {
    const result = run({ punches: [punch('17:00', { intent: 'CLOCK_OUT' })] });
    expect(codes(result)).toContain('MISSING_IN');
  });

  it('drops a duplicate scan and keeps the first one', () => {
    const result = run({
      punches: [punch('08:00'), punch('08:01'), punch('17:00', { intent: 'CLOCK_OUT' })],
    });
    expect(codes(result)).toContain('DUPLICATE_PUNCH');
    // เวลาจริงคือครั้งแรก — คนสแกนซ้ำเพราะเครื่องไม่ตอบสนอง
    expect(result.actualInAt?.toISOString()).toBe(zonedTimeToUtc(WORK_DATE, 480, TZ).toISOString());
    expect(result.workedMinutes).toBe(480);
  });

  it('does not treat a different intent inside the window as a duplicate', () => {
    const result = run({
      punches: [
        punch('08:00', { intent: 'CLOCK_IN' }),
        punch('08:01', { intent: 'BREAK_START' }),
        punch('08:30', { intent: 'BREAK_END' }),
        punch('17:00', { intent: 'CLOCK_OUT' }),
      ],
    });
    expect(codes(result)).not.toContain('DUPLICATE_PUNCH');
  });

  it('reports both sides when a clock-out precedes the clock-in in real time', () => {
    // เรียงตามเวลาแล้ว OUT มาก่อน → ไม่มี IN ให้จับคู่ และ IN ตอนเย็นก็ไม่มี OUT
    const result = run({
      punches: [punch('08:00', { intent: 'CLOCK_OUT' }), punch('17:00', { intent: 'CLOCK_IN' })],
    });
    expect(codes(result)).toEqual(expect.arrayContaining(['MISSING_IN', 'MISSING_OUT']));
    expect(result.workedMinutes).toBe(0);
  });

  it('flags a pair that is longer than any possible shift', () => {
    const result = run({
      punches: [punch('08:00', { intent: 'CLOCK_IN' }), punch('+18:00', { intent: 'CLOCK_OUT' })],
    });
    expect(codes(result)).toContain('MISSING_OUT');
    expect(result.workedMinutes).toBe(0);
  });
});

describe('overnight shift', () => {
  it('attributes an early-morning clock-out to the day the shift started', () => {
    // spec §7.1: work_date คือวันเริ่มกะ ไม่ใช่วันปฏิทินของ OUT
    const result = run({
      shift: nightShift,
      punches: [punch('21:55', { intent: 'CLOCK_IN' }), punch('+06:05', { intent: 'CLOCK_OUT' })],
    });

    expect(result.workDate).toBe('2026-08-03');
    expect(result.lateMinutes).toBe(0);
    expect(result.earlyOutMinutes).toBe(0);
    expect(result.workedMinutes).toBe(490);
    expect(result.exceptions).toEqual([]);
  });

  it('measures lateness against the shift start on the previous evening', () => {
    const result = run({
      shift: nightShift,
      punches: [punch('22:40', { intent: 'CLOCK_IN' }), punch('+06:00', { intent: 'CLOCK_OUT' })],
    });
    expect(result.lateMinutes).toBe(25);
  });
});

describe('breaks and split shifts', () => {
  it('deducts an unpaid auto break only when work happened', () => {
    const worked = run({ punches: [punch('08:00'), punch('17:00', { intent: 'CLOCK_OUT' })] });
    expect(worked.unpaidBreakMinutes).toBe(60);

    const absent = run({ punches: [] });
    // คนที่ไม่ได้มาทำงานต้องไม่ถูกหักเวลาพัก
    expect(absent.unpaidBreakMinutes).toBe(0);
  });

  it('keeps a paid break inside paid minutes', () => {
    const paidBreakShift: ShiftDefinition = {
      ...dayShift,
      breaks: [
        { startMinutes: parseTimeOfDay('12:00'), durationMinutes: 30, paid: true, autoDeduct: true },
      ],
    };
    const result = run({
      shift: paidBreakShift,
      punches: [punch('08:00'), punch('17:00', { intent: 'CLOCK_OUT' })],
    });

    expect(result.unpaidBreakMinutes).toBe(0);
    expect(result.workedMinutes).toBe(540);
    expect(result.breakMinutes).toBe(30);
  });

  it('handles a split shift as two work pairs', () => {
    const result = run({
      shift: { ...dayShift, breaks: [] },
      punches: [
        punch('08:00', { intent: 'CLOCK_IN' }),
        punch('12:00', { intent: 'CLOCK_OUT' }),
        punch('14:00', { intent: 'CLOCK_IN' }),
        punch('17:00', { intent: 'CLOCK_OUT' }),
      ],
    });

    expect(result.pairs).toHaveLength(2);
    expect(result.workedMinutes).toBe(420);
    expect(result.exceptions).toEqual([]);
  });

  it('handles multiple punched breaks', () => {
    const result = run({
      shift: { ...dayShift, breaks: [] },
      punches: [
        punch('08:00', { intent: 'CLOCK_IN' }),
        punch('10:00', { intent: 'BREAK_START' }),
        punch('10:15', { intent: 'BREAK_END' }),
        punch('12:00', { intent: 'BREAK_START' }),
        punch('13:00', { intent: 'BREAK_END' }),
        punch('17:00', { intent: 'CLOCK_OUT' }),
      ],
    });

    expect(result.breakMinutes).toBe(75);
    expect(result.workedMinutes).toBe(540 - 75);
  });

  it('flags an unclosed break without blocking the day', () => {
    const result = run({
      punches: [
        punch('08:00', { intent: 'CLOCK_IN' }),
        punch('12:00', { intent: 'BREAK_START' }),
        punch('17:00', { intent: 'CLOCK_OUT' }),
      ],
    });
    const violation = result.exceptions.find((e) => e.code === 'BREAK_VIOLATION');
    expect(violation).toBeDefined();
    expect(violation?.blocking).toBe(false);
  });
});

describe('rest days, holidays and leave', () => {
  it('does not charge absence on a rest day', () => {
    const result = run({ shift: restDay, punches: [] });
    expect(result.absenceMinutes).toBe(0);
    expect(result.isRestDay).toBe(true);
    expect(result.exceptions).toEqual([]);
  });

  it('treats all work on a rest day as overtime candidate', () => {
    const result = run({
      shift: restDay,
      punches: [punch('09:00', { intent: 'CLOCK_IN' }), punch('13:00', { intent: 'CLOCK_OUT' })],
    });
    expect(result.otCandidateMinutes).toBe(240);
    expect(result.lateMinutes).toBe(0);
  });

  it('does not charge absence on a public holiday', () => {
    const result = run({ holiday: { name: 'วันแม่แห่งชาติ', paid: true }, punches: [] });
    expect(result.absenceMinutes).toBe(0);
    expect(result.isHoliday).toBe(true);
  });

  it('does not charge absence for a full-day leave', () => {
    const result = run({
      leave: { paidMinutes: 480, unpaidMinutes: 0, fullDay: true },
      punches: [],
    });
    expect(result.absenceMinutes).toBe(0);
    expect(result.paidMinutes).toBe(480);
  });

  it('combines half-day leave with half a day of work', () => {
    const result = run({
      leave: { paidMinutes: 240, unpaidMinutes: 0, fullDay: false },
      punches: [punch('13:00', { intent: 'CLOCK_IN' }), punch('17:00', { intent: 'CLOCK_OUT' })],
    });

    expect(result.workedMinutes).toBe(240);
    expect(result.absenceMinutes).toBe(0);
    expect(result.paidMinutes).toBe(480);
  });
});

describe('overtime candidate', () => {
  it('is zero when work stops at the scheduled end', () => {
    const result = run({ punches: [punch('08:00'), punch('17:00', { intent: 'CLOCK_OUT' })] });
    expect(result.otCandidateMinutes).toBe(0);
  });

  it('ignores extra time below the minimum', () => {
    const result = run({ punches: [punch('08:00'), punch('17:20', { intent: 'CLOCK_OUT' })] });
    expect(result.otCandidateMinutes).toBe(0);
  });

  it('rounds down to the configured increment', () => {
    const result = run({ punches: [punch('08:00'), punch('18:50', { intent: 'CLOCK_OUT' })] });
    // เกิน 110 นาที → ปัดลงเป็นช่วงละ 30 = 90
    expect(result.otCandidateMinutes).toBe(90);
  });

  it('raises UNAPPROVED_OT when approval is required', () => {
    const result = run({ punches: [punch('08:00'), punch('19:00', { intent: 'CLOCK_OUT' })] });
    expect(codes(result)).toContain('UNAPPROVED_OT');
    // OT ที่ยังไม่อนุมัติต้องไม่ถูกนับเป็นเวลาที่จ่ายในอัตราปกติ
    expect(result.paidMinutes).toBe(result.workedMinutes - result.otCandidateMinutes);
  });
});

describe('policy and data problems', () => {
  it('refuses to guess when no work policy applies', () => {
    const result = run({ policy: null, punches: [punch('08:00')] });
    expect(codes(result)).toContain('POLICY_NOT_FOUND');
    expect(result.workedMinutes).toBe(0);
  });

  it('raises NO_SHIFT_ASSIGNED when punches exist with no schedule', () => {
    const result = run({ shift: null, punches: [punch('08:00'), punch('17:00', { intent: 'CLOCK_OUT' })] });
    expect(codes(result)).toContain('NO_SHIFT_ASSIGNED');
  });

  it('raises INACTIVE_EMPLOYMENT for punches outside the employment period', () => {
    const result = run({ employmentActive: false, punches: [punch('08:00')] });
    expect(codes(result)).toContain('INACTIVE_EMPLOYMENT');
  });

  it('does not count a day before hire (or after termination) as absent', () => {
    // ไม่มี punch เลยในวันที่ยังไม่ได้จ้าง — ถ้าคำนวณ absence ต่อแบบวันทำงาน
    // ปกติ จะได้ขาดงานเต็มวันทั้งที่ยังไม่ได้เริ่มงาน
    const result = run({ employmentActive: false, punches: [] });
    expect(result.absenceMinutes).toBe(0);
    expect(result.lateMinutes).toBe(0);
  });

  it('excludes an ignored punch after a correction', () => {
    const result = run({
      punches: [
        punch('06:00', { intent: 'CLOCK_IN', ignored: true }),
        punch('08:00', { intent: 'CLOCK_IN' }),
        punch('17:00', { intent: 'CLOCK_OUT' }),
      ],
    });
    expect(result.workedMinutes).toBe(480);
    expect(result.exceptions).toEqual([]);
  });

  it('holds back a check-in whose evidence is still under review', () => {
    const result = run({
      punches: [
        punch('08:00', { intent: 'CLOCK_IN', pendingReview: true }),
        punch('17:00', { intent: 'CLOCK_OUT' }),
      ],
    });
    expect(codes(result)).toContain('PENDING_EVIDENCE_REVIEW');
    expect(codes(result)).toContain('MISSING_IN');
  });

  it('flags an implausibly long working day', () => {
    const result = run({
      shift: { ...dayShift, breaks: [] },
      punches: [punch('05:00', { intent: 'CLOCK_IN' }), punch('20:00', { intent: 'CLOCK_OUT' })],
    });
    expect(codes(result)).toContain('EXCESSIVE_WORK_DURATION');
  });

  it('ignores field check-ins for payroll time', () => {
    // spec §6.5: SITE_CHECK_IN/OUT ไม่เข้า payroll อัตโนมัติ
    const result = run({
      punches: [
        punch('08:00', { intent: 'SITE_CHECK_IN' }),
        punch('17:00', { intent: 'SITE_CHECK_OUT' }),
      ],
    });
    expect(result.workedMinutes).toBe(0);
    expect(result.pairs).toEqual([]);
  });
});

describe('determinism', () => {
  it('produces the same result when run twice', () => {
    // spec §17: ผลการคำนวณต้องทำซ้ำได้เหมือนเดิม
    const input: Partial<AttendanceInput> = {
      punches: [punch('08:22'), punch('17:41', { intent: 'CLOCK_OUT' })],
    };
    expect(JSON.stringify(run(input))).toBe(JSON.stringify(run(input)));
  });

  it('does not depend on the order punches arrive in', () => {
    const forward = run({
      punches: [punch('08:00', { intent: 'CLOCK_IN' }), punch('17:00', { intent: 'CLOCK_OUT' })],
    });
    const reversed = run({
      punches: [punch('17:00', { intent: 'CLOCK_OUT' }), punch('08:00', { intent: 'CLOCK_IN' })],
    });
    expect(reversed.workedMinutes).toBe(forward.workedMinutes);
  });
});
