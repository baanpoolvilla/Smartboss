import { useAttachmentSettingsStore } from "@/modules/report_task/store/attachment-settings-store";

/** Shared canvas downscale step — draws `file` onto a canvas at most
 * `maxWidth` wide, used by both the upload path and the legacy inline path.
 *
 * Prefers `createImageBitmap(file)` over the old FileReader→base64→`<img>`
 * path: a modern iPhone photo (12-48MP) read via `readAsDataURL` holds both
 * the original file AND a ~1.37x-larger base64 string in memory at once,
 * then a full-resolution raster on top of that once `<img>` decodes it —
 * enough to crash the Safari tab outright on large photos (issue C).
 * `createImageBitmap` decodes the Blob directly off the main thread with no
 * base64 step, and `.close()` releases it right after drawing instead of
 * waiting on the image element's GC — important when a post has several
 * large attachments queued back to back. */
async function drawToCanvas(file: File, maxWidth: number): Promise<HTMLCanvasElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await drawToCanvasViaBitmap(file, maxWidth);
    } catch {
      // createImageBitmap can reject on some iOS Safari versions for certain
      // formats — fall back to the FileReader+<img> path rather than failing
      // the upload outright.
    }
  }
  return drawToCanvasLegacy(file, maxWidth);
}

async function drawToCanvasViaBitmap(file: File, maxWidth: number): Promise<HTMLCanvasElement> {
  // Two decodes, not one: the first is closed immediately and only ever used
  // to read natural width/height. The second — the one whose pixels we
  // actually keep — passes resizeWidth/resizeHeight so engines that support
  // scaled decoding (WebKit included) downsample while decoding instead of
  // ever materializing a full-resolution raster in memory. A 48-108MP iPhone
  // Pro photo decoded at full res first (the previous version of this
  // function) held that whole raster before the shrink even happened —
  // exactly the peak-memory spike issue C is about. Closing the probe before
  // starting the second decode keeps only one bitmap alive at a time.
  const probe = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / probe.width, maxWidth / probe.height);
  let bitmap = probe;
  if (scale < 1) {
    const targetWidth = Math.max(1, Math.round(probe.width * scale));
    const targetHeight = Math.max(1, Math.round(probe.height * scale));
    probe.close();
    bitmap = await createImageBitmap(file, { resizeWidth: targetWidth, resizeHeight: targetHeight, resizeQuality: "high" });
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("ไม่สามารถประมวลผลรูปภาพได้");
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}

function drawToCanvasLegacy(file: File, maxWidth: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("โหลดรูปภาพไม่สำเร็จ"));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("ไม่สามารถประมวลผลรูปภาพได้"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Downscale + re-encode an image client-side, then upload it to
 * /api/uploads (see H4 in the production-readiness audit — this replaced
 * storing the full data URL inline in a store/file). Returns the server path
 * to reference from then on.
 */
export async function uploadCompressedImage(file: File, maxWidth = 1280, quality = 0.75): Promise<{ url: string; size: number }> {
  const canvas = await drawToCanvas(file, maxWidth);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("แปลงรูปภาพไม่สำเร็จ"))), "image/jpeg", quality),
  );
  const form = new FormData();
  form.append("file", blob, "image.jpg");
  const res = await fetch("/api/report-task/uploads", { method: "POST", body: form });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "อัปโหลดรูปภาพไม่สำเร็จ");
  }
  const data = (await res.json()) as { url: string; size: number };
  return { url: data.url, size: data.size };
}

export interface UploadedReportMedia {
  url: string;
  mime: string;
  name: string;
  size: number;
}

/** Sends `file` to the report-task upload endpoint untouched — no canvas
 * round trip. Used for anything that isn't a raster image: re-encoding a pdf
 * or a spreadsheet through a canvas would destroy it, and there's nothing to
 * downscale anyway. */
async function uploadRaw(file: File, failureMessage: string): Promise<UploadedReportMedia> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/report-task/uploads", { method: "POST", body: form });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? failureMessage);
  }
  const data = (await res.json()) as { url: string; mime: string; size: number };
  return { url: data.url, mime: data.mime, name: file.name, size: data.size };
}

/**
 * Upload one post attachment — image, video or document. Images take the
 * existing downscale+re-encode path (uploadCompressedImage); everything else
 * goes up as-is through the same /api/uploads endpoint (that route's
 * ALLOWED_TYPES list + server-side magic-byte check are the real gate, same as
 * every other non-image upload path in the app — see attachment-upload.ts).
 */
export async function uploadReportMedia(file: File): Promise<UploadedReportMedia> {
  // Everything that isn't an image or a video: pdf/word/excel/csv/zip. Sent
  // byte-for-byte, and size-checked against the company's own maxFileMB
  // (the same value the server re-reads from the DB on every upload) so an
  // oversized document fails immediately with a specific message instead of
  // a slow upload ending in a generic 413 — same treatment videos get below.
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
    const maxFileMB = useAttachmentSettingsStore.getState().settings.maxFileMB;
    if (file.size > maxFileMB * 1024 * 1024) {
      const actualMb = (file.size / 1024 / 1024).toFixed(1);
      throw new Error(`ไฟล์ใหญ่เกินไป (ไฟล์นี้ ${actualMb}MB ต้องไม่เกิน ${maxFileMB}MB)`);
    }
    return uploadRaw(file, "อัปโหลดไฟล์ไม่สำเร็จ");
  }
  if (file.type.startsWith("video/")) {
    if (file.type !== "video/mp4" && file.type !== "video/webm") {
      throw new Error("รองรับเฉพาะไฟล์วิดีโอ .mp4 หรือ .webm");
    }
    // Client-side heads-up before the request even fires — the server (see
    // /api/report-task/uploads) is still the real authority and reads this
    // exact same company-set value fresh from the DB on every upload, so
    // there's no risk of the two drifting apart; this just fails fast with a
    // specific message instead of a slow upload ending in a generic 413. A
    // company on a plan with a bigger video allowance (or a smaller one)
    // gets checked against its own real limit here, not a hardcoded number.
    const maxVideoMB = useAttachmentSettingsStore.getState().settings.maxVideoMB;
    const maxBytes = maxVideoMB * 1024 * 1024;
    if (file.size > maxBytes) {
      const actualMb = (file.size / 1024 / 1024).toFixed(1);
      throw new Error(`ไฟล์วิดีโอใหญ่เกินไป (ไฟล์นี้ ${actualMb}MB ต้องไม่เกิน ${maxVideoMB}MB)`);
    }
    return uploadRaw(file, "อัปโหลดวิดีโอไม่สำเร็จ");
  }
  const { url, size } = await uploadCompressedImage(file);
  return { url, mime: "image/jpeg", name: file.name, size };
}
