"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Bug } from "lucide-react";
import { IssueReportDialog } from "./issue-report-dialog";
import { useIssueReportStore } from "@/modules/report_task/store/issue-report-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { migrateIssueStoreSlice } from "@/modules/report_task/lib/issue-migration";
import { reporterStatusGroup } from "@/modules/report_task/lib/issue-meta";
import { ServerStoreSync } from "@/modules/report_task/components/shared/server-store-sync";
import type { User } from "@/modules/report_task/types";

/**
 * App-wide "แจ้งปัญหา" entry point — an icon button in the shared AppBar,
 * right next to the notification bell (see app-bar-actions.tsx). Reachable
 * from every module that uses AppScaffold, which is most of the app.
 *
 * Two earlier versions of this lived as a floating overlay instead: first a
 * bug that wandered/bounced around the whole viewport (fun, but landed in
 * awkward spots on real pages), then a fixed corner button (worked, but sat
 * apart from the rest of the app's chrome and could still overlap page
 * content, e.g. a reply button sitting right where it happened to rest).
 * Moving it into the AppBar itself — the one thing that's already
 * consistently on screen and never overlaps anything — reads better on
 * mobile especially ("ดูสวยกว่า"), so this replaces both.
 */
export function IssueReportBarButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const tickets = useIssueReportStore((s) => s.tickets);
  const needsYouCount = tickets.filter(
    (t) => t.reporterId === viewingAsUserId && reporterStatusGroup(t.status) === "needs_you"
  ).length;

  // report_task pages already mount StoreHydrator (report-task-scaffold.tsx),
  // which keeps the employee directory and identity in sync — mounting this
  // again there would double up and race two independent writers against
  // the same "issue-reports" store. Everywhere else (this button is in the
  // AppBar on every module, that's the whole point), nothing populates them
  // at all, same gap AppTileReviewBadge already had to work around: without
  // this, "who's reporting" would resolve to nobody and any ticket filed
  // from outside report_task would only ever exist in this tab's memory,
  // gone on refresh.
  const isReportTaskPage = pathname.startsWith("/report-task");
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
        // Best-effort, same as AppTileReviewBadge — the report dialog still
        // opens either way, it just can't attribute the ticket to a real name.
      });
    return () => {
      cancelled = true;
    };
  }, [isReportTaskPage]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Hidden on the ticket list/detail pages themselves — those already have
  // their own "แจ้งปัญหาใหม่" entry point in context.
  if (pathname.startsWith("/report-task/issue-reports")) return null;

  return (
    <>
      {!isReportTaskPage && (
        <ServerStoreSync
          apiKey="issue-reports"
          store={useIssueReportStore}
          select={(s) => ({ schemaVersion: s.schemaVersion, tickets: s.tickets })}
          apply={(s, slice) => ({ ...s, ...migrateIssueStoreSlice(slice) })}
        />
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="แจ้งปัญหาระบบ (Ctrl/⌘+Shift+I)"
        aria-label="แจ้งปัญหาระบบ"
        className="relative rounded-full p-2 text-(--app-strong) transition-colors hover:bg-(--bg-soft)"
      >
        <Bug className="h-5 w-5" />
        {needsYouCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-(--danger) px-1 text-[10px] font-bold text-white">
            {needsYouCount > 99 ? "99+" : needsYouCount}
          </span>
        )}
      </button>
      <IssueReportDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
