import type { NextRequest } from "next/server";
import { requireOrg } from "@smartboss/auth";

import {
  listDirectory,
  saveDirectoryProfiles,
  type DirectoryUser,
} from "@/modules/report_task/lib/db/employee-directory";
import {
  listDepartmentsWithOverlay,
  saveDepartmentOverlay,
} from "@/modules/report_task/lib/db/departments";
import { isValidStoreKey, readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { announceNotification } from "@/lib/notify-push";
import { recordReportStickerEvents, refundDeletedReportRoundEvents } from "@/modules/report_task/lib/db/report-feed-performance";
import {
  listHolidayEvents,
  listLeaveEvents,
  listLeaveTypeCatalog,
  listOvertimeEvents,
} from "@/modules/report_task/lib/db/workforce-calendar";
import type { Department } from "@/modules/report_task/types";

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
 * "departments" ก็เช่นกัน — ชื่อ/การมีอยู่จริงมาจาก core.departments (จัดการที่
 * /admin/departments) ส่วนสี/หัวหน้าแผนกยังเป็นของโมดูลนี้เอง (ดู lib/db/departments.ts)
 */
const DEPARTMENTS_KEY = "departments";

/**
 * ฟีดรายงาน — เขียนทั้งก้อนเหมือนคีย์ทั่วไป แต่ต้องอ่านก้อนเก่าไว้ก่อนทับ
 * เพื่อ diff หา sticker reaction ที่เพิ่งติดใหม่ (recordReportStickerEvents)
 * แล้วส่งเข้าระบบคะแนนผลงานกลาง (core.performance_events) — ขนานกับที่
 * writeTasks ของ Kanban ทำกับ task.reactions อยู่แล้ว
 */
const REPORT_FEED_KEY = "report-feed";

/*
 * การลากับวันหยุดเป็นของโมดูลบุคคล (workforce) — อ่านอย่างเดียวที่นี่
 *
 * เดิมโมดูลนี้เก็บของตัวเอง ทำให้มีข้อมูลการลาสองชุด และเงินเดือนคำนวณจาก
 * ชุดของ workforce เท่านั้น ⇒ ปฏิทินกับสลิปไม่ตรงกันโดยไม่มีอะไรเตือน
 */
const WORKFORCE_KEYS = new Set(["leaves", "holidays", "overtime"]);

/** ชื่อประเภทลาทั้งหมด — ไม่ต้องใช้ช่วงวันที่เหมือนสองคีย์ข้างบน */
const LEAVE_TYPE_CATALOG_KEY = "leave-type-catalog";

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
    return Response.json(users, { headers: { "Cache-Control": "no-store", "X-Data-Version": "1" } });
  }

  if (key === DEPARTMENTS_KEY) {
    const departments = await listDepartmentsWithOverlay(session.orgId);
    return Response.json(departments, { headers: { "Cache-Control": "no-store", "X-Data-Version": "1" } });
  }

  if (key === LEAVE_TYPE_CATALOG_KEY) {
    const names = await listLeaveTypeCatalog(session.orgId);
    return Response.json(names, { headers: { "Cache-Control": "no-store", "X-Data-Version": "1" } });
  }

  if (WORKFORCE_KEYS.has(key)) {
    const { from, to } = defaultRange();
    const events =
      key === "leaves"
        ? await listLeaveEvents(session.orgId, from, to)
        : key === "overtime"
          ? await listOvertimeEvents(session.orgId, from, to)
          : await listHolidayEvents(session.orgId, from, to);
    // holidays store เก็บเป็น { holidays, selectedByUser } ส่วน leaves/overtime เป็นอาร์เรย์ตรง ๆ
    const payload =
      key === "holidays" ? { holidays: events, selectedByUser: {} } : events;
    return Response.json(payload, { headers: { "Cache-Control": "no-store", "X-Data-Version": "1" } });
  }

  const { data, version } = await readStore<unknown>(session.orgId, key);
  return Response.json(data, { headers: { "Cache-Control": "no-store", "X-Data-Version": String(version) } });
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

  if (key === LEAVE_TYPE_CATALOG_KEY) {
    return Response.json(
      { error: "ประเภทลาตั้งค่าที่โมดูลบุคคล (/hr/settings) — ปฏิทินนี้แสดงผลอย่างเดียว" },
      { status: 409 }
    );
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
    // เก็บเฉพาะตัวย่อ — ชื่อ/อีเมล/แผนก/ตำแหน่งแก้ที่ /admin เท่านั้น
    await saveDirectoryProfiles(
      session.orgId,
      (body.data ?? []) as DirectoryUser[],
      session.userId
    );
    return Response.json({ ok: true, version: 1 });
  }

  if (key === DEPARTMENTS_KEY) {
    // เก็บเฉพาะสี/หัวหน้าแผนก — ชื่อ/การสร้าง/การลบแผนกแก้ที่ /admin/departments เท่านั้น
    await saveDepartmentOverlay(
      session.orgId,
      (body.data ?? []) as Department[],
      session.userId
    );
    return Response.json({ ok: true, version: 1 });
  }

  const expectedVersion = typeof body.expectedVersion === "number" ? body.expectedVersion : null;

  // ต้องอ่านก้อนเก่าไว้ก่อนเขียนทับ — หลังเขียนแล้วก้อนเก่าหายไปเลย ไม่มีทาง
  // ย้อนกลับมา diff ว่า reaction ไหนเพิ่งติดใหม่ หรือรอบส่งไหนถูกลบไป (เฉพาะคีย์ report-feed)
  const before = key === REPORT_FEED_KEY ? await readStore<{ posts?: unknown[]; topics?: unknown[] }>(session.orgId, key) : null;
  // แจ้งเตือนของงาน/รายงานถูกเพิ่มโดยเครื่องของผู้ทำรายการ แล้วบันทึกทั้งก้อน — เทียบกับก้อนเก่า
  // หาแถวที่เพิ่งเพิ่ม เพื่อเด้ง/มีเสียงให้ผู้รับทันที (ไม่ต้องรอเครื่องผู้รับดึงรอบถัดไป)
  const notificationsBefore = key === "notifications" ? await readStore<unknown>(session.orgId, key) : null;

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

  if (key === REPORT_FEED_KEY) {
    await recordReportStickerEvents(
      session.orgId,
      before?.data as Parameters<typeof recordReportStickerEvents>[1],
      body.data as Parameters<typeof recordReportStickerEvents>[2],
      session.userId
    );
    await refundDeletedReportRoundEvents(
      session.orgId,
      before?.data as Parameters<typeof refundDeletedReportRoundEvents>[1],
      body.data as Parameters<typeof refundDeletedReportRoundEvents>[2]
    );
  }

  if (key === "notifications") {
    announceNewReportNotifications(session.orgId, session.userId, notificationsBefore?.data, body.data);
  }

  return Response.json({ ok: true, version: result.version });
}

interface StoredNotification {
  id?: unknown;
  userId?: unknown;
  byUserId?: unknown;
  message?: unknown;
  read?: unknown;
  link?: unknown;
  kind?: unknown;
  topicName?: unknown;
}

/** แถวแจ้งเตือนที่เพิ่งเพิ่มในรอบนี้ → เด้งถึงผู้รับ (ไม่ใช่ตัวผู้ทำรายการเอง) */
function announceNewReportNotifications(orgId: string, actorId: string, beforeData: unknown, afterData: unknown) {
  if (!Array.isArray(afterData)) return;
  const known = new Set(
    (Array.isArray(beforeData) ? (beforeData as StoredNotification[]) : []).map((n) => n?.id).filter((id) => typeof id === "string")
  );
  // กันก้อนแปลก ๆ (เช่น โหลดเก่าแล้วบันทึกทับ) ยิงแจ้งเตือนเป็นร้อย — ของจริงต่อครั้งมีไม่กี่แถว
  const fresh = (afterData as StoredNotification[])
    .filter(
      (n) =>
        n &&
        typeof n.id === "string" &&
        !known.has(n.id) &&
        typeof n.userId === "string" &&
        n.userId !== actorId &&
        n.read !== true &&
        // "room_post" = สรุปทุกโพสต์ให้เจ้าของดูภาพรวม ไม่ใช่เรื่องถึงตัว — ไม่ต้องเด้ง
        n.kind !== "room_post"
    )
    .slice(0, 50);
  for (const n of fresh) {
    const message = typeof n.message === "string" ? n.message : "มีแจ้งเตือนใหม่";
    void announceNotification(orgId, [n.userId as string], {
      title: typeof n.topicName === "string" && n.topicName ? n.topicName : "SmartBoss",
      body: message.slice(0, 160),
      url: typeof n.link === "string" && n.link.startsWith("/") ? n.link : "/notifications",
      tag: `rn-${n.id as string}`,
    });
  }
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
