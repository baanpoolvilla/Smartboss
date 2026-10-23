import { NextResponse, type NextRequest } from "next/server";
import { requireOrg } from "@smartboss/auth";

import { presence } from "@/modules/report_task/lib/notes/server";
import { noteError } from "@/modules/report_task/lib/notes/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** เปิดแท็บโน้ต/เปิดหน้า/เคอร์เซอร์ขยับ/ออก — คืนรายชื่อคนที่ดูอยู่ + เคอร์เซอร์ของคนในหน้าเดียวกัน */
export async function POST(req: NextRequest) {
  try {
    const session = await requireOrg();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const data = await presence(session, {
      topicId: String(body.topicId ?? ""),
      pageId: typeof body.pageId === "string" && body.pageId ? body.pageId : null,
      clientId: String(body.clientId ?? ""),
      awareness: typeof body.awareness === "string" ? body.awareness : null,
      leave: body.leave === true,
    });
    return NextResponse.json(data);
  } catch (error) {
    return noteError(error);
  }
}
