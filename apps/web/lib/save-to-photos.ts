import type { MouseEvent } from "react";
import { toast } from "sonner";

/**
 * iPhone/iPad: Safari ส่งไฟล์ที่ "ดาวน์โหลด" ไปแอป Files เสมอ (หน้าจอ "เปิดใน แสดงตัวอย่าง")
 * เว็บเขียนลงแอปรูปภาพตรง ๆ ไม่ได้ — ทางเดียวคือแผ่นแชร์ ซึ่งมีปุ่ม "บันทึกภาพ/บันทึกวิดีโอ" ลงแกลเลอรี
 * ⇒ ใช้เป็น onClick ของลิงก์ดาวน์โหลด: รูป/วิดีโอบน iOS เปิดแผ่นแชร์แทน, อย่างอื่นปล่อยลิงก์ทำงานตามปกติ
 * (Android ดาวน์โหลดลงโฟลเดอร์ Download ซึ่งแกลเลอรีเห็นอยู่แล้ว ไม่ต้องแตะ)
 */
export function saveToPhotosOnClick(media: { url?: string | null; name: string; mime?: string | null }) {
  return (e: MouseEvent<HTMLElement>) => {
    const mime = media.mime ?? "";
    if (!media.url || !isIos() || !/^(image|video)\//.test(mime)) return;
    const probe = new File([], media.name, { type: mime });
    if (!navigator.canShare?.({ files: [probe] })) return;
    e.preventDefault();
    void shareMedia(media.url, media.name, mime);
  };
}

async function shareMedia(url: string, name: string, mime: string) {
  let file: File;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    file = new File([blob], name, { type: blob.type || mime });
  } catch {
    toast.error("โหลดไฟล์ไม่สำเร็จ");
    return;
  }
  try {
    await navigator.share({ files: [file] });
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      // Safari หมดสิทธิ์ "ผู้ใช้เพิ่งแตะ" ระหว่างรอโหลดไฟล์ใหญ่ — ให้แตะอีกครั้ง ไฟล์โหลดไว้แล้ว
      toast("ไฟล์พร้อมแล้ว", {
        action: { label: "บันทึกลงรูปภาพ", onClick: () => void navigator.share({ files: [file] }).catch(() => {}) },
      });
    }
    // AbortError = ผู้ใช้ปิดแผ่นแชร์เอง ไม่ต้องแจ้งอะไร
  }
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
