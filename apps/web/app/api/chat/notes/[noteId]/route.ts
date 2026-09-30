import { deleteNote, getNote, updateNote } from "@/modules/chat/data/notes";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ noteId: string }> };

/** โน้ต + คอมเมนต์ */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { noteId } = await params;
    return Response.json(await getNote(actor, noteId));
  } catch (err) {
    return chatErrorResponse(err, "note");
  }
}

/** แก้โน้ต { body, attachments } */
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { noteId } = await params;
    const body = await request.json().catch(() => ({}));
    await updateNote(actor, noteId, { body: body?.body, attachments: body?.attachments });
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "note");
  }
}

/** ลบโน้ต — การ์ดในห้องกลายเป็น "ยกเลิกข้อความ" */
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { noteId } = await params;
    await deleteNote(actor, noteId);
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "note");
  }
}
