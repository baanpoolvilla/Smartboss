"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ReportCard } from "@/modules/report_task/components/report-feed/report-card";
import { DaySeparator } from "@/modules/report_task/components/report-feed/report-day-separator";
import { DatePresetPicker } from "@/modules/report_task/components/report-analytics/date-preset-picker";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/modules/report_task/components/ui/dropdown-menu";
import { presetRange } from "@/modules/report_task/lib/date-filter";
import { groupByDay } from "@/modules/report_task/lib/format";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { Rows3, Tag } from "lucide-react";

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
  title = "ภาพรวมทั้งหมด",
  description = "โพสต์จากทุกหัวข้อที่เห็นได้ เรียงตามเวลา ล่าสุดอยู่ล่างสุด",
  icon: Icon = Rows3,
  emptyTitle = "ไม่มีโพสต์ในช่วงเวลานี้",
  emptyDescription = "ลองปรับตัวกรองวันที่ด้านบน หรือเลือก \"ทั้งหมด\"",
}: {
  /** Already permission-filtered — see useVisibleReportTopics/visibleTopics in the caller. */
  topics: ReportTopic[];
  /** Already scoped to whatever this view means — the full merged feed for
   * "ภาพรวมทั้งหมด", or a pre-filtered subset for a view like "ที่กล่าวถึงฉัน"
   * (see topic-sidebar.tsx's MENTIONS_ID). */
  posts: ReportPost[];
  onJumpToTopic: (topicId: string) => void;
  title?: string;
  description?: string;
  icon?: typeof Rows3;
  emptyTitle?: string;
  emptyDescription?: string;
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

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 px-5 pt-3.5 pb-2.5 flex items-center gap-2.5 flex-wrap justify-between border-b border-[var(--line)]">
        <div className="flex items-center gap-2.5">
          <span className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--brand-green-dark)]">
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-[16px] font-semibold leading-tight">{title}</h2>
            <p className="text-xs text-[var(--ink-soft)] leading-tight">{description}</p>
          </div>
        </div>
      </div>

      {/* Its own strip under the room header, not crammed into it (V2) —
          a card-inside-a-card was two header rows stacked on top of each other. */}
      <div className="shrink-0 px-5 py-2.5 flex items-center gap-2.5 flex-wrap bg-[var(--bg-soft)] border-b border-[var(--line)]">
        <DatePresetPicker
          variant="inline"
          preset={preset}
          customFrom={customFrom}
          customTo={customTo}
          onPresetChange={setPreset}
          onCustomRangeChange={(from, to) => {
            setCustomFrom(from);
            setCustomTo(to);
          }}
        />
        <div className="h-6 w-px bg-[var(--line)]" />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-white transition-colors">
                <Tag className="h-3.5 w-3.5" />
                {topicFilter.size === 0 ? "ทุกหัวข้อ" : `${topicFilter.size} หัวข้อ`}
              </button>
            }
          />
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            <DropdownMenuGroup>
              <DropdownMenuLabel>กรองตามหัวข้อ</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {topicFilter.size > 0 && (
                <button
                  onClick={() => setTopicFilter(new Set())}
                  className="w-full text-left px-2 py-1.5 text-xs font-medium text-[var(--brand-green-dark)] hover:underline"
                >
                  ล้างตัวกรอง
                </button>
              )}
              {topics.map((t) => (
                <DropdownMenuCheckboxItem key={t.id} checked={topicFilter.has(t.id)} onCheckedChange={() => toggleTopicFilter(t.id)}>
                  {breadcrumbOf(t, topicById)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
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
          className="flex-1 overflow-y-auto bg-[var(--bg-soft)]/40 px-5 py-5 space-y-5 scroll-pt-4"
        >
          {groupByDay(items, (p) => p.createdAt).map((group) => (
            <div key={group.key} className="space-y-5">
              <DaySeparator label={group.label} />
              {group.items.map((p) => {
                const topic = topicById.get(p.topicId)!;
                return (
                  <ReportCard
                    key={p.id}
                    post={p}
                    topic={topic}
                    topicBadge={{ label: breadcrumbOf(topic, topicById), onClick: () => onJumpToTopic(topic.id) }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
