/**
 * สถานะลงเวลาของวัน — "ตอนนี้อยู่ในงานไหม" + เวลาเข้า/ออกที่จะโชว์
 *
 * ใช้ร่วมกันสามที่ให้ตัดสินตรงกัน: ปุ่มในหน้าลงเวลา (app/m/today.tsx, แอป + LINE), ไอคอนบนหน้าแรก
 * (components/home/clock-tile.tsx) และ /api/m/today (กะข้ามเที่ยงคืน)
 *
 * เดิมดูแค่ "รายการล่าสุดเป็น CLOCK_IN ไหม" ⇒ คนที่สแกนนิ้วเข้ามาแล้ว (เครื่องสแกนส่ง AUTO ไม่บอก
 * ว่าเข้าหรือออก) เปิดแอปจะเจอปุ่ม "เข้างาน" อีกรอบ และกล่องเวลาเข้างานว่าง · ตอนนี้ AUTO = สลับสถานะ
 * (ไม่ได้อยู่ในงาน → เข้า, อยู่ในงาน → ออก) แบบเดียวกับที่ระบบคิดเวลาจับคู่สแกนนิ้ว
 */
export interface ClockEventLike {
  intent: string;
  capturedAt: string;
}

export function clockState<E extends ClockEventLike>(
  events: readonly E[],
  /** กะที่เข้าไว้ตั้งแต่เมื่อวานแล้วยังไม่ออก (กะดึก) — ถือว่าเริ่มวันนี้แบบ "อยู่ในงาน" */
  carriedIn: E | null = null,
): { open: boolean; firstIn: E | null; lastOut: E | null; openedBy: E | null } {
  let open = carriedIn !== null;
  let firstIn: E | null = carriedIn;
  let lastOut: E | null = null;
  /** รายการที่เปิดช่วง "อยู่ในงาน" ล่าสุด — ใช้หากะที่ค้างข้ามคืน */
  let openedBy: E | null = carriedIn;
  for (const e of events) {
    if (e.intent === "CLOCK_IN" || (e.intent === "AUTO" && !open)) {
      if (!open) openedBy = e;
      open = true;
      if (firstIn === null) firstIn = e;
    } else if (e.intent === "CLOCK_OUT" || (e.intent === "AUTO" && open)) {
      open = false;
      lastOut = e;
    }
    // BREAK_START / BREAK_END ไม่เปลี่ยนว่าอยู่ในงานหรือไม่
  }
  return { open, firstIn, lastOut, openedBy: open ? openedBy : null };
}

/** กะดึก: ยังอยู่ในงานจากเมื่อวาน ถ้าเข้ามาไม่เกินกี่ชั่วโมง (เกินนี้ = ลืมกดออก ไม่ใช่กะข้ามคืน) */
export const CARRY_OVER_HOURS = 14;

/** หน้าลงเวลายิงเหตุการณ์นี้หลังกดลงเวลา — ปุ่มกลางของแถบล่างที่ค้างอยู่บนจออัปเดตตามทันที */
export const CLOCK_CHANGED_EVENT = "smartboss:clock-changed";
