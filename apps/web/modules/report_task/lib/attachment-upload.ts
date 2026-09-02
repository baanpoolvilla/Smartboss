import { uploadCompressedImage } from "@/modules/report_task/lib/image-resize";
import type { IssueAttachment } from "@/modules/report_task/types/issue";

/** Client-side quota mirrored from the server's per-request limits (see
 * /api/uploads) — checked before the request fires so the user gets an
 * instant, specific error instead of a generic 413 after a slow upload. */
const MAX_BYTES_BY_KIND: { test: (mime: string) => boolean; maxBytes: number }[] = [
  { test: (m) => m.startsWith("image/"), maxBytes: 8 * 1024 * 1024 },
  { test: (m) => m.startsWith("video/"), maxBytes: 25 * 1024 * 1024 },
  { test: () => true, maxBytes: 8 * 1024 * 1024 },
];

function maxBytesFor(mime: string): number {
  return MAX_BYTES_BY_KIND.find((k) => k.test(mime))!.maxBytes;
}

/** Uploads one file and returns a ready-to-store IssueAttachment. Images get
 * downscaled+re-encoded client-side first (uploadCompressedImage, same as
 * every other image-upload path in the app); everything else goes up as-is
 * through the same /api/uploads endpoint (see that route for the allowed
 * type list + server-side magic-byte check). */
export async function uploadIssueAttachment(file: File, uploadedBy: string): Promise<IssueAttachment> {
  const isImage = file.type.startsWith("image/");
  const maxBytes = maxBytesFor(file.type);
  if (!isImage && file.size > maxBytes) {
    throw new Error(`ไฟล์ใหญ่เกินไป (จำกัด ${Math.round(maxBytes / 1024 / 1024)}MB)`);
  }

  let url: string;
  let mime: string;
  let size: number;
  if (isImage) {
    const compressed = await uploadCompressedImage(file);
    url = compressed.url;
    mime = "image/jpeg";
    size = compressed.size;
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
    size,
    mime,
    url,
    isPreviewable: mime.startsWith("image/"),
    uploadedBy,
    uploadedAt: new Date().toISOString(),
  };
}
