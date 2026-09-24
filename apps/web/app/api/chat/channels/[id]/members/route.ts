import { addMembers, removeMember, setMemberRole } from "@/modules/chat/data/channels";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** เพิ่มสมาชิก { userIds } */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const userIds = Array.isArray(body.userIds) ? body.userIds.filter((u: unknown): u is string => typeof u === "string") : [];
    await addMembers(actor, id, userIds);
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "members");
  }
}

/** ตั้ง/ถอนแอดมิน { userId, role: "admin" | "member" } */
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (typeof body.userId !== "string" || (body.role !== "admin" && body.role !== "member")) {
      return Response.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
    }
    await setMemberRole(actor, id, body.userId, body.role);
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "members");
  }
}

/** เอาสมาชิกออก ?userId= (ไม่ใส่ = ออกจากกลุ่มเอง) */
export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    const userId = new URL(request.url).searchParams.get("userId") || actor.userId;
    await removeMember(actor, id, userId);
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "members");
  }
}
