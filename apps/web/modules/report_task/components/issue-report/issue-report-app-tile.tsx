"use client";

import { useState } from "react";
import { Bug } from "lucide-react";
import { IssueReportDialog } from "./issue-report-dialog";

/**
 * Fixed home-screen tile for "แจ้งปัญหาระบบ" — added alongside the roaming
 * bug FAB (report-issue-fab.tsx), not instead of it: the FAB covers "from
 * whatever page the problem actually happened on", this covers "I know
 * exactly where to find it" the same way every other app tile does.
 *
 * Not module-gated like the tiles above it (MODULE_CARDS/nav.modules) —
 * reporting an issue isn't itself a licensed module, it's always available,
 * so this renders unconditionally rather than going through that list.
 */
export function IssueReportAppTile() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="แจ้งปัญหาที่พบเจอในระบบ"
        className="group flex flex-col items-center rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/40"
      >
        <span
          className="relative flex h-[68px] w-[68px] items-center justify-center rounded-[22px] shadow-(--shadow-card) ring-1 ring-black/[0.04] transition-transform duration-150 group-hover:-translate-y-0.5 group-active:scale-95 sm:h-[76px] sm:w-[76px]"
          style={{ backgroundColor: "var(--danger-bg)" }}
        >
          <Bug className="h-8 w-8 sm:h-9 sm:w-9" style={{ color: "var(--danger)" }} />
        </span>
        <span className="mt-2 line-clamp-2 text-center text-[13px] font-medium text-(--ink)">
          แจ้งบัค
        </span>
      </button>
      <IssueReportDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
