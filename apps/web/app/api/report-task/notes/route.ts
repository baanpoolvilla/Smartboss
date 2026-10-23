import { NextResponse, type NextRequest } from "next/server";
import { requireOrg } from "@smartboss/auth";

import { noteError } from "@/modules/report_task/lib/notes/http";
import { createPage, listRoom, saveSection } from "@/modules/report_task/lib/notes/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** รายชื่อส่วน/หน้าของห้อง · ?trash=1 ถังขยะ · ?q= ค้นหา (ชื่อหน้า + เนื้อหา) */
export async function GET(req: NextRequest) {
  try {
    const session = await requireOrg();
    const sp = req.nextUrl.searchParams;
    const data = await listRoom(session, sp.get("topic") ?? "", { trash: sp.get("trash") === "1", q: sp.get("q") ?? undefined });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return noteError(error);
  }
}

/** สร้างหน้า / สร้าง-แก้-ลบส่วน */
export async function POST(req: NextRequest) {
  try {
    const session = await requireOrg();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const topicId = String(body.topicId ?? "");
    if (body.op === "createPage") {
      const page = await createPage(session, { topicId, sectionId: (body.sectionId as string | null) ?? null, title: body.title as string | undefined, state: body.state as string | undefined });
      return NextResponse.json(page);
    }
    if (body.op === "section") {
      await saveSection(session, { topicId, id: body.id as string | undefined, name: body.name as string | undefined, color: body.color as string | undefined, sort: body.sort as number | undefined, remove: body.remove === true });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "คำสั่งไม่ถูกต้อง" }, { status: 400 });
  } catch (error) {
    return noteError(error);
  }
}
