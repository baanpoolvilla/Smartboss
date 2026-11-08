/** ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์ — ดู lib/ceo-title.ts */
export const DEFAULT_CEO_TITLE = "CEO";

export function normalizeCeoTitle(value: unknown): string {
  const text = typeof value === "string" ? value.trim().slice(0, 30) : "";
  return text || DEFAULT_CEO_TITLE;
}

/** แทนคำว่า CEO ในข้อความที่แสดง (เช่นป้ายในตารางค่าคงที่) ด้วยชื่อเรียกของบริษัท */
export function ceoText(text: string, title: string): string {
  return title === DEFAULT_CEO_TITLE ? text : text.replace(/\bCEO\b/g, title);
}
