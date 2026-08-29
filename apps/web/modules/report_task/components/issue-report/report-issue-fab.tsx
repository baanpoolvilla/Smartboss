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
 * App-wide "แจ้งปัญหา" entry point — pinned to the bottom-left corner of
 * every page. Mounted once in Shell (see shell.tsx) so it's reachable from
 * any module, not just report_task's own screens.
 *
 * A free-roaming version of this (wandering/bouncing around the viewport)
 * was tried first as a fun touch, then walked back after seeing it land in
 * awkward spots on real pages — a moving target is a worse "always
 * reachable" than a fixed one, so this stays put. The home screen also gets
 * its own static tile (issue-report-app-tile.tsx) for people who'd rather
 * find it there than hunt for a corner icon.
 */
export function ReportIssueFab() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const tickets = useIssueReportStore((s) => s.tickets);
  const needsYouCount = tickets.filter(
    (t) => t.reporterId === viewingAsUserId && reporterStatusGroup(t.status) === "needs_you"
  ).length;

  useEffect(() => setMounted(true), []);

  // report_task pages already mount StoreHydrator (report-task-scaffold.tsx),
  // which keeps the employee directory and identity in sync — mounting this
  // again there would double up and race two independent writers against
  // the same "issue-reports" store. Everywhere else (this button is on every
  // page in the app, that's the whole point), nothing populates them at
  // all, same gap AppTileReviewBadge already had to work around: without
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
  if (!mounted) return null;

  return (
    <>
      {/* Same store, same key StoreHydrator already syncs on every
          report_task page — only mounted here when we're NOT on one of
          those pages, so a ticket filed from some unrelated module actually
          reaches the server instead of living only in this tab's memory. */}
      {!isReportTaskPage && (
        <ServerStoreSync
          apiKey="issue-reports"
          store={useIssueReportStore}
          select={(s) => ({ schemaVersion: s.schemaVersion, tickets: s.tickets })}
          apply={(s, slice) => ({ ...s, ...migrateIssueStoreSlice(slice) })}
        />
      )}
      <button
        onClick={() => setOpen(true)}
        title="แจ้งปัญหาระบบ (Ctrl/⌘+Shift+I)"
        aria-label="แจ้งปัญหาระบบ"
        className="fixed bottom-5 left-5 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--ink)] text-white shadow-lg hover:bg-[var(--ink)]/90 print:hidden"
      >
        <span className="relative">
          <Bug className="h-5 w-5 shrink-0" />
          {needsYouCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 rounded-full bg-[var(--chart-red)] ring-2 ring-[var(--ink)]" />
          )}
        </span>
      </button>
      <IssueReportDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
