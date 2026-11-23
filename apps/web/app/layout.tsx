import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { parseThemePref, SYSTEM_THEME_SCRIPT, THEME_COLOR, THEME_COOKIE } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smartboss",
  description: "Smartboss — ระบบบริหารจัดการภายในองค์กร",
  // เว็บแอป: เพิ่มลงหน้าจอหลักบน iPhone แล้วเปิดเต็มจอ — manifest เป็น route แยกตามเครื่อง (app/manifest.webmanifest/route.ts)
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "SmartBoss", statusBarStyle: "default" },
  icons: { icon: [{ url: "/favicon-64-v6.png", sizes: "64x64", type: "image/png" }, { url: "/icon-v6.png", sizes: "192x192", type: "image/png" }], apple: "/apple-touch-icon-v6.png" },
};

// ไม่ใส่ viewport-fit=cover — เมนูล่างของ Shell ยังไม่ได้เว้นขอบ home indicator ของ iPhone
// interactiveWidget: Android Chrome ย่อหน้าเว็บตามคีย์บอร์ด — ไม่งั้นช่องพิมพ์ที่อยู่ล่างจอ (แชท/ฟอร์ม) โดนคีย์บอร์ดบัง
export async function generateViewport(): Promise<Viewport> {
  const pref = parseThemePref((await cookies()).get(THEME_COOKIE)?.value);
  return {
    width: "device-width",
    initialScale: 1,
    themeColor: pref === "dark" ? THEME_COLOR.dark : THEME_COLOR.light,
    interactiveWidget: "resizes-content",
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // ธีมหน้าจอ (lib/theme.ts) — ตั้งตั้งแต่ HTML แรก ไม่กระพริบ · ไม่เคยเลือก = สว่างแบบเดิม
  const pref = parseThemePref((await cookies()).get(THEME_COOKIE)?.value);
  const dark = pref === "dark";
  return (
    <html lang="th" data-theme-pref={pref} data-theme={dark ? "dark" : "light"} className={dark ? "dark" : undefined} suppressHydrationWarning>
      {pref === "system" && (
        <head>
          <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }} />
        </head>
      )}
      {/* spellcheck สืบทอดลงทุกช่องพิมพ์ — ปิดที่ body ที่เดียว ไม่มีเส้นแดงใต้คำไทย/ชื่อคนอีก */}
      <body spellCheck={false}>{children}</body>
    </html>
  );
}
