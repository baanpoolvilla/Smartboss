import "server-only";

import { docThumbKey } from "@/lib/doc-thumb";
import { putStoredFileAtKey } from "@/lib/storage";

import { generateDocThumbnail, supportsDocThumbnail } from "./generate-doc-thumbnail";

/**
 * สร้างรูปหน้าแรกตอนอัปโหลดแล้วเก็บที่ key ตายตัว (ดู lib/doc-thumb.ts)
 * best effort ล้วน ๆ — พังยังไงก็คืน null ห้ามทำให้การอัปโหลดไฟล์จริงล้มตาม
 */
export async function storeDocThumbnail(fileUrl: string, bytes: Uint8Array, ext: string): Promise<string | null> {
  if (!supportsDocThumbnail(ext)) return null;
  const png = await generateDocThumbnail(bytes, ext);
  if (!png) return null;
  const key = docThumbKey(fileUrl.replace(/^\/api\/files\//, ""));
  try {
    await putStoredFileAtKey(key, png);
    return `/api/files/${key}`;
  } catch (err) {
    console.error("[doc-thumbnail] เก็บรูปไม่สำเร็จ", err);
    return null;
  }
}
