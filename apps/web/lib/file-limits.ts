/**
 * ข้อความ "ไฟล์ใหญ่เกิน" แบบเดียวกันทั้งระบบ — บอกทั้งขนาดไฟล์จริงและเพดาน ผู้ใช้จะได้รู้ว่าต้องย่อแค่ไหน
 * ("ถ้ามันเลยให้ขึ้นเตือนว่าไฟล์ใหญ่เกิน และบอกว่าใส่ได้เท่าไหร่ ของเค้าเท่าไหร่ ... ทุกโมดูลรูปแบบเดียวกัน")
 *
 * ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์ (ข้อความ error ของ API/server action) และฝั่งหน้าเว็บ (เช็คก่อนอัปโหลด)
 * ไม่ import อะไรที่ผูกฝั่งใดฝั่งหนึ่ง
 */

export const MB = 1024 * 1024;

/**
 * เพดานของฟอร์มที่ส่งไฟล์ไปกับการกดบันทึก (server action) — ทั้งคำขอต้องไม่เกิน 25MB
 * (next.config serverActions.bodySizeLimit + Caddy request_body) เผื่อข้อมูลฟอร์มอื่นไว้ 1MB
 * ใช้เป็นค่าตั้งต้นของตัวกันไฟล์ใหญ่ (components/shell/file-size-guard.tsx)
 */
export const FORM_UPLOAD_MAX_BYTES = 24 * MB;

/** 850 KB / 3.2 MB / 25 MB / 1.05 GB — ทศนิยมเฉพาะตอนจำเป็น */
export function formatBytes(bytes: number): string {
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * MB) return `${parseFloat((bytes / MB).toFixed(1))} MB`;
  return `${(bytes / (1024 * MB)).toFixed(2)} GB`;
}

/** ไฟล์ "x.jpg" ใหญ่เกินไป — ไฟล์นี้ 32.4 MB แต่ใส่ได้ไม่เกิน 25 MB */
export function fileTooLargeMessage(file: { name?: string | null; size: number }, maxBytes: number): string {
  const name = file.name ? `"${file.name}" ` : "";
  return `ไฟล์ ${name}ใหญ่เกินไป — ไฟล์นี้ ${formatBytes(file.size)} แต่ใส่ได้ไม่เกิน ${formatBytes(maxBytes)}`;
}

/** ไฟล์ที่แนบรวมกันใหญ่เกินไป — รวม 31 MB แต่ส่งได้ไม่เกิน 24 MB ต่อครั้ง */
export function totalTooLargeMessage(totalBytes: number, maxBytes: number): string {
  return `ไฟล์ที่แนบรวมกันใหญ่เกินไป — รวม ${formatBytes(totalBytes)} แต่ส่งได้ไม่เกิน ${formatBytes(maxBytes)} ต่อครั้ง (ลองแนบให้น้อยลง หรือแบ่งส่งหลายครั้ง)`;
}

/** ไฟล์แรกที่เกินเพดาน → ข้อความ, ไม่มี = null */
export function firstTooLarge(files: Iterable<{ name?: string | null; size: number }>, maxBytes: number): string | null {
  for (const f of files) if (f.size > maxBytes) return fileTooLargeMessage(f, maxBytes);
  return null;
}
