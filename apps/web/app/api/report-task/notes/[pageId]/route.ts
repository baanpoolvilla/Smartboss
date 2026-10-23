import { NextResponse, type NextRequest } from "next/server";
import { requireOrg } from "@smartboss/auth";

import { checkpointBeforeRestore, openPage, pushUpdate, syncPage, trashPage, updatePageMeta } from "@/modules/report_task/lib/notes/server";
import { noteError } from "@/modules/report_task/lib/notes/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** เปิดหน้า: สถานะเอกสารเต็ม (Yjs, base64) + ข้อมูลหน้า */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  try {
    const session = await requireOrg();
    const { pageId } = await params;
    return NextResponse.json(await openPage(session, pageId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return noteError(error);
  }
}

/** update = ส่งชุดแก้ · sync = ขอส่วนที่ขาด · meta = ชื่อ/ส่วน/ปักหมุด/ลำดับ · trash/restore · checkpoint = พักเวอร์ชันก่อนกู้คืน */
export async function POST(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  try {
    const session = await requireOrg();
    const { pageId } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    switch (body.op) {
      case "update":
        return NextResponse.json(await pushUpdate(session, { pageId, update: String(body.update ?? ""), clientId: String(body.clientId ?? "") }));
      case "sync":
        return NextResponse.json(await syncPage(session, { pageId, stateVector: String(body.stateVector ?? "") }));
      case "meta":
        await updatePageMeta(session, {
          pageId,
          ...(body.title !== undefined ? { title: String(body.title) } : {}),
          ...(body.sectionId !== undefined ? { sectionId: (body.sectionId as string | null) ?? null } : {}),
          ...(body.pinned !== undefined ? { pinned: body.pinned === true } : {}),
          ...(typeof body.sort === "number" ? { sort: body.sort } : {}),
        });
        return NextResponse.json({ ok: true });
      case "trash":
        await trashPage(session, pageId);
        return NextResponse.json({ ok: true });
      case "restore":
        await trashPage(session, pageId, true);
        return NextResponse.json({ ok: true });
      case "checkpoint":
        await checkpointBeforeRestore(session, pageId);
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "คำสั่งไม่ถูกต้อง" }, { status: 400 });
    }
  } catch (error) {
    return noteError(error);
  }
}
