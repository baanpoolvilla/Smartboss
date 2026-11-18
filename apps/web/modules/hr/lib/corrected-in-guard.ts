/**
 * กด "ออกงาน" ตอนเช้า หลังได้เวลาเข้าจากคำขอแก้เวลา = น่าจะกดผิด ไม่ใช่ออกจริง
 *
 * ลืมสแกนตอนมาถึง → ขอแก้เวลาเข้า → อนุมัติแล้วแอปเห็นว่า "อยู่ในงาน" ปุ่มเลยกลายเป็น "ออกงาน"
 * คนที่ยังคิดว่าต้องกดเข้างานอยู่ กดตามปุ่มไปเลยได้ "ออกงาน" ตอนเช้า (18 พ.ย. 69: เข้า 08:11 · ออก 08:17)
 * ด่านเดิม (กันกดออกภายใน 30 นาทีหลังเข้า) ดูแค่สแกนจริง ไม่เห็นเวลาเข้าที่แก้ให้
 *
 * ไม่ให้ออก ถ้า: รายการล่าสุดของวันคือเวลาเข้าที่แก้แล้ว และตอนนี้ยังไม่ถึงครึ่งกะ
 * กะข้ามคืน / วันหยุด / ไม่มีกะ = ไม่กัน (ด่านนี้ห้ามทำให้คนออกงานไม่ได้โดยไม่จำเป็น)
 */
export interface GuardEvent {
  intent: string;
  capturedAt: string;
  sourceType: string;
}

export interface GuardShift {
  startMinutes: number;
  endMinutes: number;
  restDay: boolean;
}

export function correctedInBlocksOut(
  events: readonly GuardEvent[],
  shift: GuardShift | null,
  now: Date,
  timeZone = "Asia/Bangkok",
): { inAt: string; untilMinutes: number } | null {
  const last = events
    .filter((e) => e.intent === "AUTO" || e.intent === "CLOCK_IN" || e.intent === "CLOCK_OUT")
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime())
    .at(-1);
  if (!last || last.sourceType !== "ADJUSTMENT" || last.intent !== "CLOCK_IN") return null;
  if (!shift || shift.restDay || shift.endMinutes <= shift.startMinutes) return null;
  const mid = Math.round((shift.startMinutes + shift.endMinutes) / 2);
  return localMinutes(now, timeZone) < mid ? { inAt: last.capturedAt, untilMinutes: mid } : null;
}

function localMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}
