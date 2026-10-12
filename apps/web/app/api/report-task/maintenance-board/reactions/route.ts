import { requireOrg } from "@smartboss/auth";
import { z } from "zod";

import {
  ReactionError,
  addWorkOrderReaction,
  removeWorkOrderReaction,
} from "@/modules/report_task/lib/db/work-order-reactions";

/**
 * ติด / ยกเลิกสติกเกอร์บนการ์ดใบงานซ่อมในบอร์ดงาน — ตรวจสิทธิ์ + บันทึกคะแนนอยู่ใน
 * lib/db/work-order-reactions.ts · ผู้ให้มาจาก session เสมอ ไม่รับจาก body
 */
export const dynamic = "force-dynamic";

const addSchema = z.object({ workOrderId: z.string().min(1), stickerId: z.string().min(1) });
const removeSchema = z.object({ reactionId: z.string().min(1) });

function fail(err: unknown) {
  if (err instanceof ReactionError) return Response.json({ error: err.message }, { status: err.status });
  console.error("[report-task/maintenance-board/reactions]", err);
  return Response.json({ error: "บันทึกสติกเกอร์ไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 });
}

export async function POST(req: Request) {
  const session = await requireOrg();
  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 });
  try {
    const reaction = await addWorkOrderReaction(
      session.orgId,
      session.userId,
      parsed.data.workOrderId,
      parsed.data.stickerId
    );
    return Response.json({ reaction });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request) {
  const session = await requireOrg();
  const parsed = removeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 });
  try {
    await removeWorkOrderReaction(session.orgId, session.userId, parsed.data.reactionId);
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
