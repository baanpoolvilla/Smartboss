"use client";

import { useMemo } from "react";
import { useReportFeedStore, type ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { getUser } from "@/modules/report_task/data/mock";
import { PageHeader } from "@/modules/report_task/components/shared/page-header";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { todayComplianceSummary } from "@/modules/report_task/lib/report-feed-compliance";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { chartColors } from "@/modules/report_task/lib/chart-colors";
import { relativeTime } from "@/modules/report_task/lib/format";
import { cn } from "@/modules/report_task/lib/utils";
import { Bookmark, CheckCircle2, Clock, TriangleAlert } from "lucide-react";

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
  onShowOverview,
}: {
  visibleTopics: ReportTopic[];
  onJumpToPost: (topicId: string, postId: string) => void;
  /** A pill click doesn't have a specific room to jump into (it's a
   * cross-room today snapshot) — lands on ภาพรวมทั้งหมด instead, the closest
   * existing view to "show me what this number means." */
  onShowOverview: () => void;
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
      title="รายงาน · Report"
      subtitle="โพสต์อัปเดต พูดคุย แลกเปลี่ยน และสรุปงานในทีม — เหมือนแชนแนลใน Teams"
      action={
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <CompliancePill
            icon={CheckCircle2}
            color="var(--brand-green-dark)"
            label="ส่งแล้ววันนี้"
            value={`${summary.postedToday}/${summary.totalTracked}`}
            onClick={onShowOverview}
          />
          <CompliancePill icon={Clock} color={chartColors.amber} label="ส่งช้า" value={`${summary.lateToday}`} onClick={onShowOverview} />
          <CompliancePill
            icon={TriangleAlert}
            color="var(--chart-red)"
            label="ยังไม่ส่ง"
            value={`${summary.missingToday}`}
            onClick={onShowOverview}
          />
          <Popover>
            <PopoverTrigger
              render={
                <button
                  className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-white hover:border-[var(--brand-green)]/40 transition-colors"
                  aria-label={`ข้อความที่บันทึกไว้ (${savedPosts.length})`}
                  title="ข้อความที่บันทึกไว้"
                >
                  <Bookmark className="h-4 w-4 text-[var(--brand-green-dark)]" />
                  {savedPosts.length > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 min-w-4 px-0.5 rounded-full bg-[var(--brand-green)] text-[10px] font-semibold text-[var(--ink)] flex items-center justify-center tabular-nums">
                      {savedPosts.length}
                    </span>
                  )}
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

function CompliancePill({
  icon: Icon,
  color,
  label,
  value,
  onClick,
}: {
  icon: typeof CheckCircle2;
  color: string;
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2 hover:border-[var(--brand-green)]/40 hover:bg-[var(--bg-soft)] transition-colors text-left"
      )}
      title={`${label}: ${value} — ดูรายละเอียดใน ภาพรวมทั้งหมด`}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, white)` }}>
        <Icon className="h-3.5 w-3.5" style={{ color }} />
      </span>
      <span className="leading-tight">
        <span className="block text-[13px] font-semibold tabular-nums">{value}</span>
        <span className="block text-[10px] text-[var(--ink-soft)] whitespace-nowrap">{label}</span>
      </span>
    </button>
  );
}
