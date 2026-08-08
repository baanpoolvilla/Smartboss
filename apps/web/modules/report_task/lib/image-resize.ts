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
 * /api/report-task/uploads (see H4 in the production-readiness audit — this replaced
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
