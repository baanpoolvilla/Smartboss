import { NextResponse, type NextRequest } from "next/server";
import { verifyAccessToken } from "@smartboss/auth/jwt";

/*
 * เดิมชื่อ middleware.ts — Next 16 เปลี่ยนชื่อ convention เป็น proxy
 * พฤติกรรมเหมือนเดิมทุกอย่าง เปลี่ยนแค่ชื่อไฟล์กับชื่อฟังก์ชันที่ export
 */

const COOKIE_ACCESS = "sb_access";

/** path ที่เข้าถึงได้โดยไม่ต้อง login */
const PUBLIC_PATHS = ["/login"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return true;
  }
  // /api/* เปิดได้เฉพาะที่ระบุไว้ — ต้องตัดสินก่อนกฎนามสกุลไฟล์ด้านล่าง
  // ไม่งั้น /api/files/<key>.jpg จะถูกนับเป็น static แล้วหลุด auth ทั้งหมด
  if (pathname.startsWith("/api/")) {
    return (
      pathname.startsWith("/api/auth/") ||
      pathname.startsWith("/api/cron/") ||
      pathname.startsWith("/api/webhooks/")
    );
  }

  // public upload link + Next internals + static
  return (
    pathname.startsWith("/u/") || // public external upload link
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/assets/") ||
    /\.[a-zA-Z0-9]+$/.test(pathname)
  );
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_ACCESS)?.value;
  const claims = token ? await verifyAccessToken(token) : null;

  if (!claims) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname + search);
    const res = NextResponse.redirect(loginUrl);
    // ล้าง access cookie ที่หมดอายุทิ้ง
    if (token) res.cookies.delete(COOKIE_ACCESS);
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
