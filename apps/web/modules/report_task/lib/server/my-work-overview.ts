import "server-only";

import { readStore } from "@/modules/report_task/lib/db/org-store";
import { readTasks } from "@/modules/report_task/lib/db/task-repo";
import { listDirectory, type DirectoryUser } from "@/modules/report_task/lib/db/employee-directory";
import { listDepartmentsWithOverlay } from "@/modules/report_task/lib/db/departments";
import { effectiveRoundsOf } from "@/modules/report_task/lib/submission-rounds";
import type {
  ReportTopic,
  ReportTopicVisibility,
  SubmissionRound,
  SubmitterGroup,
  SubmitterRule,
} from "@/modules/report_task/store/report-feed-store";
import type { Task } from "@/modules/report_task/types";

/**
 * เวอร์ชัน server-safe ของ canSeeReportTopic/resolveRoundSubmitters
 * (lib/permissions.ts, lib/submission-rounds.ts) — ตรรกะเดียวกันเป๊ะ แต่รับ
 * `users`/`departments` เป็นพารามิเตอร์ตรงๆ จาก listDirectory()/
 * listDepartmentsWithOverlay() (query DB จริง) แทนอ่านจาก useEmployeeStore/
 * useDepartmentStore (client store ที่ฝั่งเซิร์ฟเวอร์ไม่เคยมีใคร populate เลย
 * — ยังไงก็ได้ users ว่างเปล่าเสมอถ้าเรียกของเดิมตรงๆ จากที่นี่) หน้านี้
 * ("บัญชีของฉัน" เป็น React Server Component) เป็นจุดแรกในระบบที่ต้องคำนวณ
 * เรื่องห้อง/รอบส่งฝั่งเซิร์ฟเวอร์ล้วนๆ จึงต้องมีสำเนานี้แยกไว้.
 */
// `viewerIsDeptHead` only needs to be correct for the ONE user this whole
// module computes for (`userId` in buildMyWorkOverview below) — resolveSubmitters
// calls this for other ids too while building a room's full member list, but
// the caller only ever reads whether `userId` itself ends up in the result,
// so their `canSee` correctness doesn't matter, only the target user's does.
function canSeeTopic(
  visibility: ReportTopicVisibility | undefined,
  userId: string,
  users: DirectoryUser[],
  viewerIsDeptHead: boolean
): boolean {
  const user = users.find((u) => u.id === userId);
  if (user?.isOwner) return true;
  if (!visibility || (!visibility.managerOnly && !visibility.departmentIds?.length && !visibility.userIds?.length)) return true;
  if (visibility.userIds?.length) return visibility.userIds.includes(userId);
  if (visibility.managerOnly && !viewerIsDeptHead) return false;
  if (visibility.departmentIds?.length) {
    const inDept = !!user?.departmentId && visibility.departmentIds.includes(user.departmentId);
    const inExtra = visibility.extraUserIds?.includes(userId) ?? false;
    if (!inDept && !inExtra) return false;
  }
  return true;
}

function resolveSubmitters(
  rule: SubmitterRule,
  visibility: ReportTopicVisibility | undefined,
  users: DirectoryUser[],
  groups: SubmitterGroup[],
  viewerIsDeptHead: boolean
): string[] {
  const canSee = (id: string) => canSeeTopic(visibility, id, users, viewerIsDeptHead);
  let base: string[] = [];
  switch (rule.mode) {
    case "everyone":
      base = users.filter((u) => canSee(u.id)).map((u) => u.id);
      break;
    case "groups": {
      const wanted = new Set(rule.groupIds ?? []);
      const ids = new Set<string>();
      for (const g of groups) {
        if (!wanted.has(g.id)) continue;
        for (const uid of g.userIds) ids.add(uid);
      }
      base = [...ids];
      break;
    }
    case "departments": {
      const wanted = new Set(rule.departmentIds ?? []);
      base = users.filter((u) => !!u.departmentId && wanted.has(u.departmentId)).map((u) => u.id);
      break;
    }
    case "people":
      base = [...(rule.userIds ?? [])];
      break;
  }
  const set = new Set(base);
  for (const id of rule.addUserIds ?? []) set.add(id);
  for (const id of rule.removeUserIds ?? []) set.delete(id);
  return [...set].filter((id) => !users.find((u) => u.id === id)?.isOwner && canSee(id));
}

const WD = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

/** "ทุกวันจันทร์-ศุกร์ · ก่อน 09:00 น." ในรูปแบบเดียวกับทุกจอที่โชว์รอบส่ง */
function whenLabel(r: Pick<SubmissionRound, "time" | "weekdays" | "dayOfMonth">): string {
  const day = r.dayOfMonth
    ? `วันที่ ${r.dayOfMonth} ของเดือน`
    : r.weekdays && r.weekdays.length > 0
      ? r.weekdays.slice().sort((a, b) => a - b).map((d) => WD[d]).join(" ")
      : "ทุกวัน";
  return `${day} · ก่อน ${r.time} น.`;
}

export interface MyReportRoom {
  topicId: string;
  topicName: string;
  /** รอบทั้งหมดที่คนนี้ต้องส่งจริงในห้องนี้ (ห้องหนึ่งมีได้หลายรอบ) */
  rounds: { label: string; when: string }[];
}

export interface MyTaskSummary {
  id: string;
  title: string;
  dueDate: string;
}

export interface MyWorkOverview {
  reportRooms: MyReportRoom[];
  /** งานที่ตัวเองเป็นหนึ่งใน assignee และยังไม่เสร็จ — กำลังทำอยู่ตอนนี้ */
  assignedToMeCount: number;
  assignedToMePreview: MyTaskSummary[];
  /** งานที่ตัวเองเป็นคนมอบหมาย (assignedById) ไม่ว่าใครทำ ไม่นับที่เสร็จแล้ว */
  assignedByMeCount: number;
}

const PREVIEW_LIMIT = 5;

/**
 * รวบรวม "ต้องส่งห้องไหนบ้าง กี่โมง" + "งานที่ได้รับมอบหมาย/มอบหมายให้คนอื่น"
 * ของคนคนเดียว — ใช้ในหน้า "บัญชีของฉัน" แท็บ "งานของฉัน" เท่านั้น ตอนนี้
 * (ไม่ได้ตั้งใจเป็น util ทั่วไป — ดูคอมเมนต์บนสุดของไฟล์ว่าทำไมต้องมีสำเนา
 * resolver แยกจาก lib/submission-rounds.ts ของฝั่ง client)
 */
export async function buildMyWorkOverview(orgId: string, userId: string): Promise<MyWorkOverview> {
  const [directory, departments, reportFeed, { tasks }] = await Promise.all([
    listDirectory(orgId),
    listDepartmentsWithOverlay(orgId),
    readStore<{ topics?: ReportTopic[]; submitterGroups?: SubmitterGroup[] }>(orgId, "report-feed"),
    readTasks(orgId),
  ]);

  const topics = reportFeed.data?.topics ?? [];
  const groups = reportFeed.data?.submitterGroups ?? [];
  const viewerIsDeptHead = departments.some((d) => d.headId === userId);

  // ทุกรอบที่ตัวเองต้องส่งจริง ไม่กรองเฉพาะวันนี้ — หน้านี้ตอบคำถาม "ต้องส่ง
  // ห้องไหนบ้าง วันไหนบ้าง" โดยรวม ไม่ใช่แค่ "วันนี้มีอะไรค้าง" (มีอันนั้นอยู่
  // แล้วที่ report-feed เอง)
  const reportRooms: MyReportRoom[] = [];
  for (const topic of topics) {
    const rounds = effectiveRoundsOf(topic);
    const mine = rounds.filter((r) => resolveSubmitters(r.submitters, topic.visibility, directory, groups, viewerIsDeptHead).includes(userId));
    if (mine.length === 0) continue;
    reportRooms.push({
      topicId: topic.id,
      topicName: topic.name,
      rounds: mine.map((r) => ({ label: r.label, when: whenLabel(r) })),
    });
  }
  reportRooms.sort((a, b) => a.topicName.localeCompare(b.topicName, "th"));

  const assignedToMe = tasks
    .filter((t: Task) => t.status !== "done" && t.assigneeIds.includes(userId))
    .sort((a: Task, b: Task) => a.dueDate.localeCompare(b.dueDate));
  const assignedByMe = tasks.filter((t: Task) => t.status !== "done" && t.assignedById === userId);

  return {
    reportRooms,
    assignedToMeCount: assignedToMe.length,
    assignedToMePreview: assignedToMe.slice(0, PREVIEW_LIMIT).map((t: Task) => ({ id: t.id, title: t.title || "(ไม่มีชื่องาน)", dueDate: t.dueDate })),
    assignedByMeCount: assignedByMe.length,
  };
}
