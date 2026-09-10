/** @type {import('next').NextConfig} */
/*
 * X-Frame-Options ไม่อยู่ในนี้แล้ว — ย้ายไปตั้งใน proxy.ts (middleware) แทน
 * เพราะต้อง**ยกเว้น** /m (LINE Mini App ซึ่งต้องถูกฝังอยู่ในเว็บวิวของ LINE ได้)
 * และพิสูจน์แล้วว่า headers() ของไฟล์นี้เป็นชั้นที่ชนะเสมอไม่ว่า middleware
 * จะตั้งค่าอะไรมาก็ตาม (ทดสอบจริงตอนไล่บั๊กนี้) — ถ้าประกาศ DENY แบบ blanket
 * ไว้ที่นี่จะไม่มีทางยกเว้นเส้นทางไหนได้เลยไม่ว่าจะเขียน source pattern ยังไง
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const NATIVE_EXTERNALS = ["argon2", "@prisma/client", ".prisma/client", "ioredis"];

const nextConfig = {
  reactStrictMode: true,
  /*
   * เครื่อง dev รัน Next อยู่ในบ WSL แล้วเปิดเว็บจาก Windows จึงต้อง bind 0.0.0.0
   * Next 16 ถือว่าการเข้าผ่านโฮสต์ที่ไม่ใช่ตัวเองเป็น cross-origin แล้ว **บล็อก
   * /_next/* ทิ้งเงียบ ๆ** ผลคือ client bundle โหลดไม่ครบ React ไม่ hydrate
   * ทั้งแอป — หน้าเว็บยังขึ้น (SSR) แต่กดอะไรไม่ได้เลย และไม่มี error ให้เห็น
   *
   * มีผลเฉพาะ dev — production ไม่ใช้ค่านี้
   */
  allowedDevOrigins: ["127.0.0.1", "localhost", "172.18.6.210"],
  transpilePackages: ["@smartboss/ui", "@smartboss/auth", "@smartboss/database"],
  /*
   * argon2 / prisma / ioredis เป็น native module — bundle ไม่ได้ ต้องให้ Node require เอง
   *
   * เดิมมี webpack() ทำงานซ้ำบรรทัดนี้อีกรอบ ตัดออกตอนขึ้น Next 16 เพราะ
   * Turbopack เป็นค่าเริ่มต้นแล้วและ build จะ error ทันทีถ้ามี webpack config ค้างอยู่
   */
  serverExternalPackages: NATIVE_EXTERNALS,
  /*
   * ค่าเริ่มต้นของ Next คือ 1MB — ต่ำกว่ารูปถ่ายมือถือทั่วไปแทบทุกใบ
   * (รูปโปรไฟล์จำกัดไว้ 5MB ที่ apps/web/app/(shell)/account/actions.ts)
   * ไม่ตั้งตรงนี้ให้ตามกัน ทุก Server Action ที่รับไฟล์ใหญ่กว่า 1MB จะโดน Next
   * ปัดตกเองก่อนถึงโค้ดเรา ด้วย 500 ที่ไม่มีข้อความ (เจอจริงตอน deploy ฟีเจอร์
   * รูปโปรไฟล์ — log ฝั่งเซิร์ฟเวอร์เท่านั้นที่บอกว่า "Body exceeded 1 MB limit")
   *
   * ตั้งสูงกว่าเพดานไฟล์แอปเผื่อ overhead ของ multipart encoding
   */
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  /*
   * report-feed ย้ายไปอยู่ใต้ /report-task/report-feed แล้ว แต่แจ้งเตือนเก่าที่
   * ถูกสร้างไว้ก่อนหน้านั้น (รวมถึงลิงก์ที่ผู้ใช้บุ๊กมาร์ก/แชร์กันไว้) ยังเก็บ
   * พาธเดิม /report-feed?... ไว้ในตัว กดแล้วเลย 404 — redirect นี้พาไปหน้าถูกให้
   * อัตโนมัติ (Next จะส่ง query string เดิม เช่น ?topic=&post= ต่อไปให้เอง)
   */
  async redirects() {
    return [
      { source: "/report-feed", destination: "/report-task/report-feed", permanent: false },
    ];
  },
};

export default nextConfig;
