import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireOrg } from "@smartboss/auth";

import { clearTasks, readTasks, writeTasks } from "@/modules/report_task/lib/db/task-repo";
import { taskListSchema } from "@/modules/report_task/lib/db/task-schema";
import type { Task } from "@/modules/report_task/types";

/**
 * งานทั้งหมดของบริษัท — เขียนทั้งคอลเลกชันต่อครั้ง (write-through)
 *
 * ต่างจากต้นฉบับของ workspace ตรงที่เก็บลง Postgres แยกตามบริษัท ไม่ใช่ไฟล์
 * `data/tasks/tasks.json` ที่ทุกบริษัทใช้ร่วมกัน — orgId มาจาก session เท่านั้น
 *
 * ใช้ตารางเดียวกับ /store/{key} โดยจองคีย์ "tasks" ไว้ ต่างกันแค่ route นี้
 * ตรวจรูปร่างข้อมูลด้วย zod ก่อนเขียน (ต้นทางก็ทำ) ส่วน store อื่นยังไม่มี schema
 */
export const dynamic = "force-dynamic";

// กันไม่ให้ payload บวมเกินจริง (ไฟล์แนบ base64 คือตัวที่ทำให้บวมได้มากสุด)
const MAX_BODY_BYTES = 8 * 1024 * 1024;

// expectedVersion อยู่ใน body ไม่ใช่ If-Match header เพราะตอนปิดแท็บ
// client ส่งด้วย fetch(keepalive) ที่ตั้ง header เพิ่มไม่สะดวก
const putBodySchema = z.object({
  tasks: taskListSchema,
  expectedVersion: z.number().nullable(),
});

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function putTasks(request: NextRequest) {
  const session = await requireOrg();

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "ข้อมูลใหญ่เกินไป" }, { status: 413 });
  }
  const parsed = putBodySchema.safeParse(safeJsonParse(raw));
  if (!parsed.success) {
    return Response.json(
      { error: "รูปแบบข้อมูลไม่ถูกต้อง", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const result = await writeTasks(
    session.orgId,
    parsed.data.tasks,
    parsed.data.expectedVersion,
    session.userId
  );
  if (!result.ok) {
    return Response.json(
      { error: "ข้อมูลถูกแก้ไขโดยผู้ใช้อื่นแล้ว กรุณาโหลดใหม่", currentVersion: result.currentVersion },
      { status: 409 }
    );
  }
  return Response.json({ ok: true, count: parsed.data.tasks.length, version: result.version, codes: result.codes });
}

export async function GET() {
  const session = await requireOrg();
  const { tasks, version } = await readTasks(session.orgId);
  // บริษัทที่ยังไม่เคยบันทึก = ยังไม่มีงาน — คืนอาร์เรย์ว่าง ไม่ใช่ข้อมูลตัวอย่าง
  // (ต้นฉบับ seed ข้อมูลสาธิตให้ ซึ่งใช้กับบริษัทลูกค้าจริงไม่ได้)
  return Response.json(tasks, { headers: { "X-Data-Version": String(version) } });
}

export async function PUT(request: NextRequest) {
  return putTasks(request);
}

// fetch(keepalive) ตอนปิดแท็บส่งได้แต่ POST — ไม่มี alias นี้แล้วการแก้ไข
// ~500 มิลลิวินาทีสุดท้ายก่อนปิดแท็บจะหายเงียบ ๆ
export async function POST(request: NextRequest) {
  return putTasks(request);
}

// ล้างงานทั้งหมดของบริษัท — ต้องส่งคำยืนยันมาด้วย กันคำขอหลงมาลบข้อมูลทิ้ง
export async function DELETE(request: NextRequest) {
  const session = await requireOrg();
  const body = await request.json().catch(() => null);
  if (body?.confirm !== "RESET_ALL_DATA") {
    return Response.json(
      { error: 'ต้องส่ง { "confirm": "RESET_ALL_DATA" } เพื่อยืนยันการล้างข้อมูล' },
      { status: 400 }
    );
  }
  await clearTasks(session.orgId);
  return Response.json({ ok: true, count: 0 });
}
