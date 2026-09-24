"use client";

/**
 * ย่อรูปในเครื่องก่อนอัปโหลด — รูปจากมือถือ 3–5MB เหลือราว 200–400KB (ด้านยาว 1920px)
 * และทำรูปย่อ ~480px ไว้แสดงในห้อง ห้องที่มีรูปเยอะจะเปิดเร็ว ไม่หน่วง และประหยัดพื้นที่
 * ของบริษัทราว 10 เท่า ส่วนการกด "ดูรูปเต็ม" ค่อยโหลดรูปใหญ่
 *
 * GIF ไม่ย่อ (จะเสียภาพเคลื่อนไหว) ย่อไม่ได้ด้วยเหตุใดก็ตาม → ส่งไฟล์เดิมแทน ไม่ให้ส่งพัง
 */

const FULL_EDGE = 1920;
const THUMB_EDGE = 480;
const QUALITY = 0.82;

export interface CompressedImage {
  full: File;
  thumb: File | null;
  width: number;
  height: number;
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Safari รุ่นเก่ารับ option นี้ไม่ได้ — ลองแบบ <img> ต่อ
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sizeOf(src: ImageBitmap | HTMLImageElement) {
  return "naturalWidth" in src ? { w: src.naturalWidth, h: src.naturalHeight } : { w: src.width, h: src.height };
}

async function encode(src: ImageBitmap | HTMLImageElement, maxEdge: number, baseName: string): Promise<File | null> {
  const { w, h } = sizeOf(src);
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const chh = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = chh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, cw, chh);

  const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY));
  // webp เล็กกว่า — เบราว์เซอร์ที่เข้ารหัส webp ไม่ได้จะคืน png มาแทน ให้ถอยไป jpeg
  let blob = await toBlob("image/webp");
  if (!blob || blob.type !== "image/webp") blob = await toBlob("image/jpeg");
  if (!blob) return null;
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  return new File([blob], `${baseName}.${ext}`, { type: blob.type });
}

export async function compressImage(file: File): Promise<CompressedImage> {
  const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
  try {
    const src = await loadBitmap(file);
    const { w, h } = sizeOf(src);
    if (file.type === "image/gif") {
      const thumb = await encode(src, THUMB_EDGE, `${baseName}-thumb`);
      return { full: file, thumb, width: w, height: h };
    }
    const [full, thumb] = await Promise.all([encode(src, FULL_EDGE, baseName), encode(src, THUMB_EDGE, `${baseName}-thumb`)]);
    if ("close" in src) src.close();
    // รูปเล็กอยู่แล้วจนย่อแล้วใหญ่กว่าเดิม → ใช้ไฟล์เดิม
    const useFull = full && full.size < file.size ? full : file;
    const scale = Math.min(1, FULL_EDGE / Math.max(w, h));
    return {
      full: useFull,
      thumb: thumb && thumb.size < useFull.size ? thumb : null,
      width: useFull === file ? w : Math.round(w * scale),
      height: useFull === file ? h : Math.round(h * scale),
    };
  } catch {
    return { full: file, thumb: null, width: 0, height: 0 };
  }
}
