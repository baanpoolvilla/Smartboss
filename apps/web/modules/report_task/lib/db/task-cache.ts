import "server-only";

import { readTasks, readTasksVersion, type TaskCollection } from "@/modules/report_task/lib/db/task-repo";

/**
 * อ่านงานทั้งบริษัทสำหรับงานเบื้องหลัง (แจ้งเตือนใกล้ถึงกำหนด · หักคะแนนงานส่งช้า) — ใช้ชุดที่จำไว้ถ้าเลขรุ่นยังเท่าเดิม
 *
 * ผู้ใช้ 10/11/2569 (slow-pages: reminders/sweep ช้าสุด 4.1 วิ เรียก 91 ครั้ง) — ทุกแท็บที่เปิดอยู่สั่งงานพวกนี้ทุก 60 วิ
 * แต่ละรอบอ่านงานทุกใบจากฐานข้อมูลใหม่ ทั้งที่ส่วนใหญ่ไม่มีใครแก้อะไร · ตอนนี้ถามแค่เลขรุ่น (แถวเดียว)
 *
 * ถูกต้องเพราะ: ทุกทางที่เขียนงาน (writeTasks / clearTasks) ขยับเลขรุ่นใน transaction เดียวกับที่เขียน
 * และเก็บชุดที่อ่านไว้ใต้เลขรุ่นที่อ่าน "ก่อน" อ่านงาน — ถ้ามีการเขียนแทรกระหว่างนั้น เลขรุ่นจะไม่ตรงในรอบหน้า → อ่านใหม่
 * ส่งสำเนาออกไปทุกครั้ง ผู้เรียกแก้ข้อมูลที่ได้ไปได้ (ตัวหักคะแนนแก้แล้วบันทึกกลับ) โดยไม่กระทบชุดที่จำไว้
 */
const g = globalThis as unknown as { __taskCache?: Map<string, { version: number; tasks: TaskCollection["tasks"] }> };
const cache = (g.__taskCache ??= new Map());

export async function readTasksCached(orgId: string): Promise<TaskCollection> {
  const version = await readTasksVersion(orgId);
  const hit = cache.get(orgId);
  if (hit && hit.version === version) return { tasks: structuredClone(hit.tasks), version };
  const fresh = await readTasks(orgId);
  cache.set(orgId, { version, tasks: structuredClone(fresh.tasks) });
  return fresh;
}
