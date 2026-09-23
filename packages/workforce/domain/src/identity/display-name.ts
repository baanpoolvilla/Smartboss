/**
 * รูปแบบชื่อที่แสดง — ตั้งได้รายบริษัท ไม่ใช่ค่าตายตัวในโค้ด
 *
 * ชื่อที่ผู้ใช้เห็นทุกหน้ามาจากฟังก์ชันนี้ที่เดียว (ทั้ง person และ employment)
 * บริษัทหนึ่งเรียกกันด้วยชื่อเล่น อีกบริษัทเรียกชื่อ-นามสกุลเต็มในเอกสารราชการ
 * จึงเลือกได้เอง แล้วทุกหน้าเปลี่ยนพร้อมกัน
 */
export const DISPLAY_NAME_FORMATS = ['NICK_FIRST', 'FIRST_NICK', 'FULL_NAME'] as const;

export type DisplayNameFormat = (typeof DISPLAY_NAME_FORMATS)[number];

/**
 * ค่าตั้งต้นของบริษัทที่ยังไม่เคยเลือก — **ห้ามอ่านไปใช้แทนค่าจริงของบริษัท**
 *
 * เลือก FULL_NAME เพราะเป็นแบบเดียวที่ไม่ต้องพึ่งช่องชื่อเล่น: บริษัทที่ยังไม่เคย
 * ตั้งค่าอาจกรอกชื่อเล่นไว้เป็น "Katawut-กีม" (ใส่รูปแบบลงไปในข้อมูลเอง) ซึ่งถ้า
 * ตั้งต้นเป็น NICK_FIRST จะได้ชื่อซ้อนกันเป็น "Katawut-กีม-Katawut" ทันทีที่ deploy
 */
export const DEFAULT_DISPLAY_NAME_FORMAT: DisplayNameFormat = 'FULL_NAME';

export interface DisplayNameParts {
  firstName: string;
  lastName: string;
  /** ชื่อเล่น — ว่างได้ */
  preferredName: string;
}

export function isDisplayNameFormat(value: unknown): value is DisplayNameFormat {
  return (
    typeof value === 'string' &&
    (DISPLAY_NAME_FORMATS as readonly string[]).includes(value)
  );
}

/**
 * ประกอบชื่อที่แสดงตามรูปแบบที่บริษัทเลือก
 *
 * กติกาที่ต้องไม่พัง: ห้ามคืนค่าว่าง — คอลัมน์ชื่อในหน้าจอทุกที่ใช้ค่านี้ตรง ๆ
 * ได้ค่าว่างเมื่อไหร่คือมีแถวที่คลิกไม่ถูกเพราะไม่มีข้อความให้กด ⇒ ไล่ fallback
 * ลงไปเรื่อย ๆ จนเจอชิ้นที่มีจริง
 *
 * ไม่มีชื่อเล่น: NICK_FIRST/FIRST_NICK ตกมาใช้ชื่อจริงเฉย ๆ ไม่ใช่ใส่วงเล็บว่าง
 */
export function composeDisplayName(
  parts: DisplayNameParts,
  format: DisplayNameFormat | string,
): string {
  const first = parts.firstName.trim();
  const last = parts.lastName.trim();
  const nick = parts.preferredName.trim();

  const fullName = `${first} ${last}`.trim();
  // ค่าที่ใช้เมื่อรูปแบบที่เลือกประกอบออกมาไม่ได้ (เช่นไม่มีชื่อเล่น)
  const fallback = first !== '' ? first : last !== '' ? last : nick;

  // รูปแบบที่ไม่รู้จัก (ข้อมูลเก่า/ค่าที่ใส่มือในฐานข้อมูล) = ใช้ค่าตั้งต้น ไม่ใช่พังทั้งหน้า
  const chosen = isDisplayNameFormat(format) ? format : DEFAULT_DISPLAY_NAME_FORMAT;

  switch (chosen) {
    case 'NICK_FIRST':
      return nick !== '' && first !== '' ? `${nick}-${first}` : nick !== '' ? nick : fallback;
    case 'FIRST_NICK':
      return nick !== '' && first !== '' ? `${first}(${nick})` : nick !== '' ? nick : fallback;
    case 'FULL_NAME':
      return fullName !== '' ? fullName : fallback;
  }
}

/** ป้ายภาษาไทยของแต่ละรูปแบบ — หน้าตั้งค่าและอีเมลแจ้งเตือนใช้ชุดเดียวกัน */
export const DISPLAY_NAME_FORMAT_LABELS: Record<DisplayNameFormat, string> = {
  NICK_FIRST: 'ชื่อเล่น-ชื่อจริง',
  FIRST_NICK: 'ชื่อจริง(ชื่อเล่น)',
  FULL_NAME: 'ชื่อจริง นามสกุล',
};
