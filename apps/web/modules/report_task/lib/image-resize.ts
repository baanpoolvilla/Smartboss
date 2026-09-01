import { useAttachmentSettingsStore } from "@/modules/report_task/store/attachment-settings-store";

/** Shared canvas downscale step — draws `file` onto a canvas at most
 * `maxWidth` wide, used by both the upload path and the legacy inline path. */
function drawToCanvas(file: File, maxWidth: number): Promise<HTMLCanvasElement> {
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
export async function uploadCompressedImage(file: File, maxWidth = 1280, quality = 0.75): Promise<string> {
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
  const data = (await res.json()) as { url: string };
  return data.url;
}

export interface UploadedReportMedia {
  url: string;
  mime: string;
  name: string;
}

/**
 * Upload one post attachment, image or video — images take the existing
 * downscale+re-encode path (uploadCompressedImage); a video goes up as-is
 * through the same /api/uploads endpoint (that route's ALLOWED_TYPES list +
 * server-side magic-byte check are the real gate, same as every other
 * non-image upload path in the app — see attachment-upload.ts).
 */
export async function uploadReportMedia(file: File): Promise<UploadedReportMedia> {
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
    const maxBytes = useAttachmentSettingsStore.getState().settings.maxVideoMB * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error(`ไฟล์วิดีโอใหญ่เกินไป (จำกัด ${useAttachmentSettingsStore.getState().settings.maxVideoMB}MB)`);
    }
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/report-task/uploads", { method: "POST", body: form });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? "อัปโหลดวิดีโอไม่สำเร็จ");
    }
    const data = (await res.json()) as { url: string; mime: string };
    return { url: data.url, mime: data.mime, name: file.name };
  }
  const url = await uploadCompressedImage(file);
  return { url, mime: "image/jpeg", name: file.name };
}
