import { rateLimit } from "@smartboss/auth/ratelimit";

import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";
import { createSticker, listStickers } from "@/modules/chat/data/stickers";

export const dynamic = "force-dynamic";

/** หมวด + สติกเกอร์ของบริษัททั้งหมด + บอกว่าคนนี้จัดการได้ไหม */
export async function GET() {
  try {
    const actor = await chatActor();
    return Response.json({ ...(await listStickers(actor.orgId)), canManage: actor.isChatAdmin });
  } catch (err) {
    return chatErrorResponse(err, "stickers");
  }
}

/** เพิ่มสติกเกอร์ (แอดมินแชท) — multipart: file, packId?, name?, width?, height? */
export async function POST(request: Request) {
  try {
    const actor = await chatActor();
    const limited = await rateLimit(`chat:sticker:${actor.userId}`, 120, 60);
    if (!limited.allowed) return Response.json({ error: "เพิ่มถี่เกินไป รอสักครู่แล้วลองใหม่" }, { status: 429 });
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return Response.json({ error: "ต้องแนบรูป" }, { status: 400 });
    const text = (k: string) => {
      const v = form?.get(k);
      return typeof v === "string" && v ? v : undefined;
    };
    const sticker = await createSticker(actor, {
      file,
      name: text("name"),
      packId: text("packId") ?? null,
      width: Number(text("width")) || undefined,
      height: Number(text("height")) || undefined,
    });
    return Response.json({ sticker });
  } catch (err) {
    return chatErrorResponse(err, "stickers");
  }
}
