import "server-only";
import { randomUUID } from "node:crypto";


import { recordPerformanceEvents, revokePerformanceEvents, type PerformanceEventInput } from "@/lib/performance";
import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { readTasks, writeTasks } from "@/modules/report_task/lib/db/task-repo";
import { LATE_PENALTY_POINTS, penaltyDueDate, sweepAutoPenalties } from "@/modules/report_task/lib/task-penalty-sweep";
import type { ActivityItem, Task } from "@/modules/report_task/types";
import { prisma } from "@smartboss/database";
import { bangkokToday, formatThaiDate, spawnDueRounds, type SpawnedRound } from "@/modules/report_task/lib/task-recurrence";
import type { AppNotification } from "@/modules/report_task/store/notification-store";
import { claimSweep, releaseSweep } from "@/modules/report_task/lib/server/sweep-throttle";

/**
 * หักคะแนนงานที่เลยกำหนด — คำนวณและเขียนที่เซิร์ฟเวอร์ครั้งเดียว
 *
 * ต้นทางเคยให้ทุกแท็บที่เปิดอยู่คำนวณเอง ซึ่งชนกันได้ (สองแท็บหักซ้ำ/สลับไปมา)
 * TaskSync ยังเป็นตัวกระตุ้น (ตอนโหลด + ทุก 60 วิ) แต่การเขียนจริงเกิดที่นี่ที่เดียว
 * ถ้ามีคำขอซ้อนเข้ามา จะถูกปฏิเสธด้วยการตรวจ version แล้วข้ามรอบไป
 *
 * ต่างจากต้นฉบับ: อ่าน/เขียน Postgres แยกตามบริษัทจาก session ไม่ใช่ไฟล์รวม
 */

const ACTIVITY_KEY = "activity-log";
const NOTIFICATIONS_KEY = "notifications";
const MAX_ACTIVITY_ENTRIES = 1000;

/**
 * รันรอบหักคะแนนงานเลยกำหนดของบริษัทหนึ่ง — route (แท็บที่เปิดอยู่) และ cron ทุกชั่วโมง (task=score-sweeps)
 * เรียกตัวเดียวกัน · actorId null = ระบบ (cron) — writeTasks เห็นงานครบทุกงาน (รวมงานส่วนตัว)
 */
export async function runTaskPenaltySweep(orgId: string, actorId: string | null) {

  const { tasks, version } = await readTasks(orgId);
  if (tasks.length === 0) {
    return Response.json({ ok: true, changed: false });
  }

  // ค่านี้ตั้งได้ที่ /report-task/settings (สติกเกอร์ฯ) — เดิม sweep ใช้ค่าคงที่
  // ในโค้ดเสมอ (LATE_PENALTY_POINTS) โดยไม่สนใจว่าบริษัทตั้งไว้เท่าไหร่ ทำให้
  // ตัวเลขที่หักจริงกับตัวเลขที่ตั้งค่าไว้ไม่ตรงกัน
  const { data: configuredPoints } = await readStore<number>(orgId, "penalty-settings");
  const latePenaltyPoints =
    typeof configuredPoints === "number" && configuredPoints > 0
      ? Math.round(configuredPoints)
      : LATE_PENALTY_POINTS;

  // งานทำซ้ำ — สร้างรอบที่ถึงเวลาขึ้นบอร์ดก่อน แล้วค่อยหักคะแนนรวมกันในรอบเดียว
  // (ไม่มีชุดทำซ้ำเลย = ไม่ query อะไรเพิ่ม พฤติกรรมเดิมเป๊ะ)
  let spawned: SpawnedRound[] = [];
  if (tasks.some((t) => t.recurrence && !t.recurrence.stopped)) {
    const ids = new Set(tasks.flatMap((t) => (t.recurrence ? t.assigneeIds : [])));
    const active = await prisma.user.findMany({ where: { orgId, isActive: true, id: { in: [...ids] } }, select: { id: true } });
    spawned = spawnDueRounds(
      tasks,
      bangkokToday(),
      () => ({ taskId: `task-${randomUUID()}`, checklistId: () => `task-chk-${randomUUID()}` }),
      new Date().toISOString(),
      new Set(active.map((u) => u.id))
    );
  }
  const allTasks = spawned.length > 0 ? [...spawned.map((s) => s.task), ...tasks] : tasks;

  const swept = sweepAutoPenalties(allTasks, latePenaltyPoints);
  const result = { ...swept, changed: swept.changed || spawned.length > 0 };
  if (!result.changed) {
    return Response.json({ ok: true, changed: false });
  }
  for (const s of spawned) {
    const t = s.task;
    const round = `รอบที่ ${t.recurrence!.occurrence}`;
    const due = formatThaiDate(t.dueDate, false) + (t.dueTime ? ` ${t.dueTime}` : "");
    result.logs.push({ userId: t.assignedById, action: "สร้างงานรอบใหม่ (ทำซ้ำ)", target: t.title, taskId: t.id, detail: `${round} · ส่งภายใน ${due}` });
    result.notifications.push(
      s.noAssignees
        ? { recipients: [t.assignedById], byUserId: "system", message: `งานทำซ้ำ "${t.title}" ${round} ไม่มีผู้รับผิดชอบเหลืออยู่ (ลาออก/ปิดบัญชี) — มอบหมายใหม่ด้วย`, link: `/report-task/tasks?task=${t.id}`, taskId: t.id }
        : { recipients: t.assigneeIds, byUserId: "system", message: `งาน "${t.title}" ${round} มาแล้ว · ส่งภายใน ${due}`, link: `/report-task/tasks?task=${t.id}`, taskId: t.id, kind: "task_assigned" }
    );
  }

  const saved = await writeTasks(orgId, result.tasks, version, actorId);
  if (!saved.ok) {
    // มีคนเขียนแทรกระหว่างทาง (sweep ซ้อน หรือผู้ใช้แก้งาน) — ข้ามรอบนี้
    // ไม่ต้องแย่งเขียน รอบหน้าจะคำนวณใหม่จากข้อมูลล่าสุดเอง
    return Response.json({ ok: true, changed: false, skipped: "conflict" });
  }

  if (result.logs.length > 0) {
    const { data: existing, version: v } = await readStore<ActivityItem[]>(orgId, ACTIVITY_KEY);
    const fresh: ActivityItem[] = result.logs.map((l) => ({
      ...l,
      id: `log-${randomUUID()}`,
      createdAt: new Date().toISOString(),
    }));
    await writeStore(
      orgId,
      ACTIVITY_KEY,
      [...fresh, ...(existing ?? [])].slice(0, MAX_ACTIVITY_ENTRIES),
      v,
      actorId ?? undefined
    );
  }

  if (result.notifications.length > 0) {
    const { data: existing, version: v } = await readStore<AppNotification[]>(
      orgId,
      NOTIFICATIONS_KEY
    );
    const fresh: AppNotification[] = result.notifications.flatMap((n) =>
      n.recipients.map((userId) => ({
        id: `notif-${randomUUID()}`,
        userId,
        byUserId: n.byUserId,
        message: n.message,
        ...(n.link ? { link: n.link } : {}),
        ...(n.taskId ? { taskId: n.taskId } : {}),
        ...(n.kind ? { kind: n.kind } : {}),
        createdAt: new Date().toISOString(),
        read: false,
      }))
    );
    await writeStore(orgId, NOTIFICATIONS_KEY, [...fresh, ...(existing ?? [])], v, actorId ?? undefined);
  }

  /*
   * ส่งการหักคะแนนเข้าระบบกลาง เพื่อให้ไปโผล่ในหน้าสรุปรายคนของผู้บริหาร
   * รวมกับคะแนนจากโมดูลอื่น (ใบแจ้งซ่อมค้าง ฯลฯ) — ดู lib/performance.ts
   *
   * ใช้ taskId (+ userId สำหรับงานกลุ่ม) เป็นต้นเรื่อง ⇒ หักได้ครั้งเดียวต่อคน
   * แม้ sweep จะรันทุก 60 วินาที
   *
   * เดิมอ่านแค่ task.penalty (งานเดี่ยว) เท่านั้น — งานโหมดกลุ่มหักคะแนนผ่าน
   * task.penalties (รายคน) แทน ลูปนี้เลยไม่เคยส่งคะแนนงานกลุ่มที่เลยกำหนดเข้า
   * ระบบกลางเลยสักครั้ง (การ์ดบนบอร์ด Kanban ขึ้นหักคะแนนให้เห็น แต่คะแนนรวม
   * ที่หน้าผู้บริหารไม่เคยเปลี่ยนตาม) ต้องอ่านทั้งสองฟิลด์
   */
  const dockEvents: PerformanceEventInput[] = [];
  for (const task of result.tasks) {
    if (!task.missedDeadlineOnce) continue;
    // ลงวันที่ = กำหนดส่งที่พลาดจริง (penaltyDueDate) ไม่ใช่ dueDate ปัจจุบัน — เดิมเลื่อนกำหนด
    // หลังเลยไปแล้ว (23/10 → 30/10) รายการหักไปลงวันที่ 30/10 / 15/11 ⇒ ตกไปอยู่รอบคะแนนเดือนหน้า
    const missedDue = penaltyDueDate(task);

    if (task.penalty) {
      const owner = task.assigneeIds?.[0];
      if (owner) {
        dockEvents.push({
          orgId,
          userId: owner,
          source: "report_task",
          category: "task_late",
          points: -Math.abs(task.penalty.points),
          occurredAt: missedDue ? new Date(missedDue) : new Date(),
          refType: "task",
          refId: task.id,
          note: task.title,
        });
      }
    }

    for (const [assigneeId, penalty] of Object.entries(task.penalties ?? {})) {
      dockEvents.push({
        orgId,
        userId: assigneeId,
        source: "report_task",
        category: "task_late",
        points: -Math.abs(penalty.points),
        occurredAt: task.assigneeDueDates?.[assigneeId]
          ? new Date(task.assigneeDueDates[assigneeId]!)
          : missedDue
            ? new Date(missedDue)
            : new Date(),
        refType: "task",
        refId: `${task.id}:${assigneeId}`,
        note: task.title,
      });
    }
  }
  const dockedCount = await recordPerformanceEvents(dockEvents);

  // การหักอัตโนมัติที่ sweep รอบนี้คืนให้ (เลื่อนกำหนดส่งก่อนครบกำหนด) —
  // ลบคะแนนในระบบกลางตามด้วย ไม่งั้นหน้าผู้บริหารยังติดลบอยู่
  const revokedCount = await revokePerformanceEvents({
    orgId,
    source: "report_task",
    category: "task_late",
    refType: "task",
    refIds: result.revokedRefIds,
  });

  return Response.json({
    ok: true,
    changed: true,
    version: saved.version,
    performanceEvents: dockedCount,
    revokedPerformanceEvents: revokedCount,
  });
}
