/** ชนิดไฟล์ที่สร้าง thumbnail หน้าแรกได้จริง (ดู generate-doc-thumbnail.ts)
 * — แยกเป็นไฟล์บริสุทธิ์ (ไม่ import "server-only") เพื่อให้เทสต์ปกติ
 * (`pnpm test`) import ตรงได้โดยไม่ต้องพึ่ง server-only stub ที่ใช้เฉพาะ
 * เทสต์กลุ่ม tenant-isolation */
const OFFICE_EXTS = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx"]);

export function supportsDocThumbnail(ext: string): boolean {
  return ext === "pdf" || OFFICE_EXTS.has(ext);
}

/** true เฉพาะไฟล์ office ที่ต้องผ่าน soffice แปลงเป็น pdf ก่อน — pdf เองส่งตรง
 * เข้า pdftoppm ได้เลยไม่ต้องผ่านขั้นนี้ */
export function needsOfficeConversion(ext: string): boolean {
  return OFFICE_EXTS.has(ext);
}
