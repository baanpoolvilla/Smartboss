import { LocalDate } from './local-date';

/**
 * แปลงเวลาท้องถิ่นเป็นจุดเวลาบนไทม์ไลน์ และกลับกัน
 *
 * ไม่พึ่ง library ภายนอกแต่ก็ไม่คำนวณ offset เอง — ใช้ฐานข้อมูล timezone ของ
 * ICU ผ่าน Intl ซึ่งรู้จัก DST และการเปลี่ยน offset ในอดีต
 *
 * ระบบเดิมบวก 7 ชั่วโมงด้วยมือทุกจุด (spec §3.3 A4) ซึ่งใช้ได้เฉพาะกับไทย
 * และพังทันทีที่มีสาขาต่างประเทศหรือมีการคำนวณคร่อมเที่ยงคืน
 */

const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = FORMATTER_CACHE.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    FORMATTER_CACHE.set(timeZone, formatter);
  }
  return formatter;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function utcToZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? 0 : Number(part.value);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** offset ของ timezone ณ จุดเวลาหนึ่ง (มิลลิวินาที; บวก = เร็วกว่า UTC) */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = utcToZonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asIfUtc - instant.getTime();
}

/**
 * เวลาท้องถิ่น → จุดเวลา UTC
 *
 * ทำสองรอบเพราะ offset ขึ้นกับจุดเวลาที่ยังไม่รู้: เดาด้วย offset ของค่าประมาณแรก
 * แล้วคำนวณซ้ำด้วย offset ที่ถูกต้องกว่า — พอสำหรับทุกกรณีที่ไม่ใช่ชั่วโมงที่
 * หายไปตอนเริ่ม DST (ซึ่งไม่มีจริงในเขตเวลาไทย)
 *
 * `minutesFromMidnight` เกิน 1440 ได้ เพื่อรองรับกะข้ามคืน (เช่น 22:00 → 06:00
 * ของวันถัดไป = 360 + 1440)
 */
export function zonedTimeToUtc(
  date: LocalDate,
  minutesFromMidnight: number,
  timeZone: string,
): Date {
  const dayOffset = Math.floor(minutesFromMidnight / 1440);
  const withinDay = minutesFromMidnight - dayOffset * 1440;
  const target = date.plusDays(dayOffset);

  const naive = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    Math.floor(withinDay / 60),
    withinDay % 60,
  );

  const firstPass = naive - timeZoneOffsetMs(new Date(naive), timeZone);
  const secondPass = naive - timeZoneOffsetMs(new Date(firstPass), timeZone);
  return new Date(secondPass);
}

/** จำนวนนาทีนับจากเที่ยงคืนของวันนั้นในเขตเวลาที่ระบุ */
export function minutesFromMidnight(instant: Date, timeZone: string): number {
  const parts = utcToZonedParts(instant, timeZone);
  return parts.hour * 60 + parts.minute;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** แปลง 'HH:MM' เป็นจำนวนนาทีจากเที่ยงคืน */
export function parseTimeOfDay(value: string): number {
  const match = TIME_RE.exec(value);
  if (match === null) throw new RangeError(`expected HH:MM, received ${JSON.stringify(value)}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatTimeOfDay(minutes: number): string {
  const normalised = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalised / 60);
  return `${String(hours).padStart(2, '0')}:${String(normalised % 60).padStart(2, '0')}`;
}
