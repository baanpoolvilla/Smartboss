import { NextResponse, type NextRequest } from "next/server";
import { requireOrg } from "@smartboss/auth";

import { getVersion, listVersions } from "@/modules/report_task/lib/notes/server";
import { noteError } from "@/modules/report_task/lib/notes/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** ประวัติการแก้ไขของหน้า · ?id= เวอร์ชันเดียว (สถานะ + ข้อความ + ข้อความเวอร์ชันก่อนหน้าไว้เทียบ) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  try {
    const session = await requireOrg();
    const { pageId } = await params;
    const id = req.nextUrl.searchParams.get("id");
    const data = id ? await getVersion(session, pageId, id) : { versions: await listVersions(session, pageId) };
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return noteError(error);
  }
}
