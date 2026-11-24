/**
 * ป้ายตัวเลขสีทึบตัวขาว (หัวคอลัมน์บอร์ดงาน/บอร์ดใบงาน) — พื้น = สีคอลัมน์ผสมดำ
 * ธีมสว่าง: เลือกสัดส่วนสีคอลัมน์ทีละสี ให้ตัวขาวอ่านได้ (≥ 4.6:1) โดยเข้มน้อยที่สุดเท่าที่จำเป็น
 *   สีเข้มอยู่แล้ว (ฟ้า/เขียว) ≈ 82% เท่าเดิม · สีอ่อน (เขียวอ่อน #a7e8bf ของ "รอตรวจสอบ") ≈ 50%
 * ธีมมืดตั้ง --chip-mix เองใน theme-dark.css → ค่าที่คำนวณนี้เป็นแค่ค่าสำรอง (ไม่กระทบธีมมืด)
 * สีที่ไม่ใช่ hex (var(--…)) ใช้ 64%
 */
export function chipMixFallback(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return "64%";
  const rgb = [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16));
  const lin = (x: number) => {
    const v = x / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  for (let p = 82; p >= 30; p -= 2) {
    const [r, g, b] = rgb.map((v) => lin((v * p) / 100));
    const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    if (1.05 / (lum + 0.05) >= 4.6) return `${p}%`;
  }
  return "30%";
}

/** พื้นป้ายตัวเลข: `color-mix(in srgb, <สี> var(--chip-mix, <ค่าที่คำนวณ>), black)` */
export function chipFill(color: string): string {
  return `color-mix(in srgb, ${color} var(--chip-mix, ${chipMixFallback(color)}), black)`;
}
