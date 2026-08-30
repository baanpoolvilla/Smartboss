import type { UploadedFileInfo } from "../data/files";

/** POSTs the raw file to the company-files upload endpoint — same shape
 * every other module's client-side uploader uses (report_task's
 * attachment-upload.ts, image-resize.ts): plain fetch + FormData, no
 * client-side compression (these are documents, not photos to shrink). */
export async function uploadCompanyFile(file: File): Promise<UploadedFileInfo> {
  const form = new FormData();
  form.append("file", file);
  form.append("name", file.name);
  const res = await fetch("/api/company-files/uploads", { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "อัปโหลดไม่สำเร็จ");
  return data as UploadedFileInfo;
}
