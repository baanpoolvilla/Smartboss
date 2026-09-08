"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ReportCard } from "@/modules/report_task/components/report-feed/report-card";
import { DaySeparator } from "@/modules/report_task/components/report-feed/report-day-separator";
import { reportDayLabel } from "@/modules/report_task/components/report-feed/report-day-label";
import { DatePresetPicker } from "@/modules/report_task/components/report-analytics/date-preset-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { Checkbox } from "@/modules/report_task/components/ui/checkbox";
import { filterFieldTriggerClass } from "@/modules/report_task/components/shared/filter-field";
import { cn } from "@/modules/report_task/lib/utils";
import { presetRange } from "@/modules/report_task/lib/date-filter";
import { groupByDay } from "@/modules/report_task/lib/format";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { Rows3, SlidersHorizontal } from "lucide-react";

/** "ทีมพัฒนา › เช็คอินประจำวัน" — a sub-topic's name alone was ambiguous once
 * several teams reuse the same channel name (V3). Top-level topics have no
 * parent, so they're just their own name. */
function breadcrumbOf(topic: ReportTopic, topicById: Map<string, ReportTopic>): string {
  const parent = topic.parentId ? topicById.get(topic.parentId) : undefined;
  return parent ? `${parent.name} › ${topic.name}` : topic.name;
}

/**
 * "ภาพรวมทั้งหมด" — every post from every topic the viewer can see, merged
 * into one feed, oldest first with the newest at the bottom (same reading
 * order as a single room's own feed), each one tagged with which topic it
 * came from since that context isn't implicit here the way it is inside a
 * single room's own feed. Same DatePresetPicker used by the Task/Report
 * analytics tabs, kept as local state here (own filter, not shared with any
 * other page) rather than yet another global filter store.
 */
export function ReportAllPostsFeed({
  topics,
  posts,
  onJumpToTopic,
  onOpenTask,
  title = "ภาพรวมทั้งหมด",
  description = "โพสต์จากทุกหัวข้อที่เห็นได้ เรียงตามเวลา ล่าสุดอยู่ล่างสุด",
  icon: Icon = Rows3,
  emptyTitle = "ไม่มีโพสต์ในช่วงเวลานี้",
  emptyDescription = "ลองปรับตัวกรองวันที่ด้านบน หรือเลือก \"ทั้งหมด\"",
  showFilters = true,
  headerRight,
}: {
  /** Already permission-filtered — see useVisibleReportTopics/visibleTopics in the caller. */
  topics: ReportTopic[];
  /** Already scoped to whatever this view means — the full merged feed for
   * "ภาพรวมทั้งหมด", or a pre-filtered subset for a view like "ที่กล่าวถึงฉัน"
   * (see topic-sidebar.tsx's MENTIONS_ID). */
  posts: ReportPost[];
  onJumpToTopic: (topicId: string) => void;
  onOpenTask?: (taskId: string) => void;
  title?: string;
  description?: string;
  icon?: typeof Rows3;
  emptyTitle?: string;
  emptyDescription?: string;
  /** ซ่อนแถบตัวกรอง (ช่วงเวลา/หัวข้อ) ทั้งแถบ — สำหรับมุมมองที่กรองมาให้แล้ว
   * โดยธรรมชาติ (เช่น "กล่าวถึงฉัน" ที่จำกัดเฉพาะโพสต์ที่แท็กผู้ดูอยู่แล้ว)
   * ซึ่งตัวกรองช่วงเวลา/หัวข้อเพิ่มเติมแทบไม่มีประโยชน์ ค่าเริ่มต้น true
   * (คงพฤติกรรมเดิมของ "ภาพรวมทั้งหมด" ที่ยังจำเป็นต้องกรองอยู่). */
  showFilters?: boolean;
  /** Rendered right-aligned on the title row itself — page.tsx uses this for
   * the "กลับไป # ห้อง" button + ReportViewSwitcher, which used to sit on
   * their own dedicated row above this whole component and ate a full extra
   * line by itself regardless of screen size ("มุมมองกินพื้นที่ไปบรรทัดนึง
   * เยอะเกินไป เอาจับมาอยู่ด้วยเลย"). */
  headerRight?: React.ReactNode;
}) {
  const [preset, setPreset] = useState<Parameters<typeof presetRange>[0]>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const range = presetRange(preset, customFrom, customTo);
  // Empty = "ทุกหัวข้อ" (no filter applied), same convention as every other
  // multi-select filter in the app (V6).
  const [topicFilter, setTopicFilter] = useState<Set<string>>(new Set());

  const topicById = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);
  const items = posts
    .filter((p) => topicById.has(p.topicId))
    .filter((p) => topicFilter.size === 0 || topicFilter.has(p.topicId))
    .filter((p) => {
      if (!range) return true;
      const t = new Date(p.createdAt).getTime();
      return t >= range.from.getTime() && t <= range.to.getTime();
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  function toggleTopicFilter(id: string) {
    setTopicFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const scrollRef = useRef<HTMLDivElement>(null);
  // Lands on the newest post (bottom of the list) on open, same as a single
  // room's feed — otherwise "newest at the bottom" would mean opening this
  // view always shows the oldest post in the whole company first. Re-runs
  // whenever the filtered set changes size so switching presets also lands
  // on the newest post within that range, not wherever the scroll happened
  // to be left.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [items.length]);

  const activeFilterCount = (preset !== "all" ? 1 : 0) + (topicFilter.size > 0 ? 1 : 0);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* One title row, always — icon/title on the left, everything else
          (filter trigger, back button, "มุมมอง" switcher) as compact
          fixed-size controls on the right. Collapsing the old inline
          date-preset+topic-filter strip into a single "ตัวกรอง" button (whose
          panel opens in a popover) is what makes this reliably fit one line
          at every width — the previous horizontally-scrolling strip read as
          broken in the real deployed app: it could render mid-scrolled with
          both edges cut off, and the title row still wrapped/overflowed
          alongside it ("ดูดิเละเทะหมดเลย"). A single button never wraps. */}
      <div className="shrink-0 px-3 sm:px-5 py-2.5 flex items-center gap-2 border-b border-[var(--line)]">
        <span className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--brand-green-dark)]">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] sm:text-[16px] font-semibold leading-tight truncate">{title}</h2>
          <p className="hidden md:block text-xs text-[var(--ink-soft)] leading-tight truncate">{description}</p>
        </div>
        {showFilters && (
          <Popover>
            <PopoverTrigger
              render={
                <button className={cn(filterFieldTriggerClass(activeFilterCount > 0), "shrink-0 !h-9 px-2.5 sm:px-3")}>
                  <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden sm:inline">ตัวกรอง</span>
                  {activeFilterCount > 0 && <span className="tabular-nums">({activeFilterCount})</span>}
                </button>
              }
            />
            <PopoverContent align="end" className="w-[300px] max-h-[75vh] overflow-y-auto p-3">
              <div className="flex items-center justify-between px-0.5 pb-2">
                <p className="text-sm font-semibold">ตัวกรอง</p>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setPreset("all");
                      setTopicFilter(new Set());
                    }}
                    className="text-xs font-medium text-[var(--brand-green-dark)] hover:underline"
                  >
                    ล้างตัวกรอง
                  </button>
                )}
              </div>
              <p className="mb-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">ช่วงเวลา</p>
              <DatePresetPicker
                variant="inline"
                hideClearButton
                preset={preset}
                customFrom={customFrom}
                customTo={customTo}
                onPresetChange={setPreset}
                onCustomRangeChange={(from, to) => {
                  setCustomFrom(from);
                  setCustomTo(to);
                }}
              />
              <p className="mt-3 mb-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">หัวข้อ</p>
              <div className="flex flex-col gap-0.5">
                {topics.map((t) => (
                  <label
                    key={t.id}
                    className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-sm hover:bg-[var(--bg-soft)]"
                  >
                    <Checkbox checked={topicFilter.has(t.id)} onCheckedChange={() => toggleTopicFilter(t.id)} />
                    <span className="truncate">{breadcrumbOf(t, topicById)}</span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
        {headerRight && <div className="shrink-0 flex items-center gap-1">{headerRight}</div>}
      </div>

      {items.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6 bg-[var(--bg-soft)]/40">
          <div className="h-14 w-14 rounded-full bg-[var(--accent)] flex items-center justify-center">
            <Icon className="h-6 w-6 text-[var(--brand-green-dark)]" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">{emptyTitle}</p>
            <p className="text-xs text-[var(--ink-soft)]">{emptyDescription}</p>
          </div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto bg-[var(--bg-soft)] py-3 scroll-pt-4"
        >
          {/* Full width, not capped — see report-feed.tsx's own comment on
              this exact idea being tried and reverted again this same round.
              Tinted ground + space-y-3 between cards, same as report-feed.tsx
              — each post is its own bordered card now, not a flat row. */}
          <div className="space-y-6 px-2 sm:px-3">
            {groupByDay(items, (p) => p.createdAt).map((group) => (
              <div key={group.key} className="space-y-3">
                <DaySeparator label={reportDayLabel(group.label)} />
                {group.items.map((p) => {
                  const topic = topicById.get(p.topicId)!;
                  return (
                    <ReportCard
                      key={p.id}
                      post={p}
                      topic={topic}
                      topicBadge={{ label: breadcrumbOf(topic, topicById), onClick: () => onJumpToTopic(topic.id) }}
                      onOpenTask={onOpenTask}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
