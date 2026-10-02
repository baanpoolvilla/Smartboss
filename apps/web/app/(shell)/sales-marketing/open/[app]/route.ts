import { NextResponse, type NextRequest } from "next/server";
import { SALES_MARKETING_APPS } from "@/lib/external-apps";
import { ssoTarget } from "@/lib/external-apps-sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * เปิดแอปภายนอก "ในแท็บใหม่" แบบล็อกอินให้เลย — ปุ่มสำรองบนหน้า /sales-marketing/app/<key>
 * (ปกติเปิดในกรอบข้างใน SmartBoss แทน — หน้านั้นสร้างลิงก์เองด้วย ssoTarget ไม่ผ่าน route นี้
 * เพราะทุกหน้าของ SmartBoss ห้ามฝังในกรอบ (X-Frame-Options: DENY ใน proxy.ts))
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ app: string }> }) {
  const { app: key } = await params;
  const app = SALES_MARKETING_APPS.find((a) => a.sso?.key === key);
  if (!app?.sso) return NextResponse.redirect(new URL("/sales-marketing", req.url));

  const target = await ssoTarget(app, { embed: false });
  if (target.kind === "login") {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/sales-marketing")}`, req.url));
  }
  const res = NextResponse.redirect(target.url);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
