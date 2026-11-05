/**
 * รูปหน้าแรกของเอกสาร — กติกากลางของทั้งระบบ (ห้องรายงาน ความคิดเห็น งาน แชท แจ้งปัญหา)
 *
 * รูปอยู่ที่ key ตายตัว `<ไฟล์>.thumb.png` เสมอ จึงหาเจอจาก URL ของไฟล์ได้เลย
 * ไม่ต้องเก็บฟิลด์เพิ่มในข้อมูลของแต่ละโมดูล และโพสต์/คอมเมนต์/ข้อความเก่าก็ใช้ได้ทันที
 *
 * ไฟล์นี้ไม่แตะเซิร์ฟเวอร์ — ฝั่งหน้าเว็บใช้ได้
 */
const DOC_FILE_URL = /^\/api\/files\/[^?#]+\/(?:report-task|chat)\/[^/?#]+\.(?:pdf|docx?|xlsx?|pptx?)$/i;
const DOC_FILE_KEY = /\.(?:pdf|docx?|xlsx?|pptx?)$/i;

/** key ของรูปหน้าแรกของไฟล์นี้ */
export function docThumbKey(fileKey: string): string {
  return `${fileKey}.thumb.png`;
}

/** key นี้เป็นเอกสารที่อาจมีรูปหน้าแรกไหม */
export function isDocFileKey(fileKey: string): boolean {
  return DOC_FILE_KEY.test(fileKey);
}

/**
 * URL รูปหน้าแรกที่จะโชว์ — ไม่มีทางมีรูป = undefined (แสดงการ์ดไอคอน)
 * โหลดรูปไม่ขึ้น (route ตอบ 404/503) ผู้เรียกต้องกลับไปการ์ดไอคอนเองที่ onError
 */
export function docThumbSrc(media: { url?: string; thumbUrl?: string }): string | undefined {
  if (media.thumbUrl) return media.thumbUrl;
  if (media.url && DOC_FILE_URL.test(media.url)) {
    return `/api/report-task/doc-thumbnail?file=${encodeURIComponent(media.url)}`;
  }
  return undefined;
}

/** ลิงก์เปิดไฟล์ที่บอกชื่อจริง — เปิด/บันทึกจากตัวดู PDF จะได้ชื่อเดิม ไม่ใช่ชื่อสุ่มของที่เก็บ */
export function fileUrlWithName(url: string, name: string): string {
  if (!url.startsWith("/api/files/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}name=${encodeURIComponent(name)}`;
}
