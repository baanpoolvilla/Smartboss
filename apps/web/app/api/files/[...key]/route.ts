import { NextResponse } from "next/server";
import { getSession } from "@smartboss/auth";
import {
  getSignedFileUrl,
  readStoredFile,
} from "@/modules/maintenance/lib/storage";

export const runtime = "nodejs";

/**
 * เสิร์ฟไฟล์แนบของโมดูล (รูปทรัพย์สิน/งานซ่อม/ใบเสร็จ/ใบ PO)
 * ไฟล์เหล่านี้เป็นข้อมูลของบริษัท — **ต้อง login ก่อนเสมอ**
 * proxy ก็กันชั้นหนึ่งอยู่แล้ว แต่เช็คซ้ำที่นี่กันกรณี matcher เปลี่ยน
 *
 * โหมด object storage: 302 ไป presigned URL (หมดอายุ 5 นาที) ให้ browser
 * โหลดตรงจาก storage — ไม่ proxy bytes ผ่าน function จึงไม่ติดลิมิตขนาด response
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { key } = await params;
  const joined = key.join("/");

  const signedUrl = await getSignedFileUrl(joined);
  if (signedUrl) {
    return NextResponse.redirect(signedUrl, {
      status: 302,
      // private = ห้าม CDN/proxy ร่วมกันแคช (response นี้ผ่าน auth มาแล้ว)
      headers: { "Cache-Control": "private, max-age=60" },
    });
  }

  const result = await readStoredFile(joined);
  if (!result) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(result.data), {
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
