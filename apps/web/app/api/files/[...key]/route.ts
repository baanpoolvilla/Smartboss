import { NextResponse } from "next/server";
import { getSession } from "@smartboss/auth";
import { canServeCompanyFileKey } from "@/modules/company-files/lib/serve-access";
import {
  getSignedFileUrl,
  readStoredFile,
} from "@/modules/maintenance/lib/storage";

export const runtime = "nodejs";

/**
 * เสิร์ฟไฟล์แนบของทุกโมดูล (รายงาน/แชท/ไฟล์บริษัท/งานซ่อม ฯลฯ)
 * ไฟล์เหล่านี้เป็นข้อมูลของบริษัท — **ต้อง login + ต้องเป็นไฟล์ของบริษัทตัวเองเท่านั้น**
 *
 * ⚠ Multi-tenant: storageKey ทุกไฟล์ (ยกเว้น maintenance รุ่นเก่า ดูด้านล่าง)
 * ขึ้นต้นด้วย `<orgId>/...` (ดู putFile ใน lib/storage + ทุก upload route) จึงกันการ
 * ข้ามบริษัทได้ด้วยการบังคับว่า segment แรกของ key ต้องตรงกับ orgId ของ session
 * แค่ login อย่างเดียวไม่พอ ไม่งั้นผู้ใช้บริษัทอื่นที่ได้ URL ไฟล์ (หลุด/แชร์ผิด) จะ
 * โหลดไฟล์ของบริษัทเราได้ และคนในบริษัทเดียวกันที่ไม่ได้อยู่ในห้องก็ยังเปิดไฟล์ห้อง
 * นั้นด้วย URL ตรง ๆ ไม่ได้ (คลังไฟล์กลางจะไม่รั่วผ่านทางนี้)
 *
 * ลิงก์แชร์สาธารณะไม่ได้ผ่าน route นี้ — ใช้ /api/company-files/share/[token] ที่มี
 * การตรวจสิทธิ์/รหัสผ่านของตัวเอง จึงไม่กระทบ
 *
 * โหมด object storage: 302 ไป presigned URL (หมดอายุสั้น) ให้ browser โหลดตรง
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { key } = await params;
  const joined = key.join("/");

  // กัน path traversal และ key ว่าง
  if (!joined || joined.includes("..")) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const firstSegment = joined.split("/")[0];
  const ownedByOrg = !!session.orgId && firstSegment === session.orgId;

  /*
   * Grandfather ชั่วคราว: ไฟล์ maintenance ที่อัปโหลด "ก่อน" เพิ่ม orgId prefix จะมี
   * key ขึ้นต้นด้วย "maintenance/..." (ไม่มี orgId) — ปล่อยผ่านไว้ให้ของเดิมไม่พัง
   * ⚠ นี่ยังเป็นช่องที่ผู้ใช้บริษัทอื่นเปิดไฟล์ maintenance เก่าด้วย URL ได้อยู่
   * ให้ทำ migration ย้าย key เก่าไปเป็น `<orgId>/maintenance/...` แล้ว **ลบเงื่อนไขนี้ทิ้ง**
   */
  const legacyMaintenance = joined.startsWith("maintenance/");

  if (!ownedByOrg && !legacyMaintenance) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  /*
   * ชั้นที่สอง — สิทธิ์ระดับห้อง: ไฟล์ในคลังกลาง (company-files) ที่อยู่ในโฟลเดอร์ผูกห้อง
   * ต้องเป็นสมาชิกห้องนั้นถึงจะโหลดได้ ไม่ใช่แค่คนในบริษัทเดียวกัน (ดู serve-access.ts)
   * โมดูลอื่นยังกันแค่ระดับบริษัท (ผ่าน ownedByOrg ด้านบน) พอสำหรับตอนนี้
   */
  if (ownedByOrg && session.orgId && joined.startsWith(`${session.orgId}/company-files/`)) {
    const allowed = await canServeCompanyFileKey(session.orgId, session.userId, joined);
    if (!allowed) return new NextResponse("Forbidden", { status: 403 });
  }

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
