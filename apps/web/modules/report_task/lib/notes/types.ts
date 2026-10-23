/** ขีดจำกัดของโน้ต — กันข้อมูลบวม/ล้น (ดูเหตุผลที่ lib/notes/server.ts) ใช้ทั้งฝั่งเครื่องและเซิร์ฟเวอร์ */
export const NOTE_LIMITS = {
  /** เอกสารหนึ่งหน้า (ข้อความ/ตาราง — รูปอยู่ที่ระบบไฟล์แนบ) */
  pageBytes: 5 * 1024 * 1024,
  /** ชุดแก้ที่ส่งครั้งเดียว */
  updateBytes: 1024 * 1024,
  pagesPerRoom: 2000,
  sectionsPerRoom: 100,
  titleChars: 200,
  /** บีบรวมชุดแก้เข้า state ทุกกี่ชุด */
  compactEvery: 100,
  /** เว้นช่วงแก้นานเท่านี้ = จบหนึ่งรอบ → พักเป็นเวอร์ชัน */
  versionGapMs: 5 * 60_000,
  /** แก้ต่อเนื่องนานเท่านี้ → พักเวอร์ชันระหว่างทาง */
  versionIntervalMs: 30 * 60_000,
  keepAllVersionsDays: 30,
  maxVersionsPerPage: 300,
  /** ประวัติของหน้าหนึ่งรวมกันไม่เกินนี้ (เกิน = ตัดเวอร์ชันเก่าสุดออก) — กันหน้าใหญ่ × หลายร้อยเวอร์ชันกินฐานข้อมูล */
  versionBytesPerPage: 50 * 1024 * 1024,
  /** เนื้อหาโน้ตทั้งห้องรวมกัน (ไม่นับรูป/ไฟล์ที่อยู่ระบบไฟล์แนบ) */
  roomBytes: 300 * 1024 * 1024,
  trashDays: 30,
} as const;

export interface NoteSectionMeta {
  id: string;
  name: string;
  color: string;
  sort: number;
}

export interface NotePageMeta {
  id: string;
  title: string;
  sectionId: string | null;
  sort: number;
  pinned: boolean;
  updatedAt: string;
  updatedByName: string;
  deletedAt: string | null;
  deletedByName: string;
  sizeKb: number;
  /** ข้อความรอบคำที่ค้นเจอ (เฉพาะตอนค้นหา) */
  snippet?: string;
}

export interface NoteMember {
  clientId: string;
  userId: string;
  name: string;
  pageId: string | null;
}

export interface NoteVersionMeta {
  id: string;
  at: string;
  editors: string[];
  reason: "session" | "interval" | "restore";
  title: string;
}
