import "server-only";

import { readStore } from "@/modules/report_task/lib/db/org-store";
import { listDirectory } from "@/modules/report_task/lib/db/employee-directory";
import { listDepartmentsWithOverlay } from "@/modules/report_task/lib/db/departments";
import type { ReportTopic, ReportTopicVisibility } from "@/modules/report_task/store/report-feed-store";

/**
 * เวอร์ชันฝั่งเซิร์ฟเวอร์ของ "ใครเห็นห้องนี้ได้" — ใช้โดยโมดูลอื่น (ตอนนี้คือ
 * company-files) ที่ต้องบังคับสิทธิ์จริง ไม่ใช่แค่กรอง UI
 *
 * ทำไมไม่ import canSeeReportTopic จาก lib/permissions.ts ตรงๆ: ฟังก์ชันนั้น
 * อ่าน users/departments จาก `lib/directory.ts` ซึ่งต่อกับ Zustand store
 * (useEmployeeStore/useDepartmentStore) ที่มีแค่ฝั่ง client เท่านั้น — เรียกจาก
 * server action ไม่ได้เลย ที่นี่เลยก็อปตรรกะเดียวกันมาเป็นฟังก์ชันที่รับข้อมูล
 * เป็นพารามิเตอร์แทน โดยดึงข้อมูลจริงจาก listDirectory/listDepartmentsWithOverlay
 * (ตัวเดียวกับที่ sync ให้ store ฝั่ง client ใช้)
 *
 * ⚠ ถ้าแก้กติกาการมองเห็นห้องใน lib/permissions.ts (canSeeReportTopic) ต้องแก้
 * ตรงนี้ให้ตรงกันด้วย — สองที่นี้ต้องเดินตามกันเสมอ
 */

function evaluateVisibility(
  visibility: ReportTopicVisibility | undefined,
  userId: string,
  ctx: { isOwner: boolean; isDeptHead: boolean; departmentId: string | undefined }
): boolean {
  if (ctx.isOwner) return true;
  if (!visibility || (!visibility.managerOnly && !visibility.departmentIds?.length && !visibility.userIds?.length)) {
    return true;
  }
  if (visibility.userIds?.length) return visibility.userIds.includes(userId);
  if (visibility.managerOnly && !ctx.isDeptHead) return false;
  if (visibility.departmentIds?.length) {
    const inDept = !!ctx.departmentId && visibility.departmentIds.includes(ctx.departmentId);
    const inExtra = visibility.extraUserIds?.includes(userId) ?? false;
    if (!inDept && !inExtra) return false;
  }
  return true;
}

async function loadTopicsAndContext(orgId: string) {
  const [store, users, departments] = await Promise.all([
    readStore<{ topics?: ReportTopic[] }>(orgId, "report-feed"),
    listDirectory(orgId),
    listDepartmentsWithOverlay(orgId),
  ]);
  const topics = store.data?.topics ?? [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const deptHeadUserIds = new Set(departments.filter((d) => d.headId).map((d) => d.headId));
  return { topics, userById, deptHeadUserIds };
}

/** เห็นหลายห้องพร้อมกัน (sidebar/list) — ดึงข้อมูลครั้งเดียว ไม่ยิงซ้ำต่อห้อง */
export async function listAccessibleTopicIds(orgId: string, userId: string): Promise<Set<string>> {
  const { topics, userById, deptHeadUserIds } = await loadTopicsAndContext(orgId);
  const user = userById.get(userId);
  const ctx = {
    isOwner: user?.isOwner === true,
    isDeptHead: deptHeadUserIds.has(userId),
    departmentId: user?.departmentId || undefined,
  };
  const ids = new Set<string>();
  for (const topic of topics) {
    if (evaluateVisibility(topic.visibility, userId, ctx)) ids.add(topic.id);
  }
  return ids;
}

/** เห็นห้องเดียว — ใช้เวลาตรวจสิทธิ์เข้าไฟล์/โฟลเดอร์ที่ผูกกับห้องนั้นเจาะจง */
export async function canUserAccessReportTopic(
  orgId: string,
  topicId: string,
  userId: string
): Promise<boolean> {
  const { topics, userById, deptHeadUserIds } = await loadTopicsAndContext(orgId);
  const topic = topics.find((t) => t.id === topicId);
  if (!topic) return false;
  const user = userById.get(userId);
  return evaluateVisibility(topic.visibility, userId, {
    isOwner: user?.isOwner === true,
    isDeptHead: deptHeadUserIds.has(userId),
    departmentId: user?.departmentId || undefined,
  });
}

/** ชื่อห้อง (สำหรับตั้งชื่อโฟลเดอร์ตอนสร้างครั้งแรก) — null ถ้าไม่พบห้องนี้ */
export async function getTopicName(orgId: string, topicId: string): Promise<string | null> {
  const { data } = await readStore<{ topics?: ReportTopic[] }>(orgId, "report-feed");
  return data?.topics?.find((t) => t.id === topicId)?.name ?? null;
}
