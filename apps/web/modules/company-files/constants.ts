/** ต้องตรงกับ Module.code ใน DB — seed ลงทะเบียนไว้แล้ว (isEnabled: false โดย
 * ค่าเริ่มต้น เปิดใช้ทีละบริษัทได้ที่ /admin/modules) */
export const COMPANY_FILES_CODE = "company_files";

export const COMPANY_FILES_BASE = "/company-files";

/** MIME ที่อนุญาตอัปโหลด — เหมือนกับ report-task/uploads route ทุกตัว (ดู
 * apps/web/app/api/report-task/uploads/route.ts) เพื่อให้ policy เดียวกันทั้งระบบ
 * ไม่ใช่แค่ก็อปมาเฉยๆ — ทั้งสองจุดควรอัปเดตพร้อมกันถ้าจะเพิ่มชนิดไฟล์ */
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/zip",
  "video/mp4",
  "video/webm",
  // เอกสารออฟฟิศที่ SharePoint/Teams ใช้กันจริง — report-task/uploads ไม่มีพวกนี้
  // เพราะโมดูลนั้นไม่เคยต้องรับ ที่นี่ต้องรับเพราะเป็นคลังไฟล์เอกสารกลาง
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

export const MAX_FILE_MB = 50;
