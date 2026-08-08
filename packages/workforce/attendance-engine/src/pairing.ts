import type { AttendanceException, Punch, PunchPair } from './types';

export interface PairingResult {
  workPairs: PunchPair[];
  breakPairs: PunchPair[];
  exceptions: AttendanceException[];
}

type Role = 'IN' | 'OUT' | 'BREAK_START' | 'BREAK_END' | 'IGNORED' | 'NON_WORK';

/**
 * จับคู่ punch เป็นช่วงเวลาทำงาน (spec §7.3)
 *
 * ลำดับความสำคัญ:
 *   1. เจตนาที่เชื่อถือได้ (ผู้ใช้กดเลือกเอง)
 *   2. ลำดับที่คาดหวังของกะ/พัก
 *   3. คู่ที่ใกล้ที่สุดภายในความยาวกะสูงสุด
 *   4. กำกวม → exception ห้ามเดา
 *
 * ระบบเดิมตัดสิน IN/OUT จาก "เวลาปัจจุบันก่อน/หลังเวลาเลิกงาน" (spec §3.3 A3)
 * ซึ่งไม่ใช่การจับคู่เหตุการณ์เลย และพังทันทีที่มีกะกลางคืนหรือสแกนเกินสองครั้ง
 */
export function pairPunches(
  punches: readonly Punch[],
  options: { duplicateWindowMinutes: number; maxShiftMinutes: number },
): PairingResult {
  const exceptions: AttendanceException[] = [];

  const usable = [...punches]
    .filter((punch) => {
      if (punch.ignored) return false;
      if (punch.pendingReview) {
        // หลักฐานยังไม่ผ่านการตรวจ — ไม่นับเป็นเวลาทำงานจนกว่าจะมีคนอนุมัติ
        exceptions.push({
          code: 'PENDING_EVIDENCE_REVIEW',
          blocking: true,
          detail: 'check-in is waiting for evidence review',
          eventId: punch.eventId,
        });
        return false;
      }
      return true;
    })
    .sort((left, right) => left.at.getTime() - right.at.getTime());

  const deduplicated = dropDuplicates(usable, options.duplicateWindowMinutes, exceptions);

  const workPairs: PunchPair[] = [];
  const breakPairs: PunchPair[] = [];

  let openWork: Punch | null = null;
  let openBreak: Punch | null = null;

  for (const punch of deduplicated) {
    const role = roleOf(punch, openWork !== null, openBreak !== null);

    switch (role) {
      case 'IN': {
        if (openWork !== null) {
          // IN ซ้อน IN — ปิดช่วงเดิมโดยไม่มี OUT แล้วเปิดช่วงใหม่
          workPairs.push({
            inEventId: openWork.eventId,
            outEventId: null,
            inAt: openWork.at,
            outAt: null,
            minutes: 0,
          });
          exceptions.push({
            code: 'MISSING_OUT',
            blocking: true,
            detail: 'a clock-in was followed by another clock-in with no clock-out between them',
            eventId: openWork.eventId,
          });
        }
        openWork = punch;
        break;
      }

      case 'OUT': {
        if (openWork === null) {
          workPairs.push({
            inEventId: null,
            outEventId: punch.eventId,
            inAt: null,
            outAt: punch.at,
            minutes: 0,
          });
          exceptions.push({
            code: 'MISSING_IN',
            blocking: true,
            detail: 'a clock-out has no matching clock-in',
            eventId: punch.eventId,
          });
          break;
        }

        // punch ถูกเรียงตามเวลาแล้ว OUT จึงไม่มีทางเกิดก่อน IN ที่จับคู่ด้วยได้
        // `OUT_BEFORE_IN` จึงถูกยกขึ้นตอนตรวจคำขอแก้เวลาแทน ไม่ใช่ที่นี่
        const minutes = (punch.at.getTime() - openWork.at.getTime()) / 60_000;
        if (minutes > options.maxShiftMinutes) {
          // ยาวเกินกะที่เป็นไปได้ — น่าจะลืมออกงานแล้วมาสแกนวันถัดไป
          exceptions.push({
            code: 'MISSING_OUT',
            blocking: true,
            detail: `paired duration ${Math.round(minutes)} minutes exceeds the maximum shift length`,
            eventId: openWork.eventId,
          });
        }

        workPairs.push({
          inEventId: openWork.eventId,
          outEventId: punch.eventId,
          inAt: openWork.at,
          outAt: punch.at,
          minutes: minutes <= options.maxShiftMinutes ? minutes : 0,
        });
        openWork = null;
        break;
      }

      case 'BREAK_START': {
        if (openBreak !== null) {
          exceptions.push({
            code: 'BREAK_VIOLATION',
            blocking: false,
            detail: 'a break start was followed by another break start',
            eventId: punch.eventId,
          });
        }
        openBreak = punch;
        break;
      }

      case 'BREAK_END': {
        if (openBreak === null) {
          exceptions.push({
            code: 'BREAK_VIOLATION',
            blocking: false,
            detail: 'a break end has no matching break start',
            eventId: punch.eventId,
          });
          break;
        }
        breakPairs.push({
          inEventId: openBreak.eventId,
          outEventId: punch.eventId,
          inAt: openBreak.at,
          outAt: punch.at,
          minutes: Math.max(0, (punch.at.getTime() - openBreak.at.getTime()) / 60_000),
        });
        openBreak = null;
        break;
      }

      case 'NON_WORK':
      case 'IGNORED':
        break;
    }
  }

  if (openWork !== null) {
    workPairs.push({
      inEventId: openWork.eventId,
      outEventId: null,
      inAt: openWork.at,
      outAt: null,
      minutes: 0,
    });
    exceptions.push({
      code: 'MISSING_OUT',
      blocking: true,
      detail: 'the day ended with an open clock-in',
      eventId: openWork.eventId,
    });
  }

  if (openBreak !== null) {
    exceptions.push({
      code: 'BREAK_VIOLATION',
      blocking: false,
      detail: 'the day ended with an open break',
      eventId: openBreak.eventId,
    });
  }

  return { workPairs, breakPairs, exceptions };
}

/**
 * ตัดสินบทบาทของ punch
 *
 * `AUTO` ไม่มีเจตนาชัดเจน จึงอนุมานจากสถานะปัจจุบัน (สลับ IN/OUT)
 * ซึ่งเป็นการอนุมานที่อธิบายได้ ต่างจากการเดาจากเวลาปัจจุบัน
 */
function roleOf(punch: Punch, workOpen: boolean, breakOpen: boolean): Role {
  switch (punch.intent) {
    case 'CLOCK_IN':
      return 'IN';
    case 'CLOCK_OUT':
      return 'OUT';
    case 'BREAK_START':
      return 'BREAK_START';
    case 'BREAK_END':
      return 'BREAK_END';
    case 'SITE_CHECK_IN':
    case 'SITE_CHECK_OUT':
      // งานภาคสนามไม่เข้า payroll อัตโนมัติ (spec §6.5)
      return 'NON_WORK';
    case 'AUTO':
      if (breakOpen) return 'BREAK_END';
      return workOpen ? 'OUT' : 'IN';
  }
}

/**
 * ตัด punch ที่ซ้ำกันในหน้าต่างสั้น ๆ
 *
 * เก็บอันแรกไว้เสมอ: คนสแกนสองครั้งเพราะเครื่องไม่ตอบสนอง เวลาจริงคือครั้งแรก
 * punch ที่มีเจตนาต่างกันไม่ถือว่าซ้ำ แม้จะอยู่ในหน้าต่างเดียวกัน
 */
function dropDuplicates(
  punches: readonly Punch[],
  windowMinutes: number,
  exceptions: AttendanceException[],
): Punch[] {
  const kept: Punch[] = [];

  for (const punch of punches) {
    const previous = kept[kept.length - 1];
    if (previous === undefined) {
      kept.push(punch);
      continue;
    }

    const gapMinutes = (punch.at.getTime() - previous.at.getTime()) / 60_000;
    const sameIntent = previous.intent === punch.intent;

    if (gapMinutes <= windowMinutes && sameIntent) {
      exceptions.push({
        code: 'DUPLICATE_PUNCH',
        blocking: false,
        detail: `duplicate ${punch.intent} punch ${Math.round(gapMinutes)} minutes after the previous one`,
        eventId: punch.eventId,
      });
      continue;
    }

    kept.push(punch);
  }

  return kept;
}
