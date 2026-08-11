"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Bug } from "lucide-react";
import { IssueReportDialog } from "./issue-report-dialog";
import { useIssueReportStore } from "@/modules/report_task/store/issue-report-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { reporterStatusGroup } from "@/modules/report_task/lib/issue-meta";

/**
 * App-wide "แจ้งปัญหา" entry point — floats above every page so filing a
 * report never depends on knowing /issue-reports exists. Hidden on that page
 * itself, which already has its own "แจ้งปัญหาใหม่" button in context.
 *
 * Auto-hides while scrolling down (so it doesn't sit on top of some other
 * page's own floating controls) and re-appears on scroll-up or when idle —
 * same "don't fight the page for space, but stay reachable" pattern as a
 * mobile app's scroll-collapsing FAB.
 */
export function ReportIssueFab() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lastScrollY = useRef(0);

  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const tickets = useIssueReportStore((s) => s.tickets);
  const needsYouCount = tickets.filter(
    (t) => t.reporterId === viewingAsUserId && reporterStatusGroup(t.status) === "needs_you"
  ).length;

  useEffect(() => {
    function onScroll() {
      const y = window.scrollY;
      setHidden(y > lastScrollY.current && y > 80);
      lastScrollY.current = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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

  if (pathname.startsWith("/issue-reports")) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="แจ้งปัญหาระบบ (Ctrl/⌘+Shift+I)"
        aria-label="แจ้งปัญหาระบบ"
        className={`fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-[var(--ink)] text-white pl-3.5 pr-4 h-11 shadow-lg hover:bg-[var(--ink)]/90 transition-all print:hidden ${
          hidden ? "translate-y-24 opacity-0 pointer-events-none" : "translate-y-0 opacity-100"
        }`}
      >
        <span className="relative">
          <Bug className="h-4 w-4 shrink-0" />
          {needsYouCount > 0 && (
            <span className="absolute -top-2 -right-2 h-3.5 w-3.5 rounded-full bg-[var(--chart-red)] ring-2 ring-[var(--ink)]" />
          )}
        </span>
        <span className="text-sm font-medium hidden sm:inline">แจ้งปัญหา</span>
        {needsYouCount > 0 && (
          <span className="hidden sm:inline text-[10px] font-bold bg-[var(--chart-red)] rounded-full px-1.5 py-0.5">
            รอคุณตอบ {needsYouCount}
          </span>
        )}
      </button>
      <IssueReportDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
