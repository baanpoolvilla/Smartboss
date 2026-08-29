"use client";

import { useEffect, useRef, useState } from "react";
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

const SIZE = 44;
const MARGIN = 10;
/** Roughly how fast the bug wanders, in px/frame-at-60fps. */
const SPEED = 0.9;

/**
 * App-wide "แจ้งปัญหา" entry point — a bug icon that literally crawls around
 * the screen ("อยากให้วิ่งทั่วจอเป็นรูปแมลง เป็นลูกเล่น"), not a static
 * corner button. Mounted once in the root shell layout so it's reachable
 * from every page, not just report_task's own screens.
 *
 * Wanders inside the viewport, bouncing off the edges with small random
 * course corrections so it doesn't read as a mechanical DVD-logo bounce.
 * Pauses on hover (so it's actually possible to click a moving target) and
 * whenever its own dialog is open. Respects prefers-reduced-motion by
 * skipping the animation entirely and just sitting in the corner — a bug
 * that won't stop moving is exactly the kind of motion that setting exists
 * to suppress.
 */
export function ReportIssueFab() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hovering, setHovering] = useState(false);
  const elRef = useRef<HTMLButtonElement>(null);
  const pos = useRef({ x: 24, y: 24 });
  const dir = useRef({ x: 1, y: 1 });
  const rafRef = useRef<number | null>(null);
  const pausedRef = useRef(false);

  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const tickets = useIssueReportStore((s) => s.tickets);
  const needsYouCount = tickets.filter(
    (t) => t.reporterId === viewingAsUserId && reporterStatusGroup(t.status) === "needs_you"
  ).length;

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    pos.current = { x: window.innerWidth - SIZE - 24, y: window.innerHeight - SIZE - 24 };
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    pausedRef.current = hovering || open;
  }, [hovering, open]);

  // report_task pages already mount StoreHydrator (report-task-scaffold.tsx),
  // which keeps the employee directory and identity in sync — mounting this
  // again there would double up and race two independent writers against
  // the same "issue-reports" store. Everywhere else (this bug wanders onto
  // every page in the app, that's the whole point), nothing populates them
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
    if (reducedMotion) return;

    function step() {
      rafRef.current = requestAnimationFrame(step);
      if (pausedRef.current) return;
      const el = elRef.current;
      if (!el) return;

      // Small random wobble each frame so the path curves instead of
      // bouncing in dead-straight lines — still fully deterministic bounce
      // off the walls underneath, just with a organic-looking heading.
      dir.current.x += (Math.random() - 0.5) * 0.3;
      dir.current.y += (Math.random() - 0.5) * 0.3;
      const len = Math.hypot(dir.current.x, dir.current.y) || 1;
      dir.current.x /= len;
      dir.current.y /= len;

      const maxX = window.innerWidth - SIZE - MARGIN;
      const maxY = window.innerHeight - SIZE - MARGIN;
      let nextX = pos.current.x + dir.current.x * SPEED * 4;
      let nextY = pos.current.y + dir.current.y * SPEED * 4;

      if (nextX < MARGIN) {
        nextX = MARGIN;
        dir.current.x = Math.abs(dir.current.x);
      } else if (nextX > maxX) {
        nextX = maxX;
        dir.current.x = -Math.abs(dir.current.x);
      }
      if (nextY < MARGIN) {
        nextY = MARGIN;
        dir.current.y = Math.abs(dir.current.y);
      } else if (nextY > maxY) {
        nextY = maxY;
        dir.current.y = -Math.abs(dir.current.y);
      }

      pos.current = { x: nextX, y: nextY };
      const angle = (Math.atan2(dir.current.y, dir.current.x) * 180) / Math.PI;
      el.style.transform = `translate(${nextX}px, ${nextY}px) rotate(${angle + 90}deg)`;
    }

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [reducedMotion]);

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
        ref={elRef}
        onClick={() => setOpen(true)}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        title="แจ้งปัญหาระบบ (Ctrl/⌘+Shift+I)"
        aria-label="แจ้งปัญหาระบบ"
        style={
          reducedMotion
            ? undefined
            : { transform: `translate(${pos.current.x}px, ${pos.current.y}px)`, transition: hovering ? "transform 150ms ease-out" : undefined }
        }
        className={`fixed z-40 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--ink)] text-white shadow-lg hover:bg-[var(--ink)]/90 print:hidden ${
          reducedMotion ? "bottom-5 right-5" : "left-0 top-0"
        }`}
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
