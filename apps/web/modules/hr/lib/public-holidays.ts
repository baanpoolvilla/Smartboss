/**
 * ส่วนล้วนของการดึงวันหยุดนักขัตฤกษ์จาก Google (ไม่มี I/O) — ตัวรันอยู่ที่ lib/public-holiday-sync.ts
 */

/** Google ใส่คำนี้ขึ้นต้น DESCRIPTION ของวันหยุดจริง (วันสำคัญอื่นขึ้นต้นด้วย "วันสำคัญ") */
const PUBLIC_HOLIDAY_MARK = "วันหยุดนักขัตฤกษ์";

export interface CompanySyncState {
  /** วันที่เคยเห็นจาก Google แล้ว — ไม่เพิ่มซ้ำแม้ HR ลบทิ้ง */
  seen: string[];
  /** วันที่ระบบเพิ่มเอง — ลบออกได้ถ้า Google เอาออก */
  added: string[];
}

export type SyncStore = Record<string, CompanySyncState>;

export interface PublicHoliday {
  date: string;
  name: string;
}

function unescapeIcs(text: string): string {
  return text.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

const icsDate = (raw: string) => `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;

/** แตก .ics ของ Google เป็นวันหยุดรายวัน — DTEND ไม่รวมวันนั้น (มาตรฐาน iCalendar) */
export function parsePublicHolidays(ics: string): PublicHoliday[] {
  // บรรทัดยาวถูกพับเป็นหลายบรรทัด (ขึ้นต้นด้วยช่องว่าง) — ต่อกลับก่อน
  const text = ics.replace(/\r?\n[ \t]/g, "");
  const out = new Map<string, string>();
  for (const block of text.split("BEGIN:VEVENT").slice(1)) {
    const field = (name: string) => block.match(new RegExp(`^${name}[^:\\n]*:(.*)$`, "m"))?.[1]?.trim();
    const start = field("DTSTART")?.match(/^\d{8}/)?.[0];
    const description = unescapeIcs(field("DESCRIPTION") ?? "");
    if (!start || !description.startsWith(PUBLIC_HOLIDAY_MARK)) continue;
    // ชื่อบางวันมี zero-width space นำหน้า (เช่น "​วันรัฐธรรมนูญ")
    const name = unescapeIcs(field("SUMMARY") ?? "").replace(/[​-‍﻿]/g, "").trim();
    if (!name) continue;
    const end = field("DTEND")?.match(/^\d{8}/)?.[0];
    const last = end ? addDays(icsDate(end), -1) : icsDate(start);
    for (let day = icsDate(start); day <= last; day = addDays(day, 1)) {
      if (!out.has(day)) out.set(day, name);
    }
  }
  return [...out].map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date));
}

export function todayInThailand(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface CompanyPlan {
  insert: PublicHoliday[];
  remove: string[];
  state: CompanySyncState;
}

/** ตัดสินว่าจะเพิ่ม/ลบอะไรของบริษัทหนึ่ง — แยกเป็นฟังก์ชันล้วนให้ทดสอบได้ */
export function planCompanySync(
  google: PublicHoliday[],
  existingDates: ReadonlySet<string>,
  previous: CompanySyncState | undefined,
  today: string
): CompanyPlan {
  const until = `${Number(today.slice(0, 4)) + 1}-12-31`;
  const inRange = google.filter((h) => h.date >= today && h.date <= until);
  const googleDates = new Set(inRange.map((h) => h.date));
  const seen = new Set(previous?.seen ?? []);
  const added = new Set(previous?.added ?? []);

  const insert = inRange.filter((h) => !seen.has(h.date) && !existingDates.has(h.date));
  const remove = [...added].filter((d) => d >= today && d <= until && !googleDates.has(d) && existingDates.has(d));

  for (const h of inRange) seen.add(h.date);
  for (const h of insert) added.add(h.date);
  for (const d of remove) added.delete(d);
  // เก็บแค่ช่วงที่ยังมีผล — วันที่ผ่านไปแล้วไม่ต้องจำ
  const keep = (d: string) => d >= today;
  return {
    insert,
    remove,
    state: { seen: [...seen].filter(keep).sort(), added: [...added].filter(keep).sort() },
  };
}
