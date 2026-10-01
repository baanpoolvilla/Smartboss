import { NextResponse, type NextRequest } from "next/server";
import { getSession, loadAuthUser, signSsoToken } from "@smartboss/auth";
import { SALES_MARKETING_APPS } from "@/lib/external-apps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ตรงกับ OWNER_ROLE_CODES ของ report-task — คนที่ "เห็นทั้งบริษัท" */
const ADMIN_ROLE_CODES = new Set(["SUPER_ADMIN", "ADMIN", "CEO"]);

/**
 * กดการ์ดในหน้า ขาย & การตลาด → เซ็น token อายุ 60 วินาทีของผู้ใช้ที่ล็อกอินอยู่
 * แล้วพาไปแอปปลายทาง ซึ่งผูกกับบัญชีของคนนั้นในแอปเอง (ดู lib/external-apps.ts)
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ app: string }> }) {
  const { app: key } = await params;
  const app = SALES_MARKETING_APPS.find((a) => a.sso?.key === key);
  if (!app?.sso) return NextResponse.redirect(new URL("/sales-marketing", req.url));

  const session = await getSession();
  const user = session ? await loadAuthUser(session.userId) : null;
  if (!user) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/sales-marketing")}`, req.url));
  }

  const secret = process.env[app.sso.secretEnv];
  // ยังไม่ได้ตั้งค่า SSO ของแอปนี้ — เปิดหน้าล็อกอินของแอปเหมือนเดิม
  if (!secret) return NextResponse.redirect(app.url);

  const token = await signSsoToken(secret, app.sso.key, {
    userId: user.id,
    name: user.name,
    email: user.email,
    isAdmin: user.roles.some((r) => ADMIN_ROLE_CODES.has(r)),
  });
  const res = NextResponse.redirect(app.sso.entry.replace("{token}", encodeURIComponent(token)));
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
