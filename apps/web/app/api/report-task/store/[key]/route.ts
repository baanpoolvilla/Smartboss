import type { NextRequest } from "next/server";
import { requireOrg } from "@smartboss/auth";

import {
  listDirectory,
  saveDirectoryProfiles,
  type DirectoryUser,
} from "@/modules/report_task/lib/db/employee-directory";
import { isValidStoreKey, readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import {
  listHolidayEvents,
  listLeaveEvents,
} from "@/modules/report_task/lib/db/workforce-calendar";

/**
 * ที่เก็บสถานะที่แชร์กันทั้งทีมของโมดูลรายงานและงาน (ลา ประชุม วันหยุด ฟีดรายงาน
 * แจ้งเตือน บันทึกกิจกรรม พนักงาน แผนก ...) — เขียนทั้งก้อนต่อคีย์
 *
 * ต่างจากต้นฉบับของ workspace ตรงที่:
 *   1. เก็บลง Postgres (report_task.stores) ไม่ใช่ไฟล์ JSON ใน data/
 *      — ไฟล์ใช้กับหลายบริษัทไม่ได้ และ serverless เขียนดิสก์ไม่ได้
 *   2. **แยกตามบริษัท** ทุกคำขอผูกกับ orgId จาก session ไม่ใช่จากสิ่งที่ client ส่งมา
 *      ⇒ บริษัทหนึ่งอ่าน/เขียนข้อมูลของอีกบริษัทไม่ได้แม้จะเดา key ถูก
 *
 * `key` ตรวจกับ whitelist (store-registry.ts) ไม่ได้เอาไปต่อเป็น path
 * สัญญากับฝั่ง client เหมือนเดิมทุกอย่าง — UI และ store ไม่ต้องแก้
 */
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

function notFound() {
  return Response.json({ error: "ไม่รู้จัก store นี้" }, { status: 404 });
}

/*
 * "employees" ไม่ได้เก็บเป็นก้อนเหมือนคีย์อื่น — สร้างจาก core.users ทุกครั้ง
 * เพื่อให้คนในโมดูลนี้เป็นคนเดียวกับที่ล็อกอิน (ดู employee-directory.ts)
 * version คงที่ 1 เพราะไม่มีการชนกันของสองแท็บ — ตัวจริงอยู่ที่ core.users
 */
const DIRECTORY_KEY = "employees";

/*
 * การลากับวันหยุดเป็นของโมดูลบุคคล (workforce) — อ่านอย่างเดียวที่นี่
 *
 * เดิมโมดูลนี้เก็บของตัวเอง ทำให้มีข้อมูลการลาสองชุด และเงินเดือนคำนวณจาก
 * ชุดของ workforce เท่านั้น ⇒ ปฏิทินกับสลิปไม่ตรงกันโดยไม่มีอะไรเตือน
 */
const WORKFORCE_KEYS = new Set(["leaves", "holidays"]);

/** ช่วงที่ปฏิทินขอมาโดยปริยาย — กว้างพอครอบคลุมมุมมองปีของ FullCalendar */
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setMonth(from.getMonth() - 6);
  const to = new Date(now);
  to.setMonth(to.getMonth() + 12);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export async function GET(_request: NextRequest, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  if (!isValidStoreKey(key)) return notFound();

  const session = await requireOrg();

  if (key === DIRECTORY_KEY) {
    const users = await listDirectory(session.orgId);
    return Response.json(users, { headers: { "X-Data-Version": "1" } });
  }

  if (WORKFORCE_KEYS.has(key)) {
    const { from, to } = defaultRange();
    const events =
      key === "leaves"
        ? await listLeaveEvents(session.orgId, from, to)
        : await listHolidayEvents(session.orgId, from, to);
    // holidays store เก็บเป็น { holidays, selectedByUser } ส่วน leaves เป็นอาร์เรย์ตรง ๆ
    const payload =
      key === "holidays" ? { holidays: events, selectedByUser: {} } : events;
    return Response.json(payload, { headers: { "X-Data-Version": "1" } });
  }

  const { data, version } = await readStore<unknown>(session.orgId, key);
  return Response.json(data, { headers: { "X-Data-Version": String(version) } });
}

async function put(request: NextRequest, key: string) {
  if (!isValidStoreKey(key)) return notFound();
  const session = await requireOrg();

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "ข้อมูลใหญ่เกินไป" }, { status: 413 });
  }

  let body: { data?: unknown; expectedVersion?: unknown } | null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || !("data" in body)) {
    return Response.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  if (WORKFORCE_KEYS.has(key)) {
    /*
     * ไม่รับเขียน — ถ้ารับแล้วเก็บไว้ ข้อมูลจะไม่ถูกอ่านกลับ (GET อ่านจาก workforce)
     * กลายเป็นเงียบ ๆ หาย ผู้ใช้เข้าใจว่าบันทึกแล้ว ตอบ 409 พร้อมบอกว่าให้ไปทำที่ไหน
     * ดีกว่าปล่อยให้เข้าใจผิด
     */
    return Response.json(
      {
        error:
          key === "leaves"
            ? "การลาต้องยื่นที่โมดูลบุคคล (/hr) เพื่อให้ผ่านสายอนุมัติและตรงกับที่ใช้คิดเงินเดือน"
            : "วันหยุดตั้งค่าที่โมดูลบุคคล (/hr) — ปฏิทินนี้แสดงผลอย่างเดียว",
      },
      { status: 409 }
    );
  }

  if (key === DIRECTORY_KEY) {
    // เก็บเฉพาะแผนก/ตำแหน่ง/ตัวย่อ — ชื่อกับอีเมลแก้ที่ /admin เท่านั้น
    await saveDirectoryProfiles(
      session.orgId,
      (body.data ?? []) as DirectoryUser[],
      session.userId
    );
    return Response.json({ ok: true, version: 1 });
  }

  const expectedVersion = typeof body.expectedVersion === "number" ? body.expectedVersion : null;
  const result = await writeStore(
    session.orgId,
    key,
    body.data,
    expectedVersion,
    session.userId
  );

  if (!result.ok) {
    return Response.json(
      { error: "ข้อมูลถูกแก้ไขโดยผู้ใช้อื่นแล้ว กรุณาโหลดใหม่", currentVersion: result.currentVersion },
      { status: 409 }
    );
  }
  return Response.json({ ok: true, version: result.version });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  return put(request, key);
}

// TaskSync ตอนปิดแท็บใช้ fetch(keepalive) ซึ่งส่งได้แต่ POST — เก็บ alias ไว้
export async function POST(request: NextRequest, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  return put(request, key);
}
