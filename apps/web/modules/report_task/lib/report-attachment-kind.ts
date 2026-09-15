import { fileKindOf, fileIconKind } from "@/modules/company-files/lib/file-meta";

/**
 * A post/reply attachment is one of three things as far as every render site
 * cares: something to show inline (image), something to play (video), or
 * something to hand over as a file (everything else — pdf/word/excel/…).
 *
 * `ReportPostImage.mime` is undefined on anything attached before the field
 * existed, and back then every attachment really was an image — so a missing
 * mime means "image", never "unknown document".
 */
export type ReportAttachmentKind = "image" | "video" | "doc";

export function attachmentKind(mime?: string): ReportAttachmentKind {
  if (!mime) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  return "doc";
}

export function isImageAttachment(mime?: string): boolean {
  return attachmentKind(mime) === "image";
}

export function isVideoAttachment(mime?: string): boolean {
  return attachmentKind(mime) === "video";
}

/** Everything that isn't a picture or a clip — the "เอกสาร" filter's input. */
export function isDocAttachment(mime?: string): boolean {
  return attachmentKind(mime) === "doc";
}

/**
 * How many of a post's attachments count as photo evidence — a room's
 * "ต้องแนบรูปอย่างน้อย N รูป" rule (minImages, and the compliance report's
 * "แนบรูปไม่ครบ" flag) is about pictures of the work, so attaching a
 * spreadsheet must not satisfy it now that posts can carry one. Videos do
 * count: a clip of the site is the same evidence a photo of it is.
 */
export function photoCount(attachments: { mime?: string }[]): number {
  return attachments.filter((a) => !isDocAttachment(a.mime)).length;
}

/** "PDF" / "Word" / "Excel" — the same labels the company-files library uses,
 * so a document reads identically in a room and in the file library it can be
 * saved into. */
export function attachmentTypeLabel(mime?: string): string {
  return mime ? fileIconKind(mime) : "รูปภาพ";
}

export { fileKindOf };

/** ก่อน Attachment (task/comment) มี field `mime` เอง เก็บไว้แค่ป้ายภาษาไทย
 * สั้นๆ (ดู task-attachment-upload.ts's labelFor) — เดา mime กลับจากป้ายนั้น
 * ให้พอเปิดในตัวดูไฟล์เดียวกับ report-feed ได้ถูกโหมด (รูป/วิดีโอ/เอกสาร)
 * เฉพาะไฟล์เก่าที่อัปโหลดไว้ก่อนมี field นี้เท่านั้น — ของใหม่มี a.mime ตรงๆ
 * อยู่แล้วไม่ต้องเดา ป้าย "ไฟล์" เดายังไงก็ไม่รู้ชนิดจริง ปล่อย undefined ไว้
 * (ตกไปเป็นการ์ดดาวน์โหลดเฉยๆ) ป้าย "ไฟล์" ทั่วไปคืน mime ปลอมที่ไม่ใช่ทั้ง
 * image/video โดยตั้งใจ — เพื่อให้ attachmentKind() จัดเป็น "doc" (การ์ด
 * ดาวน์โหลด) แทนที่จะตกไปใช้กติกา "ไม่มี mime = รูปภาพ" ของ ReportPostImage
 * (ใช้ได้กับของนั้นเพราะของเก่าจริงๆ เป็นรูปทั้งหมด แต่ Attachment ของ
 * task/comment มีทั้งไฟล์อื่นมาตั้งแต่ต้น ถือว่าเป็นรูปไปเลยจะพังกลายเป็น
 * broken image แทนการ์ดดาวน์โหลด) */
export function mimeFromLegacyTaskLabel(label: string): string {
  switch (label) {
    case "รูปภาพ":
      return "image/jpeg";
    case "วิดีโอ":
      return "video/mp4";
    case "PDF":
      return "application/pdf";
    case "Word":
      return "application/msword";
    case "ZIP":
      return "application/zip";
    case "ข้อความ":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

/**
 * What the "แนบรูป/คลิป" file pickers accept. Deliberately an explicit list
 * rather than a wildcard: it mirrors ALLOWED_TYPES in
 * `app/api/report-task/uploads/route.ts`, which is the real gate (it re-checks
 * the bytes themselves, not the browser's guess). Anything added here without
 * being added there gets picked in the dialog and then rejected on upload,
 * which is a worse experience than not offering it at all.
 */
export const REPORT_ATTACHMENT_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/plain",
  "application/zip",
  // Extensions alongside the MIME types — Windows file dialogs match on
  // extension, and a .docx picked there can arrive with an empty `type`.
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip",
].join(",");
