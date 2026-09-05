"use client";

import { useEffect, useState } from "react";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { useDepartmentStore } from "@/modules/report_task/store/department-store";
import { canReviewTask, canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { aboutMeCountInPost } from "@/modules/report_task/lib/report-feed-activity";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import type { Task } from "@/modules/report_task/types";
import type { User, Department } from "@/modules/report_task/types";

/**
 * Combined "needs your attention in รายงานและงาน" count, rendered on the home
 * app-launcher tile — the sum of two independent things the module already
 * badges elsewhere, added together since this is the one spot with only a
 * single number to show:
 *   - "งานรอตรวจ" (see TaskReviewNavBadge's own doc for the exact rule)
 *   - "ความเคลื่อนไหวเกี่ยวกับคุณ" in report-feed (see ReportActivityNavBadge/
 *     aboutMeCountInPost — @mentions and comments on your own posts)
 * This sits outside the report_task module, so none of its sync components
 * (TaskSync/StoreHydrator) are mounted here — fetches everything it needs
 * and rehydrates identity itself rather than assuming the stores are already
 * populated. One-shot on mount, not polled — same as the rest of this tile,
 * good enough for a snapshot on page load.
 */
export function AppTileReviewBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    useIdentityStore.persist.rehydrate();

    async function load() {
      try {
        const [tasksRes, employeesRes, departmentsRes, reportFeedRes] = await Promise.all([
          fetch("/api/report-task/tasks"),
          fetch("/api/report-task/store/employees"),
          fetch("/api/report-task/store/departments"),
          fetch("/api/report-task/store/report-feed"),
        ]);
        const [tasks, employees, departments, reportFeed] = (await Promise.all([
          tasksRes.json(),
          employeesRes.json(),
          departmentsRes.json(),
          reportFeedRes.json(),
        ])) as [Task[], User[], Department[], { topics?: ReportTopic[]; posts?: ReportPost[] } | null];
        if (cancelled) return;

        useEmployeeStore.getState().setEmployees(employees);
        useDepartmentStore.getState().setDepartments(departments);
        const viewingAsUserId = useIdentityStore.getState().viewingAsUserId;

        const reviewCount = tasks.filter(
          (t) => t.status === "done" && !t.reviewedBy && canReviewTask(t.departmentIds, viewingAsUserId)
        ).length;

        const topics = reportFeed?.topics ?? [];
        const posts = reportFeed?.posts ?? [];
        const activeTopics = new Map<string, boolean>(
          topics.map((t) => [
            t.id,
            canSeeReportTopic(t.visibility, viewingAsUserId) && (t.notifyPreference?.[viewingAsUserId] ?? "all") !== "off",
          ])
        );
        const activityCount = posts.reduce(
          (sum, post) => (activeTopics.get(post.topicId) ? sum + aboutMeCountInPost(post, viewingAsUserId) : sum),
          0
        );

        setCount(reviewCount + activityCount);
      } catch {
        // Best-effort — a failed fetch just leaves the tile without a badge.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (count === 0) return null;
  return (
    <span
      className="absolute -right-1 -top-1 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-(--danger) px-1 text-[10px] font-bold text-white ring-2 ring-(--bg)"
      aria-label={`มีเรื่องรอคุณ ${count} รายการ`}
      title={`มีเรื่องรอคุณ ${count} รายการ`}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
