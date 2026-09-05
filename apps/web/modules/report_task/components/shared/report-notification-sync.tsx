"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { ServerStoreSync } from "@/modules/report_task/components/shared/server-store-sync";
import type { User } from "@/modules/report_task/types";

/**
 * Keeps report_task's own notifications (@mentions, replies, task reviews,
 * issue tickets, ...) synced outside report_task pages, so the shared
 * AppBar's bell (app-bar-actions.tsx, shell.tsx) can count them in too —
 * without this, useReportTaskUnreadCount below would only ever see whatever
 * was already in memory, empty on every page load outside /report-task.
 *
 * Same guard as IssueReportBarButton: report_task pages already sync
 * "notifications" via report-task-scaffold.tsx's StoreHydrator, so mounting
 * this there too would double up and race two independent writers against
 * the same store key.
 */
export function ReportNotificationSync() {
  const pathname = usePathname();
  const isReportTaskPage = pathname.startsWith("/report-task");

  // viewingAsUserId/employees are what useReportTaskUnreadCount needs to know
  // *whose* notifications to count — same bootstrap IssueReportBarButton
  // already does for the exact same reason (nothing else populates them
  // outside report_task pages).
  useEffect(() => {
    if (isReportTaskPage) return;
    let cancelled = false;
    useIdentityStore.persist.rehydrate();
    fetch("/api/report-task/store/employees")
      .then((res) => res.json())
      .then((employees: User[]) => {
        if (!cancelled) useEmployeeStore.getState().setEmployees(employees);
      })
      .catch(() => {
        // Best-effort — worst case the bell just undercounts until a
        // report_task page populates the directory itself.
      });
    return () => {
      cancelled = true;
    };
  }, [isReportTaskPage]);

  if (isReportTaskPage) return null;
  return (
    <ServerStoreSync
      apiKey="notifications"
      store={useNotificationStore}
      select={(s) => s.notifications}
      apply={(s, notifications) => ({ ...s, notifications })}
    />
  );
}

/** Unread count for whoever the browser is currently "viewing as" — same
 * identity concept every other report_task badge (TaskReviewNavBadge,
 * ReportActivityNavBadge, IssueReportBarButton) already keys off. */
export function useReportTaskUnreadCount(): number {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  return useNotificationStore(
    (s) => s.notifications.filter((n) => n.userId === viewingAsUserId && !n.read).length
  );
}
