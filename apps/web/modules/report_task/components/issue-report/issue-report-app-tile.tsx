import Link from "next/link";
import { Bug } from "lucide-react";

/**
 * Fixed home-screen tile for "แจ้งปัญหาระบบ" — added alongside the AppBar
 * icon (issue-report-bar-button.tsx), not instead of it: the AppBar one
 * covers "from whatever page the problem actually happened on" (that
 * button is on every module's AppBar), this covers "I know exactly where
 * to find it" the same way every other app tile does — the home screen
 * itself doesn't use that shared AppBar, so it wouldn't otherwise have one.
 *
 * Links straight into the list of what this company has already reported
 * (/report-task/issue-reports), not the "new report" dialog — every other
 * home tile opens a page, not a form, and popping the dialog immediately
 * on click meant there was no way to reach "what have we sent in, and is
 * it fixed yet" from the home screen at all
 * ("กดแล้วทำไมขึ้นแบบนี้...ไม่ได้รวมที่แจ้งไว้ที่นี้หรอของบริษัทนั้นๆ").
 * Filing a new one is still one click away — the list page's own "แจ้ง
 * ปัญหาใหม่" button opens the same dialog.
 *
 * Not module-gated like the tiles above it (MODULE_CARDS/nav.modules) —
 * reporting an issue isn't itself a licensed module, it's always available,
 * so this renders unconditionally rather than going through that list.
 */
export function IssueReportAppTile() {
  return (
    <Link
      href="/report-task/issue-reports"
      title="ดูเรื่องที่แจ้งไว้ / แจ้งปัญหาที่พบเจอในระบบ"
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
    </Link>
  );
}
