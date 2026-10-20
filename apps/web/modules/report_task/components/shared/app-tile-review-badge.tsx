"use client";

import { useEffect, useState } from "react";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { useDepartmentStore } from "@/modules/report_task/store/department-store";
import { canReviewTaskRecord, canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { aboutMeCountInPost } from "@/modules/report_task/lib/report-feed-activity";
import { unreadTaskAssignmentCounts, unreadTaskAttachmentCounts, unreadTaskCommentCounts } from "@/modules/report_task/lib/task-comment-activity";
import type { AppNotification } from "@/modules/report_task/store/notification-store";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import type { TaskReviewSettings } from "@/modules/report_task/store/task-review-settings-store";
import type { Task } from "@/modules/report_task/types";
import type { User, Department } from "@/modules/report_task/types";

/**
 * ของที่สอง tile (รายงานและงาน / Chat & Report) ต้องใช้ร่วมกัน — ดึงครั้งเดียวแล้วใช้ด้วยกัน และจำไว้
 * SHARED_TTL_MS: เดิมทุกครั้งที่กลับหน้าหลัก สอง tile ยิงคนละ 6 คำขอ รวมฟีดรายงานทั้งก้อน (หลาย MB)
 * สองรอบ ทั้งที่ tile งานไม่ได้ใช้ฟีดเลย (report-feed 284 ครั้งใน 3 ชม. — slow-pages.sh 2026-10-11)
 */
const SHARED_TTL_MS = 60_000;
const shared = new Map<string, { at: number; value: Promise<unknown> }>();

function fetchShared<T>(url: string): Promise<T> {
  const hit = shared.get(url);
  if (hit && Date.now() - hit.at < SHARED_TTL_MS) return hit.value as Promise<T>;
  const value = fetch(url).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });
  // พังแล้วไม่จำ — รอบหน้าลองใหม่
  value.catch(() => shared.delete(url));
  shared.set(url, { at: Date.now(), value });
  return value as Promise<T>;
}

/**
 * Combined "needs your attention in รายงานและงาน" count, rendered on the home
 * app-launcher tile — the sum of things the module already badges elsewhere,
 * added together since this is the one spot with only a single number to
 * show:
 *   - "งานรอตรวจ" + unread task comments/attachments/assignments (see TaskReviewNavBadge's own doc)
 *   - "ความเคลื่อนไหวเกี่ยวกับคุณ" in report-feed (see ReportActivityNavBadge/
 *     aboutMeCountInPost — @mentions and comments on your own posts)
 * This sits outside the report_task module, so none of its sync components
 * (TaskSync/StoreHydrator) are mounted here — fetches everything it needs
 * and rehydrates identity itself rather than assuming the stores are already
 * populated. One-shot on mount, not polled — same as the rest of this tile,
 * good enough for a snapshot on page load.
 */
export function AppTileReviewBadge({
  part = "tasks",
  extra = 0,
}: {
  /** "tasks" = tile รายงานและงาน (งานรอตรวจ + ความเคลื่อนไหวของงาน) · "reports" = tile Chat & Report
   * (ความเคลื่อนไหวในรายงานที่เกี่ยวกับเรา) — แชท/รายงานแยกเป็นโมดูลของตัวเองแล้ว ห้ามนับซ้ำสอง tile */
  part?: "tasks" | "reports";
  /** นับเพิ่มจากที่อื่น (tile Chat & Report ส่งจำนวนแชทยังไม่อ่านมา) */
  extra?: number;
} = {}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    useIdentityStore.persist.rehydrate();

    async function load() {
      try {
        // tile งานไม่ใช้ฟีดรายงาน · tile Chat & Report ไม่ใช้งาน/การตั้งค่าตรวจงาน — ดึงเฉพาะที่ใช้
        const none = Promise.resolve(null);
        const [tasks, employees, departments, reportFeed, reviewSettings, notifications] = (await Promise.all([
          part === "tasks" ? fetchShared("/api/report-task/tasks") : Promise.resolve([]),
          fetchShared("/api/report-task/store/employees"),
          fetchShared("/api/report-task/store/departments"),
          part === "reports" ? fetchShared("/api/report-task/store/report-feed") : none,
          part === "tasks" ? fetchShared("/api/report-task/store/task-review-settings") : none,
          part === "tasks" ? fetchShared("/api/report-task/store/notifications") : none,
        ])) as [
          Task[],
          User[],
          Department[],
          { topics?: ReportTopic[]; posts?: ReportPost[] } | null,
          TaskReviewSettings | null,
          AppNotification[] | null,
        ];
        if (cancelled) return;

        useEmployeeStore.getState().setEmployees(employees);
        useDepartmentStore.getState().setDepartments(departments);
        const viewingAsUserId = useIdentityStore.getState().viewingAsUserId;

        const reviewCount = tasks.filter(
          (t) =>
            t.status === "done" &&
            !t.reviewedBy &&
            canReviewTaskRecord(t, viewingAsUserId, reviewSettings ?? undefined)
        ).length;

        let unreadActivityCount = 0;
        for (const n of unreadTaskCommentCounts(notifications ?? [], viewingAsUserId).values()) unreadActivityCount += n;
        for (const n of unreadTaskAttachmentCounts(notifications ?? [], viewingAsUserId).values()) unreadActivityCount += n;
        for (const n of unreadTaskAssignmentCounts(notifications ?? [], viewingAsUserId).values()) unreadActivityCount += n;

        const topics = reportFeed?.topics ?? [];
        const posts = reportFeed?.posts ?? [];
        const topicById = new Map(topics.map((t) => [t.id, t]));
        const activeTopics = new Map<string, boolean>(
          topics.map((t) => [
            t.id,
            canSeeReportTopic(t.visibility, viewingAsUserId) && (t.notifyPreference?.[viewingAsUserId] ?? "all") !== "off",
          ])
        );
        const activityCount = posts.reduce(
          (sum, post) => (activeTopics.get(post.topicId) ? sum + aboutMeCountInPost(post, viewingAsUserId, topicById.get(post.topicId)) : sum),
          0
        );

        setCount(part === "tasks" ? reviewCount + unreadActivityCount : activityCount);
      } catch {
        // Best-effort — a failed fetch just leaves the tile without a badge.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [part]);

  const total = count + extra;
  if (total === 0) return null;
  return (
    <span
      className="absolute -right-1 -top-1 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-(--danger) px-1 text-[10px] font-bold text-white ring-2 ring-(--bg)"
      aria-label={`มีเรื่องรอคุณ ${total} รายการ`}
      title={`มีเรื่องรอคุณ ${total} รายการ`}
    >
      {total > 9 ? "9+" : total}
    </span>
  );
}
