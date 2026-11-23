/**
 * ธีมหน้าจอ: สว่าง / มืด / ตามเครื่อง (ผู้ใช้ 23/11/2569 — แบบเดียวกับ GitHub / Slack / Google)
 * เก็บในคุกกี้ให้เซิร์ฟเวอร์ตั้ง <html data-theme> ได้ตั้งแต่ HTML แรก (ไม่กระพริบขาวก่อนเปลี่ยน)
 * ค่าเริ่มต้น = สว่าง (หน้าตาเดิมของทุกคน) · "ตามเครื่อง" ให้สคริปต์เล็ก ๆ ใน <head> อ่าน prefers-color-scheme
 */
export type ThemePref = "light" | "dark" | "system";
export const THEME_COOKIE = "sb-theme";
export const THEME_PREFS: { id: ThemePref; label: string }[] = [
  { id: "light", label: "สว่าง" },
  { id: "dark", label: "มืด" },
  { id: "system", label: "ตามเครื่อง" },
];

export function parseThemePref(v: string | undefined | null): ThemePref {
  return v === "dark" || v === "system" ? v : "light";
}

/** สีแถบสถานะของมือถือ/PWA ให้ตรงกับพื้นหน้า */
export const THEME_COLOR = { light: "#ffffff", dark: "#0d1117" } as const;

/**
 * สคริปต์ใน <head> สำหรับ "ตามเครื่อง" — ตั้ง data-theme ก่อนวาดหน้า และเปลี่ยนตามเครื่องทันทีถ้าผู้ใช้สลับโหมดของระบบ
 * (สว่าง/มืด ที่เลือกเองเซิร์ฟเวอร์ตั้งให้แล้ว ไม่ต้องใช้สคริปต์)
 */
export const SYSTEM_THEME_SCRIPT = `(function(){try{var d=document.documentElement;if(d.getAttribute("data-theme-pref")!=="system")return;var m=window.matchMedia("(prefers-color-scheme: dark)");var a=function(){var k=m.matches;d.setAttribute("data-theme",k?"dark":"light");d.classList.toggle("dark",k);var t=document.querySelector('meta[name="theme-color"]');if(t)t.setAttribute("content",k?"${THEME_COLOR.dark}":"${THEME_COLOR.light}")};a();m.addEventListener("change",a)}catch(e){}})();`;
