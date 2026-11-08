/**
 * ลิงก์ยาวในแชทแสดงแบบย่อ — กดแล้วยังไปลิงก์เต็มเหมือนเดิม (ผู้ใช้ 8/11/2569 "Discord ย่อ link ให้สั้นลง auto"
 * · "ไม่ต้องแปลงเป็นไทย แค่อยากให้ลิงก์มันน้อย")
 *
 *   https://shopee.co.th/%E0%B8%96%E0%B8%B2...-i.1013987281.28438598804?extraParams=...
 *   → https://shopee.co.th/%E0%B8%96%E0%B8%B2%E0%B8%94%E0%B8%99%E0%B9%89…
 *
 * ตัวลิงก์ไม่เปลี่ยน แค่ตัดที่ max ตัวอักษรแล้วต่อ "…" — สั้นกว่านั้นแสดงเต็มตามเดิม
 */
export function displayUrl(url: string, max = 60): string {
  return url.length <= max ? url : `${url.slice(0, max)}…`;
}
