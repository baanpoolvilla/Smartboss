/**
 * สีประจำประเภทวันหยุด/ลา — ใช้ร่วมกันระหว่างปฏิทินทีม (/hr) กับปฏิทินของ Project Management
 * ประเภทเดียวกันจะได้สีเดียวกันทั้งสองหน้า
 */

/** สีจากชื่อ — คำนวณให้คงที่ ไม่ใช่สุ่มหรือไล่ตามลำดับในลิสต์ */
function hueOf(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }
  // เลี่ยงช่วง 55-75 (เหลืองอ่อน) ที่อ่านบนพื้นขาวไม่ออก
  return hash >= 55 && hash <= 75 ? (hash + 40) % 360 : hash;
}

/**
 * เดาจากชื่อประเภทที่ HR ตั้ง: ชื่อที่ไม่เข้าเค้าไหนเลยได้สีจากชื่อ (คงที่ ไม่สุ่ม)
 */
export function typeHue(name: string | null, autoApprove: boolean): number {
  const n = (name ?? "").toLowerCase();
  if (/holiday|ฮอลิเดย์|นักขัตฤกษ์/.test(n)) return 215; // น้ำเงิน
  if (/day.?off|หยุดประจำ|^off$/.test(n)) return 150; // เขียว
  if (/ป่วย|sick/.test(n)) return 0; // แดง
  if (/กิจ|personal/.test(n)) return 175; // เขียวอมฟ้า
  if (/พักร้อน|vacation|annual/.test(n)) return 38; // เหลืองส้ม
  if (/home|wfh/.test(n)) return 18; // ส้ม
  if (/ค่าจ้าง|unpaid/.test(n)) return 280; // ม่วง
  return name ? hueOf(name) : autoApprove ? 150 : 215;
}

/**
 * สีเดียวกับ `hsl(hue 65% 45%)` แต่เป็น hex — ปฏิทินของ PM ต่อท้ายค่าความโปร่ง
 * (`${color}26`) จึงรับได้แค่ hex
 */
export function typeHex(name: string | null, autoApprove: boolean): string {
  const h = typeHue(name, autoApprove);
  const s = 0.65;
  const l = 0.45;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}
