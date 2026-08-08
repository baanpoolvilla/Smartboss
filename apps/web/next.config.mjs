/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
