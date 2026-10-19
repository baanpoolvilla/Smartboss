/**
 * ประกอบชื่อที่แสดงสำหรับ "ตัวอย่าง" ในหน้าบัญชีของฉัน (ฝั่ง browser)
 *
 * สูตรจริงอยู่ที่ composeDisplayName ใน @workforce/domain (ระบบบุคคลประกอบชื่อจากตัวนั้นตอนบันทึก)
 * ไม่ import ตัวนั้นมาฝั่ง browser เพราะแพ็กเกจ domain ดึงโค้ดฝั่งเซิร์ฟเวอร์มาด้วย —
 * display-name-preview.test.ts เทียบผลกับตัวจริงทุกรูปแบบ ถ้าสูตรจริงเปลี่ยน เทสต์จะฟ้อง
 */
export function previewDisplayName(first: string, last: string, nick: string, format: string): string {
  const f = first.trim();
  const l = last.trim();
  const n = nick.trim();
  const full = `${f} ${l}`.trim();
  const fallback = f !== "" ? f : l !== "" ? l : n;
  switch (format) {
    case "NICK_FIRST":
      return n !== "" && f !== "" ? `${n}-${f}` : n !== "" ? n : fallback;
    case "FIRST_NICK":
      return n !== "" && f !== "" ? `${f}(${n})` : n !== "" ? n : fallback;
    default:
      return full !== "" ? full : fallback;
  }
}
