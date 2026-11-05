/**
 * กติกากลางว่าไฟล์ชนิดไหนรับได้ — ใช้ทั้งหน้าเว็บและ upload route (ไฟล์นี้ไม่แตะเซิร์ฟเวอร์)
 */

/**
 * รูปถ่ายที่เบราว์เซอร์เปิดและย่อได้จริงไหม — เบราว์เซอร์บางเครื่องรายงานไฟล์ CAD/ออกแบบเป็น
 * `image/vnd.dwg` `image/vnd.dxf` `image/vnd.adobe.photoshop` ถ้าเชื่อแค่ "image/" จะเอาไปย่อ
 * ด้วย canvas แล้วล้มเหลว ไฟล์พวกนี้ต้องส่งไปทั้งก้อนแบบไฟล์ทั่วไป
 */
export function isPhotoFile(type: string): boolean {
  return type.startsWith("image/") && !type.startsWith("image/vnd.");
}

/** โปรแกรมและสคริปต์ที่เปิดแล้วรันบนเครื่องคนรับได้ — ไม่รับทุกที่ทั้งระบบ */
const PROGRAM_EXTS = new Set([
  "exe", "msi", "bat", "cmd", "com", "scr", "pif", "cpl", "dll", "sys",
  "ps1", "psm1", "vbs", "vbe", "js", "jse", "mjs", "wsf", "wsh", "hta", "lnk", "reg", "jar", "apk", "sh",
]);

/** หน้าเว็บที่รันสคริปต์ได้เมื่อเปิด — แชท/คลังไฟล์ไม่รับ ห้องรายงาน/งานรับ .html โดยตั้งใจให้เปิดดูได้ */
const WEB_PAGE_EXTS = new Set(["html", "htm", "xhtml", "shtml", "svg", "php"]);

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  const raw = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  return raw.replace(/[^a-z0-9]/g, "").slice(0, 12);
}

const blockedMessage = (ext: string) => `ส่งไฟล์ .${ext} ไม่ได้เพื่อความปลอดภัย — ถ้าจำเป็นต้องส่งจริง ให้บีบอัดเป็น .zip ก่อน`;

/** ไฟล์นี้เป็นโปรแกรม/สคริปต์ที่ไม่รับไหม — คืนข้อความบอกผู้ใช้ · รับได้ = null */
export function programFileError(name: string): string | null {
  const ext = extOf(name);
  return PROGRAM_EXTS.has(ext) ? blockedMessage(ext) : null;
}

/** นามสกุลที่ตรวจเนื้อไฟล์ได้จริง — มาถึงทางไฟล์ทั่วไปแปลว่าเนื้อไฟล์ไม่ตรงกับนามสกุล
 * (เช่น เปลี่ยนชื่อ .exe เป็น .pdf) ถ้าเก็บตามนามสกุลจะเสิร์ฟกลับเป็นชนิดที่ไม่จริง */
const SNIFFABLE_EXTS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "mp4", "webm",
]);

/**
 * นามสกุลสำหรับเก็บไฟล์ชนิดอื่น ๆ (CAD, Photoshop, rar ฯลฯ) — เสิร์ฟกลับเป็น
 * application/octet-stream เท่านั้น จึงดาวน์โหลดอย่างเดียว ไม่เปิดในเบราว์เซอร์
 * ชื่อจริงอยู่กับข้อมูลของแต่ละโมดูล นามสกุลนี้เป็นแค่ส่วนท้าย key ในที่เก็บ
 */
export function genericUploadExt(name: string): { ext: string } | { error: string } {
  const ext = extOf(name);
  if (PROGRAM_EXTS.has(ext) || WEB_PAGE_EXTS.has(ext)) return { error: blockedMessage(ext) };
  if (SNIFFABLE_EXTS.has(ext)) return { error: `เนื้อไฟล์ไม่ตรงกับนามสกุล .${ext} — ไฟล์อาจเสียหรือถูกเปลี่ยนชื่อมา` };
  return { ext: ext || "bin" };
}
