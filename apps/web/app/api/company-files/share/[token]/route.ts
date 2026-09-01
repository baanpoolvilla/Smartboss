import { NextResponse } from "next/server";
import { getSession } from "@smartboss/auth";
import { getSignedFileUrl, readStoredFile } from "@/lib/storage";
import { resolveShareAccess } from "@/modules/company-files/data/files";

export const runtime = "nodejs";

/**
 * เสิร์ฟไฟล์ให้คนถือ "ลิงก์แชร์" — ไม่ต้อง login เลย (อาจเป็นคนนอกบริษัท) ต่าง
 * จาก /api/files/[...key] ที่บังคับ session เสมอ ความปลอดภัยของเส้นทางนี้อยู่ที่
 * ตัว token เอง (สุ่ม 24 ไบต์, เพิกถอน/หมดอายุได้ — ดู resolveShareLink) ไม่ใช่คุกกี้
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const password = new URL(req.url).searchParams.get("pw");
  const session = await getSession();
  const access = await resolveShareAccess(token, { viewerOrgId: session?.orgId ?? null, password });
  if (!access.ok) {
    if (access.reason === "invalid") return new NextResponse("ลิงก์นี้ใช้ไม่ได้แล้ว", { status: 404 });
    if (access.reason === "scope") return new NextResponse("ลิงก์นี้เปิดเฉพาะคนในบริษัท", { status: 403 });
    return new NextResponse("ต้องใส่รหัสผ่านที่ถูกต้อง", { status: 401 });
  }
  const link = access.link;

  const key = link.file.storageKey.replace(/^\/api\/files\//, "");

  const signedUrl = await getSignedFileUrl(key);
  if (signedUrl) {
    return NextResponse.redirect(signedUrl, { status: 302, headers: { "Cache-Control": "private, max-age=60" } });
  }

  const result = await readStoredFile(key);
  if (!result) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(result.data), {
    headers: { "Content-Type": result.contentType, "Cache-Control": "private, max-age=60" },
  });
}
