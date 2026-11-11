/**
 * แปลง User-Agent เป็นชื่ออุปกรณ์ที่คนอ่านออก เช่น "Chrome บน Windows" — ใช้ในหน้า
 * "อุปกรณ์ที่เข้าสู่ระบบอยู่" และใช้เทียบว่าเป็นอุปกรณ์ที่เคยใช้หรือยัง
 * (เทียบด้วยชื่อนี้ ไม่ใช่ UA เต็ม เพราะ UA เปลี่ยนทุกครั้งที่เบราว์เซอร์อัปเดตเวอร์ชัน)
 */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (!ua || ua === "unknown") return "อุปกรณ์ไม่ทราบชนิด";

  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : "";

  const app = /\bLine\//i.test(ua)
    ? "แอป LINE"
    : /Edg(e|A|iOS)?\//.test(ua)
      ? "Edge"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /SamsungBrowser/.test(ua)
          ? "Samsung Internet"
          : /Firefox|FxiOS/.test(ua)
            ? "Firefox"
            : /Chrome|CriOS/.test(ua)
              ? "Chrome"
              : /Safari/.test(ua)
                ? "Safari"
                : "";

  if (app && os) return `${app} บน ${os}`;
  return app || os || "อุปกรณ์ไม่ทราบชนิด";
}

export function isMobileDevice(userAgent: string | null | undefined): boolean {
  return /iPhone|iPad|Android|Mobile/.test(userAgent ?? "");
}
