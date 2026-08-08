import { requireOrg } from "@smartboss/auth";

import { recordPerformanceEvents, type PerformanceEventInput } from "@/lib/performance";
import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { sweepAutoPenalties } from "@/modules/report_task/lib/task-penalty-sweep";
import type { ActivityItem, Task } from "@/modules/report_task/types";
import type { AppNotification } from "@/modules/report_task/store/notification-store";

/**
 * หักคะแนนงานที่เลยกำหนด — คำนวณและเขียนที่เซิร์ฟเวอร์ครั้งเดียว
 *
 * ต้นทางเคยให้ทุกแท็บที่เปิดอยู่คำนวณเอง ซึ่งชนกันได้ (สองแท็บหักซ้ำ/สลับไปมา)
 * TaskSync ยังเป็นตัวกระตุ้น (ตอนโหลด + ทุก 60 วิ) แต่การเขียนจริงเกิดที่นี่ที่เดียว
 * ถ้ามีคำขอซ้อนเข้ามา จะถูกปฏิเสธด้วยการตรวจ version แล้วข้ามรอบไป
 *
 * ต่างจากต้นฉบับ: อ่าน/เขียน Postgres แยกตามบริษัทจาก session ไม่ใช่ไฟล์รวม
 */
export const dynamic = "force-dynamic";

const TASKS_KEY = "tasks";
const ACTIVITY_KEY = "activity-log";
const NOTIFICATIONS_KEY = "notifications";
const MAX_ACTIVITY_ENTRIES = 1000;

export async function POST() {
  const session = await requireOrg();
  const orgId = session.orgId;

  const { data: tasks, version } = await readStore<Task[]>(orgId, TASKS_KEY);
  if (!tasks || tasks.length === 0) {
    return Response.json({ ok: true, changed: false });
  }

  const result = sweepAutoPenalties(tasks);
  if (!result.changed) {
    return Response.json({ ok: true, changed: false });
  }

  const saved = await writeStore(orgId, TASKS_KEY, result.tasks, version, session.userId);
  if (!saved.ok) {
    // มีคนเขียนแทรกระหว่างทาง (sweep ซ้อน หรือผู้ใช้แก้งาน) — ข้ามรอบนี้
    // ไม่ต้องแย่งเขียน รอบหน้าจะคำนวณใหม่จากข้อมูลล่าสุดเอง
    return Response.json({ ok: true, changed: false, skipped: "conflict" });
  }

  if (result.logs.length > 0) {
    const { data: existing, version: v } = await readStore<ActivityItem[]>(orgId, ACTIVITY_KEY);
    const fresh: ActivityItem[] = result.logs.map((l) => ({
      ...l,
      id: `log-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
    }));
    await writeStore(
      orgId,
      ACTIVITY_KEY,
      [...fresh, ...(existing ?? [])].slice(0, MAX_ACTIVITY_ENTRIES),
      v,
      session.userId
    );
  }

  if (result.notifications.length > 0) {
    const { data: existing, version: v } = await readStore<AppNotification[]>(
      orgId,
      NOTIFICATIONS_KEY
    );
    const fresh: AppNotification[] = result.notifications.flatMap((n) =>
      n.recipients.map((userId) => ({
        id: `notif-${crypto.randomUUID()}`,
        userId,
        byUserId: n.byUserId,
        message: n.message,
        createdAt: new Date().toISOString(),
        read: false,
      }))
    );
    await writeStore(orgId, NOTIFICATIONS_KEY, [...fresh, ...(existing ?? [])], v, session.userId);
  }

  /*
   * ส่งการหักคะแนนเข้าระบบกลาง เพื่อให้ไปโผล่ในหน้าสรุปรายคนของผู้บริหาร
   * รวมกับคะแนนจากโมดูลอื่น (ใบแจ้งซ่อมค้าง ฯลฯ) — ดู lib/performance.ts
   *
   * ใช้ taskId เป็นต้นเรื่อง ⇒ งานใบเดียวหักได้ครั้งเดียว แม้ sweep จะรันทุก 60 วินาที
   * ผู้รับผิดชอบคือคนแรกใน assigneeIds (งานที่ไม่มีคนรับ ข้ามไป)
   */
  const dockEvents: PerformanceEventInput[] = [];
  for (const task of result.tasks) {
    if (!task.penalty || !task.missedDeadlineOnce) continue;
    const owner = task.assigneeIds?.[0];
    if (!owner) continue;
    dockEvents.push({
      orgId,
      userId: owner,
      source: "report_task",
      category: "task_late",
      points: -Math.abs(task.penalty.points),
      occurredAt: task.dueDate ? new Date(task.dueDate) : new Date(),
      refType: "task",
      refId: task.id,
      note: task.title,
    });
  }
  const dockedCount = await recordPerformanceEvents(dockEvents);

  return Response.json({
    ok: true,
    changed: true,
    version: saved.version,
    performanceEvents: dockedCount,
  });
}

// Vercel Cron ยิงมาเป็น GET
export async function GET() {
  return POST();
}
