/**
 * สีของแต่ละคนใน avatar — สุ่มแบบ deterministic จาก id (คนเดียวกันได้สีเดียวกัน
 * เสมอทุกที่ที่เจอ ไม่ต้องเก็บสีไว้ที่ไหน) ต่างจาก Avatar เดิมของ @smartboss/ui
 * ที่ทุกคนได้สีเดียวกันหมด (--module-color) ซึ่งพอเป็นห้องที่มีหลายคนพร้อมกัน
 * (channel list, message thread) แยกไม่ออกว่า avatar ไหนเป็นของใคร
 */
const PALETTE: { bg: string; text: string }[] = [
  { bg: "#DBEAFE", text: "#1D4ED8" }, // blue
  { bg: "#EDE9FE", text: "#6D28D9" }, // violet
  { bg: "#FCE7F3", text: "#BE185D" }, // pink
  { bg: "#FFEDD5", text: "#C2410C" }, // orange
  { bg: "#D1FAE5", text: "#047857" }, // emerald
  { bg: "#FEF3C7", text: "#B45309" }, // amber
  { bg: "#CFFAFE", text: "#0E7490" }, // cyan
  { bg: "#E0E7FF", text: "#4338CA" }, // indigo
  { bg: "#FEE2E2", text: "#B91C1C" }, // red
  { bg: "#ECFCCB", text: "#4D7C0F" }, // lime
];

export function avatarColorFor(id: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]!;
}
