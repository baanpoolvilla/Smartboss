"use client";

import { useMemo } from "react";
import { useReportFeedStore, type ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { getUser } from "@/modules/report_task/lib/directory";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { todayComplianceSummary } from "@/modules/report_task/lib/report-feed-compliance";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { cn } from "@/modules/report_task/lib/utils";
import { Bookmark, Clock, TriangleAlert } from "lucide-react";
import { TimeAgo } from "@/modules/report_task/components/shared/time-ago";

/** Today's compliance pills + the saved-posts popover — used to be its own
 * full-width `PageHeader` banner (title + subtitle + this row) sitting above
 * *both* the topic list and the room panel. That gave the room's own name a
 * second, redundant place to show (it's already the first line inside the
 * room panel itself) and cost the page a whole row of height it didn't need
 * to spend, on a page whose only job is showing posts ("อยากให้หน้ารีพอต
 * แสดงให้เต็มแผ่นไปเลย").
 *
 * Lands in the room panel's own identity row now, right next to the ⚙ gear
 * ("แถวหัวห้อง ข้างเกียร์ แบบมินิมอล" — asked for explicitly after the
 * sidebar placement got tried first and didn't read right). `variant="mini"`
 * is what makes that fit: no border/label/chip background, just an icon or
 * dot plus the bare number, the same plain-text-with-icon treatment the
 * member-count button next to it already uses, so it reads as one more fact
 * in that row instead of a second row of boxed chips competing with it. */
export function ReportComplianceBar({
  visibleTopics,
  onJumpToPost,
  onShowTodayStatus,
  variant = "full",
}: {
  visibleTopics: ReportTopic[];
  onJumpToPost: (topicId: string, postId: string) => void;
  /** Which pill was clicked — lands on the actual people behind that number
   * (see TodayStatusPanel in page.tsx), not a generic merged feed. */
  onShowTodayStatus: (status: "posted" | "late" | "missing") => void;
  variant?: "full" | "mini";
}) {
  const posts = useReportFeedStore((s) => s.posts);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const exemptions = useReportComplianceExemptions();
  const mini = variant === "mini";

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

  // Priority order when space is tight (mini, in the room header row): a
  // bare icon+number ("0/4 ⏰0 ⚠4") made people guess what each number even
  // was — showing the real word back, but only for the single most severe
  // non-zero status plus the always-relevant "sent" count, instead of all
  // three competing pills at once ("ไม่ต้องแสดงทุก Metric พร้อมกันถ้าไม่จำเป็น").
  const miniSecondary: "missing" | "late" | null = mini ? (summary.missingToday > 0 ? "missing" : summary.lateToday > 0 ? "late" : null) : null;

  return (
    <div className={cn("flex items-center", mini ? "gap-1" : "gap-1.5 flex-wrap")}>
      <CompliancePill
        mini={mini}
        dotColor="var(--chart-green)"
        label="ส่งแล้ว"
        value={`${summary.postedToday}/${summary.totalTracked}`}
        onClick={() => onShowTodayStatus("posted")}
      />
      {(!mini || miniSecondary === "late") && (
        <CompliancePill mini={mini} tone="warn" icon={Clock} label="ส่งช้า" value={`${summary.lateToday}`} onClick={() => onShowTodayStatus("late")} />
      )}
      {(!mini || miniSecondary === "missing") && (
        <CompliancePill mini={mini} tone="bad" icon={TriangleAlert} label="ยังไม่ส่ง" value={`${summary.missingToday}`} onClick={() => onShowTodayStatus("missing")} />
      )}
      <Popover>
        <PopoverTrigger
          render={
            <button
              className={cn(
                "inline-flex shrink-0 items-center gap-1 transition-colors",
                mini
                  ? "rounded-full px-1.5 py-0.5 text-xs text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]"
                  : "gap-1.5 rounded-full border border-[var(--line)] bg-white px-2.5 py-1 text-[11.5px] font-medium hover:bg-[var(--bg-soft)]"
              )}
              aria-label={`ข้อความที่บันทึกไว้ (${savedPosts.length})`}
              title="ข้อความที่บันทึกไว้"
            >
              <Bookmark className={cn(mini ? "h-3 w-3" : "h-3.5 w-3.5", "text-[var(--brand-green-dark)]")} />
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
                      {topic?.name ?? "หัวข้อที่ลบไปแล้ว"} · {author?.name} · <TimeAgo date={p.createdAt} />
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
  );
}

/* Quieter than they were: the tinted fill and colored border together made
   three small status chips compete with the room title next to them, on a page
   whose job is reading posts. The color now lives in the icon/dot and the
   count alone — enough to spot "ยังไม่ส่ง 4" at a glance, without the whole
   chip glowing. They stay clickable and keep their meaning; they just stop
   shouting. */
const pillToneStyles = {
  warn: { border: "border-[var(--line)]", bg: "bg-white", text: "text-[var(--chart-amber)]" },
  bad: { border: "border-[var(--line)]", bg: "bg-white", text: "text-[var(--chart-red)]" },
} as const;

/** Single-line chip — dot+label+bold count, same shape as the mockup's `.pill`
 * (`.pill.warn`/`.pill.bad` for the amber/red variants) — not a boxed KPI
 * card, which read as much heavier than the header row it sits in.
 *
 * `mini` drops the border, background and label text entirely — just the
 * dot/icon plus the bare number, colored, in the same plain hover-only
 * treatment as the member-count button next to it in the room header row. */
function CompliancePill({
  icon: Icon,
  dotColor,
  tone,
  label,
  value,
  onClick,
  mini,
}: {
  icon?: typeof Clock;
  dotColor?: string;
  tone?: keyof typeof pillToneStyles;
  label: string;
  value: string;
  onClick: () => void;
  mini?: boolean;
}) {
  const toneStyle = tone ? pillToneStyles[tone] : null;
  const title = `${label}: ${value} — ดูรายละเอียดใน ภาพรวมทั้งหมด`;

  if (mini) {
    return (
      <button
        onClick={onClick}
        title={title}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-xs whitespace-nowrap transition-colors hover:bg-[var(--bg-soft)]",
          toneStyle ? toneStyle.text : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
        )}
      >
        {dotColor && <span className="h-[6px] w-[6px] rounded-full shrink-0" style={{ backgroundColor: dotColor }} aria-hidden />}
        {Icon && <Icon className="h-3 w-3 shrink-0" />}
        {label} <b className="font-semibold tabular-nums">{value}</b>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium whitespace-nowrap transition-colors",
        "hover:bg-[var(--bg-soft)]",
        toneStyle ? cn(toneStyle.border, toneStyle.bg, toneStyle.text) : "border-[var(--line)] bg-white text-[var(--ink)]"
      )}
      title={title}
    >
      {dotColor && <span className="h-[7px] w-[7px] rounded-full shrink-0" style={{ backgroundColor: dotColor }} aria-hidden />}
      {Icon && <Icon className="h-3 w-3 shrink-0" />}
      {label} <b className="tabular-nums font-bold">{value}</b>
    </button>
  );
}
