import { NextResponse, type NextRequest } from "next/server";
import { verifyAccessToken } from "@smartboss/auth/jwt";

/*
 * เดิมชื่อ middleware.ts — Next 16 เปลี่ยนชื่อ convention เป็น proxy
 * พฤติกรรมเหมือนเดิมทุกอย่าง เปลี่ยนแค่ชื่อไฟล์กับชื่อฟังก์ชันที่ export
 */

const COOKIE_ACCESS = "sb_access";

/**
 * path ที่เข้าถึงได้โดยไม่ต้อง login
 *
 * `/m` = LINE Mini App ซึ่ง **ต้องเปิดได้โดยยังไม่มี cookie** เพราะมันล็อกอินให้
 * ตัวเองผ่าน LIFF (ยืนยัน ID token กับ LINE → POST /api/auth/line → ได้ cookie)
 * ถ้าปล่อยให้ถูกเด้งไป /login ก่อน โค้ด LIFF จะไม่มีวันได้ทำงานเลย และพนักงาน
 * จะเจอหน้าล็อกอินของเว็บผู้บริหารแทนที่จะเป็นแอป
 *
 * ปลอดภัย เพราะตัวหน้าไม่ได้แสดงข้อมูลอะไรเอง — ข้อมูลทั้งหมดมาจาก `/api/m/*`
 * ซึ่งยังอยู่ใต้ `/api/` ที่ยังต้องมี session ตามเดิม
 */
const PUBLIC_PATHS = ["/login", "/m"];

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

/**
 * กัน clickjacking ทุกหน้า **ยกเว้น** `/m` — Mini App ต้องถูกฝังอยู่ในเว็บวิว
 * ของแอป LINE ได้ ถ้าส่ง DENY ไปด้วยจะโหลดไม่ขึ้นเลย ("This page couldn't
 * load" แบบไม่มี error ให้เห็น เพราะ webview เป็นฝ่ายปฏิเสธ render เอง)
 *
 * ⚠ ต้องตั้งที่นี่ ไม่ใช่ next.config.mjs — header ที่ตั้งใน next.config.mjs
 * เป็นชั้นที่ชนะเสมอไม่ว่า middleware จะพยายามตั้ง/ลบยังไงก็ตาม (ทดสอบจริง
 * แล้วตอนไล่บั๊กนี้) ⇒ ถ้าประกาศ DENY แบบ blanket ไว้ที่นั่น จะยกเว้นเส้นทาง
 * ไหนไม่ได้เลยไม่ว่าจะเขียน source pattern ยังไง
 */
function withFrameProtection(res: NextResponse, pathname: string): NextResponse {
  if (pathname !== "/m" && !pathname.startsWith("/m/")) {
    res.headers.set("X-Frame-Options", "DENY");
  }
  return res;
}

/**
 * redirect ไปโดเมนที่ผู้ใช้เปิดอยู่จริง (Host / X-Forwarded-Host ที่ Caddy ส่งต่อมา)
 * ห้ามใช้ new URL(path, req.url) ตรง ๆ: บนเซิร์ฟเวอร์ Next รันหลัง Caddy ที่ 127.0.0.1:3000
 * req.url จึงอาจเป็น https://localhost:3000/... ผู้ใช้โดนพาไป localhost แล้วเข้าไม่ได้
 * (เกิดตอน access token หมดอายุแล้วเปิดแอป/กดแจ้งเตือน — login ใหม่แล้วหาย)
 * ใช้ path ล้วนเป็น Location ไม่ได้ — proxy ของ Next โยน "Invalid URL"
 */
function redirectTo(req: NextRequest, url: URL): NextResponse {
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  const host = first(req.headers.get("x-forwarded-host")) ?? first(req.headers.get("host"));
  const proto = first(req.headers.get("x-forwarded-proto")) ?? req.nextUrl.protocol.replace(":", "");
  const origin = host ? `${proto}://${host}` : req.nextUrl.origin;
  return NextResponse.redirect(new URL(url.pathname + url.search, origin));
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isPublic(pathname)) {
    return withFrameProtection(NextResponse.next(), pathname);
  }

  const token = req.cookies.get(COOKIE_ACCESS)?.value;
  const claims = token ? await verifyAccessToken(token) : null;

  if (!claims) {
    /*
     * เปิดหน้าเว็บ (ไม่ใช่ /api) ด้วย access token ที่หมดอายุ — ลองต่ออายุด้วย refresh
     * token ก่อน (อายุยาวกว่ามาก) แทนที่จะเด้งไปหน้า login ทันที เดิมเปิดแอปใหม่หลังปิดไป
     * เกิน 15 นาทีต้อง login ใหม่ทุกครั้ง ทั้งที่ session จริงยังไม่หมด เพราะตัวต่ออายุฝั่ง
     * หน้าเว็บ (SessionRefresher) ยังไม่ทันได้ทำงาน /api/auth/refresh ต่ออายุไม่ได้ค่อยพาไป
     * หน้า login เอง · คำขอ /api ปล่อยให้ตัวต่ออายุฝั่งหน้าเว็บจัดการเหมือนเดิม
     */
    if (!pathname.startsWith("/api/")) {
      const refreshUrl = new URL("/api/auth/refresh", req.url);
      refreshUrl.searchParams.set("next", pathname + search);
      return withFrameProtection(redirectTo(req, refreshUrl), pathname);
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname + search);
    const res = redirectTo(req, loginUrl);
    // ล้าง access cookie ที่หมดอายุทิ้ง
    if (token) res.cookies.delete(COOKIE_ACCESS);
    return withFrameProtection(res, pathname);
  }

  return withFrameProtection(NextResponse.next(), pathname);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
