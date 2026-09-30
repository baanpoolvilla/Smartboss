import { createNote, listNotes } from "@/modules/chat/data/notes";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** โน้ตของห้อง (ใหม่ → เก่า) */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    return Response.json({ notes: await listNotes(actor, id) });
  } catch (err) {
    return chatErrorResponse(err, "notes");
  }
}

/** สร้างโน้ต { body, attachments } — โพสต์การ์ดลงห้องให้ด้วย */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    return Response.json(await createNote(actor, id, { body: body?.body, attachments: body?.attachments }));
  } catch (err) {
    return chatErrorResponse(err, "notes");
  }
}
