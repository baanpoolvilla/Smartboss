import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

const plexThai = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-thai",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Smartboss",
  description: "Smartboss — ระบบบริหารจัดการภายในองค์กร",
  // เว็บแอป: เพิ่มลงหน้าจอหลักบน iPhone แล้วเปิดเต็มจอ (ดู app/manifest.ts)
  appleWebApp: { capable: true, title: "SmartBoss", statusBarStyle: "default" },
  icons: { icon: [{ url: "/favicon-64.png", sizes: "64x64", type: "image/png" }, { url: "/icon.png", sizes: "192x192", type: "image/png" }], apple: "/apple-touch-icon.png" },
};

// ไม่ใส่ viewport-fit=cover — เมนูล่างของ Shell ยังไม่ได้เว้นขอบ home indicator ของ iPhone
// interactiveWidget: Android Chrome ย่อหน้าเว็บตามคีย์บอร์ด — ไม่งั้นช่องพิมพ์ที่อยู่ล่างจอ (แชท/ฟอร์ม) โดนคีย์บอร์ดบัง
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th" className={plexThai.variable}>
      <body>{children}</body>
    </html>
  );
}
