/**
 * หมวดหมู่และโซนของ Contact — **ไม่ใช่ค่าคงที่ในโค้ด**
 *
 * เดิมไฟล์นี้ hard code ไว้ว่ามีโซน "บางแสน / พัทยา" กับหมวด "ร้านอาหาร" ฯลฯ
 * ซึ่งเป็นการแบ่งของบริษัทเดียว บริษัทอื่นแบ่งตามจังหวัด ตามสาขา หรือไม่แบ่งเลย
 * ตอนนี้รายการตัวเลือกจึงมาจากข้อมูลของบริษัทนั้นเอง — พิมพ์ค่าใหม่ในฟอร์มได้เลย
 * แล้วค่านั้นจะกลายเป็นตัวเลือกให้คนถัดไปโดยอัตโนมัติ
 */

/** ค่าที่ใช้แทน "ยังไม่ระบุ" ในตัวกรอง — ไม่ใช่ค่าที่เก็บลงฐานข้อมูล */
export const UNSET = "\u0000unset";

export interface Facet {
  /** ค่าจริงในฐานข้อมูล หรือ UNSET สำหรับกลุ่ม "ยังไม่ระบุ" */
  value: string;
  label: string;
  count: number;
}

/**
 * นับว่าแต่ละค่าถูกใช้กี่รายการ เรียงมากไปน้อย เท่ากันเรียงตามชื่อ
 *
 * ตัดช่องว่างหัวท้ายก่อนนับ — ข้อมูลที่ import เข้ามามี "พัทยา" กับ "พัทยา "
 * ปนกันได้ ถ้าไม่ตัดจะกลายเป็นสองโซนคนละอันบนแถบกรอง ซึ่งดูเหมือนระบบพัง
 *
 * กลุ่ม "ยังไม่ระบุ" อยู่ท้ายสุดเสมอไม่ว่าจะมีกี่รายการ — มันไม่ใช่หมวดจริง
 */
export function facetsOf<T>(rows: T[], pick: (r: T) => string | null): Facet[] {
  const counts = new Map<string, number>();
  let unset = 0;
  for (const r of rows) {
    const v = (pick(r) ?? "").trim();
    if (!v) unset += 1;
    else counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const out: Facet[] = Array.from(counts, ([value, count]) => ({
    value,
    label: value,
    count,
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "th"));

  if (unset > 0) out.push({ value: UNSET, label: "ยังไม่ระบุ", count: unset });
  return out;
}

/** ค่าตรงกับตัวกรองที่เลือกไหม (null = ไม่ได้กรอง) */
export function matchesFacet(value: string | null, selected: string | null) {
  if (selected === null) return true;
  const v = (value ?? "").trim();
  return selected === UNSET ? v === "" : v === selected;
}
