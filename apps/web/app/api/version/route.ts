/**
 * รหัส build ที่เซิร์ฟเวอร์รันอยู่ตอนนี้ — หน้าเว็บเอาไปเทียบกับรหัสที่ฝังมากับโค้ดของ
 * ตัวเอง ถ้าไม่ตรงแปลว่ามี deploy ใหม่ (ดู components/shell/app-update-notice.tsx)
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
