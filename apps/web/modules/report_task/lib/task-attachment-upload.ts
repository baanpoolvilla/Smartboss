import { uploadCompressedImage } from "@/modules/report_task/lib/image-resize";
import { formatFileSize } from "@/modules/report_task/lib/format";
import { useAttachmentSettingsStore } from "@/modules/report_task/store/attachment-settings-store";
import type { Attachment } from "@/modules/report_task/types";

/** Short Thai label for the attachment list — shown next to the size, e.g. "PDF · 1.2 MB". */
function labelFor(mime: string): string {
  if (mime.startsWith("image/")) return "รูปภาพ";
  if (mime.startsWith("video/")) return "วิดีโอ";
  if (mime === "application/pdf") return "PDF";
  if (mime === "application/zip") return "ZIP";
  if (mime === "text/plain") return "ข้อความ";
  return "ไฟล์";
}

/**
 * อัปโหลดไฟล์หนึ่งไฟล์จริง (ผ่าน /api/report-task/uploads เหมือนกับที่ใช้กับ
 * แจ้งปัญหา — ดู attachment-upload.ts) แล้วคืนเป็น Attachment พร้อมใช้กับ
 * task.attachments / comment.attachments — ใช้แทนของปลอมเดิม
 * (attachMockFile) ที่แค่สร้างชื่อไฟล์+ขนาดสมมติโดยไม่มีการอัปโหลดจริง
 *
 * เช็คขนาดฝั่ง client ก่อนตาม attachment-settings ของบริษัท (จะได้ error
 * ทันทีไม่ต้องรออัปโหลดเสร็จก่อนโดนเซิร์ฟเวอร์ปฏิเสธ) — เซิร์ฟเวอร์ยังบังคับ
 * ค่าเดียวกันนี้อีกชั้นเสมอ ไม่ได้พึ่งการเช็คฝั่งนี้เป็นด่านเดียว
 */
export async function uploadTaskAttachment(file: File, uploadedBy: string): Promise<Attachment> {
  const settings = useAttachmentSettingsStore.getState().settings;
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  const maxMB = isImage ? settings.maxImageMB : isVideo ? settings.maxVideoMB : settings.maxFileMB;
  const maxBytes = maxMB * 1024 * 1024;
  if (!isImage && file.size > maxBytes) {
    throw new Error(`ไฟล์ใหญ่เกินไป (จำกัด ${maxMB}MB)`);
  }

  let url: string;
  let mime: string;
  let size: number;
  if (isImage) {
    url = await uploadCompressedImage(file);
    mime = "image/jpeg";
    size = file.size; // ขนาดหลังบีบอัดไม่ได้คืนกลับมาจาก uploadCompressedImage — ใช้ขนาดเดิมแทนเพื่อแสดงผลคร่าวๆ
  } else {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/report-task/uploads", { method: "POST", body: form });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? "อัปโหลดไฟล์ไม่สำเร็จ");
    }
    const data = (await res.json()) as { url: string; mime: string; size: number };
    url = data.url;
    mime = data.mime;
    size = data.size;
  }

  return {
    id: `att-${crypto.randomUUID()}`,
    name: file.name || "ไฟล์แนบ",
    size: formatFileSize(size),
    type: labelFor(mime),
    uploadedBy,
    uploadedAt: new Date().toISOString(),
    url,
  };
}
