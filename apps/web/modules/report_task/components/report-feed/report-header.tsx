"use client";

import { useMemo } from "react";
import { useReportFeedStore, type ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { getUser } from "@/modules/report_task/lib/directory";
import { PageHeader } from "@/modules/report_task/components/shared/page-header";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { todayComplianceSummary } from "@/modules/report_task/lib/report-feed-compliance";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { relativeTime } from "@/modules/report_task/lib/format";
import { cn } from "@/modules/report_task/lib/utils";
import { Bookmark, Clock, TriangleAlert } from "lucide-react";

/** Top-of-page banner: same `PageHeader` every other top-level page uses
 * (H1/H2 — was its own 32px "Report" title before, drifting from the rest
 * of the app), 3 actionable today-compliance pills instead of the old
 * StatsCard row (H3/H4 — "ทีมทั้งหมด 15 คน" was a vanity metric with nothing
 * to do with reporting), and the entry point into this viewer's saved
 * posts — "save this message" only did anything visible from here, there
 * was nowhere to actually see what you'd saved (matches Teams' profile-menu
 * "Saved"). */
export function ReportHeader({
  visibleTopics,
  onJumpToPost,
  onShowTodayStatus,
  roomLabel,
}: {
  visibleTopics: ReportTopic[];
  onJumpToPost: (topicId: string, postId: string) => void;
  /** Which pill was clicked — lands on the actual people behind that number
   * (see TodayStatusPanel in page.tsx), not a generic merged feed. */
  onShowTodayStatus: (status: "posted" | "late" | "missing") => void;
  /** Name of the room/view currently open (a real topic's name, or one of
   * the pinned merged views like "ภาพรวมทั้งหมด") — the title used to read
   * a flat "รายงาน" no matter which room you were actually in, which on
   * desktop (mobile at least had it in the "☰ หัวข้อ — ชื่อห้อง" button
   * label) left no way to tell what page you were looking at from the
   * header alone. undefined/null on first load before anything's picked. */
  roomLabel?: string | null;
}) {
  const posts = useReportFeedStore((s) => s.posts);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const exemptions = useReportComplianceExemptions();

  const summary = useMemo(
    () => todayComplianceSummary(visibleTopics, posts, exemptions),
    [visibleTopics, posts, exemptions]
  );

  const savedPosts = useMemo(() => {
    const visibleIds = new Set(visibleTopics.map((t) => t.id));
    return posts
      .filter((p) => visibleIds.has(p.topicId) && p.savedBy.includes(viewingAsUserId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [posts, visibleTopics, viewingAsUserId]);

  return (
    <PageHeader
      title={
        roomLabel ? (
          <>
            รายงาน <span className="text-[var(--ink-soft)] font-normal">· {roomLabel}</span>
          </>
        ) : (
          "รายงาน"
        )
      }
      subtitle="โพสต์อัปเดต พูดคุย แลกเปลี่ยน และสรุปงานในทีม — เหมือนแชนแนลใน Teams"
      action={
        <div className="flex items-center gap-1.5 flex-wrap w-full sm:w-auto">
          <CompliancePill
            dotColor="var(--chart-green)"
            label="ส่งแล้ววันนี้"
            value={`${summary.postedToday}/${summary.totalTracked}`}
            onClick={() => onShowTodayStatus("posted")}
          />
          <CompliancePill tone="warn" icon={Clock} label="ส่งช้า" value={`${summary.lateToday}`} onClick={() => onShowTodayStatus("late")} />
          <CompliancePill tone="bad" icon={TriangleAlert} label="ยังไม่ส่ง" value={`${summary.missingToday}`} onClick={() => onShowTodayStatus("missing")} />
          <Popover>
            <PopoverTrigger
              render={
                <button
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-2.5 py-1 text-[11.5px] font-medium hover:bg-[var(--bg-soft)] transition-colors"
                  aria-label={`ข้อความที่บันทึกไว้ (${savedPosts.length})`}
                  title="ข้อความที่บันทึกไว้"
                >
                  <Bookmark className="h-3.5 w-3.5 text-[var(--brand-green-dark)]" />
                  <b className="tabular-nums font-bold">{savedPosts.length}</b>
                </button>
              }
            />
            <PopoverContent className="w-80 p-0" align="end">
              <div className="px-3.5 py-2.5 border-b border-[var(--line)]">
                <p className="text-xs font-semibold text-[var(--ink-soft)]">ข้อความที่บันทึกไว้</p>
              </div>
              {savedPosts.length === 0 ? (
                <p className="px-3.5 py-6 text-center text-xs text-[var(--ink-soft)]">ยังไม่ได้บันทึกโพสต์ไหนไว้</p>
              ) : (
                <div className="max-h-80 overflow-y-auto py-1">
                  {savedPosts.map((p) => {
                    const topic = visibleTopics.find((t) => t.id === p.topicId);
                    const author = getUser(p.authorId);
                    return (
                      <button
                        key={p.id}
                        onClick={() => onJumpToPost(p.topicId, p.id)}
                        className="w-full text-left px-3.5 py-2.5 hover:bg-[var(--bg-soft)] transition-colors"
                      >
                        <p className="text-xs text-[var(--ink-soft)] truncate">
                          {topic?.name ?? "หัวข้อที่ลบไปแล้ว"} · {author?.name} · {relativeTime(p.createdAt)}
                        </p>
                        <p className="text-sm font-medium truncate">{p.title}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
      }
    />
  );
}

const pillToneStyles = {
  warn: { border: "border-[var(--chart-amber)]/40", bg: "bg-[color-mix(in_srgb,var(--chart-amber)_10%,white)]", text: "text-[var(--chart-amber)]" },
  bad: { border: "border-[var(--chart-red)]/40", bg: "bg-[color-mix(in_srgb,var(--chart-red)_8%,white)]", text: "text-[var(--chart-red)]" },
} as const;

/** Single-line chip — dot+label+bold count, same shape as the mockup's `.pill`
 * (`.pill.warn`/`.pill.bad` for the amber/red variants) — not a boxed KPI
 * card, which read as much heavier than the header row it sits in. */
function CompliancePill({
  icon: Icon,
  dotColor,
  tone,
  label,
  value,
  onClick,
}: {
  icon?: typeof Clock;
  dotColor?: string;
  tone?: keyof typeof pillToneStyles;
  label: string;
  value: string;
  onClick: () => void;
}) {
  const toneStyle = tone ? pillToneStyles[tone] : null;
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium whitespace-nowrap transition-colors",
        toneStyle ? cn(toneStyle.border, toneStyle.bg, toneStyle.text) : "border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[var(--bg-soft)]"
      )}
      title={`${label}: ${value} — ดูรายละเอียดใน ภาพรวมทั้งหมด`}
    >
      {dotColor && <span className="h-[7px] w-[7px] rounded-full shrink-0" style={{ backgroundColor: dotColor }} aria-hidden />}
      {Icon && <Icon className="h-3 w-3 shrink-0" />}
      {label} <b className="tabular-nums font-bold">{value}</b>
    </button>
  );
}
