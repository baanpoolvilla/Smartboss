/** "2.4 MB" — same base-1024 units every OS file browser uses. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

export type FileKind = "image" | "pdf" | "word" | "excel" | "powerpoint" | "video" | "archive" | "text" | "other";

const KIND_BY_MIME: Record<string, FileKind> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "application/pdf": "pdf",
  "application/msword": "word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word",
  "application/vnd.ms-excel": "excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
  "application/vnd.ms-powerpoint": "powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "powerpoint",
  "video/mp4": "video",
  "video/webm": "video",
  "application/zip": "archive",
  "text/plain": "text",
};

export function fileKindOf(mimeType: string): FileKind {
  return KIND_BY_MIME[mimeType] ?? "other";
}

const KIND_LABEL: Record<FileKind, string> = {
  image: "รูปภาพ",
  pdf: "PDF",
  word: "Word",
  excel: "Excel",
  powerpoint: "PowerPoint",
  video: "วิดีโอ",
  archive: "ไฟล์บีบอัด",
  text: "ข้อความ",
  other: "ไฟล์",
};

export function fileIconKind(mimeType: string): string {
  return KIND_LABEL[fileKindOf(mimeType)];
}

/** "พรีวิวในระบบได้โดยไม่ต้องดาวน์โหลด" — เฉพาะรูปกับ PDF ตามที่ขอ
 * ("ดูตัวอย่างไฟล์ในระบบ (รูป/PDF) โดยไม่ต้องดาวน์โหลด") — ชนิดอื่นโหลดตัว
 * ไฟล์ทั้งไฟล์มาแสดงในเบราว์เซอร์ไม่ได้ตรงๆ (docx/xlsx ต้องมี renderer แยก
 * ซึ่งยังไม่มีในเวอร์ชันนี้) จึงเหลือแค่ปุ่มดาวน์โหลดให้แทน */
export function isPreviewable(mimeType: string): boolean {
  const kind = fileKindOf(mimeType);
  return kind === "image" || kind === "pdf";
}
