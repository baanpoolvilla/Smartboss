/**
 * ตัวช่วยเรื่องอิโมจิที่ใช้ทั้งฝั่งเบราว์เซอร์และเซิร์ฟเวอร์
 * (ตัวเลือกอิโมจิอยู่ที่ components/emoji-picker.tsx)
 */

const EMOJI_CHARS_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[‍️⃣#*0-9])+$/u;
const HAS_EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

/**
 * เป็นอิโมจิ "ตัวเดียว" ตามที่ตาเห็นหรือไม่ (👨‍👩‍👧, 👍🏽, 🇹🇭, 1️⃣ = 1 ตัว)
 * ใช้ตรวจรีแอคชันที่เปิดให้เลือกจากชุดเต็ม — กันข้อความ/สตริงยาวถูกยัดมาเป็น "อิโมจิ"
 */
export function isSingleEmoji(value: string): boolean {
  if (!value || value.length > 32 || !EMOJI_CHARS_RE.test(value) || !HAS_EMOJI_RE.test(value)) return false;
  let count = 0;
  for (const _ of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)) if (++count > 1) return false;
  return true;
}

/**
 * รีแอคชันที่มีคนกดจริง เรียงตามชุดด่วน (`order`) ก่อน แล้วต่อด้วยอิโมจิอื่นที่เลือกจากชุดเต็ม
 * (เดิมแต่ละหน้าไล่เฉพาะรายการตายตัวของตัวเอง — อิโมจินอกรายการถูกบันทึกแต่ไม่ถูกวาด)
 */
export function activeReactionList(
  reactions: Record<string, string[]> | undefined | null,
  order: readonly string[]
): { emoji: string; users: string[] }[] {
  const map = reactions ?? {};
  const keys = [...order.filter((e) => e in map), ...Object.keys(map).filter((e) => !order.includes(e))];
  return keys.map((emoji) => ({ emoji, users: map[emoji] ?? [] })).filter((r) => r.users.length > 0);
}
