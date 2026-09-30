import type { UploadedFileInfo } from "../data/files";

import { MB, fileTooLargeMessage } from "@/lib/file-limits";
import { MAX_FILE_MB } from "../constants";
/** POSTs the raw file to the company-files upload endpoint — same shape
 * every other module's client-side uploader uses (report_task's
 * attachment-upload.ts, image-resize.ts): plain fetch + FormData, no
 * client-side compression (these are documents, not photos to shrink). */
export async function uploadCompanyFile(file: File): Promise<UploadedFileInfo> {
  // เช็คก่อนส่ง — บอกขนาดจริง/เพดานทันที ไม่ต้องรออัปโหลดช้า ๆ แล้วค่อยพัง
  if (file.size > MAX_FILE_MB * MB) throw new Error(fileTooLargeMessage(file, MAX_FILE_MB * MB));
  const form = new FormData();
  form.append("file", file);
  form.append("name", file.name);
  const res = await fetch("/api/company-files/uploads", { method: "POST", body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error ?? (res.status === 413 ? fileTooLargeMessage(file, MAX_FILE_MB * MB) : "อัปโหลดไม่สำเร็จ"));
  }
  return data as UploadedFileInfo;
}
