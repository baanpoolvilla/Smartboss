import "server-only";
import { hasPermission, requireOrg } from "@smartboss/auth";

import { CHAT_PERMS } from "../permissions";
import { ChatError, type ChatActor } from "./serialize";

/** session → ผู้ทำรายการของแชท (โยน 403 ถ้าไม่มีสิทธิ์ chat.access) */
export async function chatActor(): Promise<ChatActor> {
  const session = await requireOrg();
  if (!hasPermission(session, CHAT_PERMS.access)) throw new ChatError("ไม่มีสิทธิ์ใช้งานแชท", 403);
  return { orgId: session.orgId, userId: session.userId, isChatAdmin: hasPermission(session, CHAT_PERMS.manage) };
}

/** แปลงข้อผิดพลาดเป็นคำตอบ JSON — ChatError ใช้สถานะของตัวเอง อย่างอื่น 500 */
export function chatErrorResponse(err: unknown, tag: string): Response {
  // redirect()/notFound() ของ Next โยน error พิเศษ — ต้องปล่อยให้ Next จัดการเอง
  if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
  if (err instanceof ChatError) return Response.json({ error: err.message }, { status: err.status });
  console.error(`[chat/${tag}]`, err);
  return Response.json({ error: "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง" }, { status: 500 });
}
