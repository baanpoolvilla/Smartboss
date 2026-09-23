"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { Rows3, SlidersHorizontal, ChevronRight } from "lucide-react";

/** ขนาดชุดที่กางต่อครั้ง — ตรงกับฟีดของห้องเดี่ยว (report-feed.tsx) ให้ความรู้สึกเหมือนกัน */
const PAGE_SIZE = 25;
const LOAD_OLDER_PX = 400;

/** "ทีมพัฒนา › รายวัน › รายสัปดาห์" — walks the full parentId chain, not just
 * one hop, now that a sub-topic can itself have sub-topics (up to 3 tiers —
 * see topic-sidebar.tsx's topicDepth). A sub-topic's name alone was
 * ambiguous once several teams reuse the same channel name (V3). Top-level
 * topics have no parent, so they're just their own name. */
function breadcrumbOf(topic: ReportTopic, topicById: Map<string, ReportTopic>): string {
  const chain: string[] = [topic.name];
  let cur = topic;
  while (cur.parentId) {
    const parent = topicById.get(cur.parentId);
    if (!parent) break;
    chain.unshift(parent.name);
    cur = parent;
  }
  return chain.join(" › ");
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
  // Groups the topic-filter checklist by root room (GL Chats, BPV Chats,
  // ...) instead of one long flat list repeating "GL Chats › a-talk-gl" on
  // every row. Buckets by the ROOT ancestor, not just the immediate parent —
  // a sub-topic can itself have sub-topics now (3 tiers, see topic-sidebar.tsx's
  // topicDepth), and a 3rd-tier topic still needs to show up under its actual
  // top-level room here, not vanish because its own parent (a sub-topic, not
  // a root) never gets treated as a group key. Every descendant renders as
  // one flat indented list under the root either way — this checklist never
  // distinguished tier 1 from tier 2 rows visually, so a 3rd tier doesn't
  // either. A sub-topic whose parent isn't in `topics` (visible to this
  // viewer but its parent isn't, same edge case topic-sidebar.tsx handles)
  // falls back to rendering as its own top-level group of one.
  const topicGroups = useMemo(() => {
    function rootOf(t: ReportTopic): ReportTopic {
      let cur = t;
      while (cur.parentId) {
        const parent = topicById.get(cur.parentId);
        if (!parent) break;
        cur = parent;
      }
      return cur;
    }
    const childrenByRoot = new Map<string, ReportTopic[]>();
    for (const t of topics) {
      if (!t.parentId) continue;
      const root = rootOf(t);
      if (root.id === t.id) continue; // its own parent chain is broken — it's a root of one, handled below
      const arr = childrenByRoot.get(root.id) ?? [];
      arr.push(t);
      childrenByRoot.set(root.id, arr);
    }
    return topics
      .filter((t) => !t.parentId || !topicById.has(t.parentId))
      .map((parent) => ({
        parent,
        children: (childrenByRoot.get(parent.id) ?? []).sort((a, b) => a.name.localeCompare(b.name, "th")),
      }));
  }, [topics, topicById]);
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

  // Which parent groups are collapsed in the topic-filter checklist — starts
  // all-expanded, same default topic-sidebar.tsx uses, so a first look at the
  // filter panel shows the full tree rather than everything folded away.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  function toggleGroupCollapsed(id: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // เรนเดอร์ทีละชุดเหมือนฟีดของห้องเดี่ยว (report-feed.tsx) — มุมมองนี้หนักกว่า
  // ด้วยซ้ำ เพราะรวมโพสต์ของ "ทุกห้องทั้งบริษัท" ไว้ในลิสต์เดียว ยิ่งใช้ไปนาน ๆ
  // ยิ่งโต ถ้ากางทั้งหมดทีเดียวหน้าจะค้างตอนเปิดเหมือนที่เคยเจอในห้อง Daily-report
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [countedLength, setCountedLength] = useState(items.length);
  if (items.length !== countedLength) {
    // โพสต์ใหม่เข้ามา → ขยายหน้าต่างตาม ขอบบนจะได้ไม่เลื่อนหนีสิ่งที่กำลังอ่าน
    // ลิสต์หดเยอะ (เปลี่ยนตัวกรอง/ช่วงเวลา) → เริ่มนับชุดใหม่จากล่าสุด
    if (items.length > countedLength) setVisibleCount((c) => c + (items.length - countedLength));
    else if (countedLength - items.length > PAGE_SIZE) setVisibleCount(PAGE_SIZE);
    setCountedLength(items.length);
  }
  const olderCount = Math.max(0, items.length - visibleCount);
  const visibleItems = olderCount > 0 ? items.slice(olderCount) : items;

  const scrollRef = useRef<HTMLDivElement>(null);

  // ต่อชุดเก่าแล้วเนื้อหาด้านบนงอกขึ้นมา — จำระยะห่างจากก้นฟีดไว้ก่อน แล้วเลื่อน
  // กลับมาที่ระยะเดิมหลังวาดเสร็จ สายตาจึงค้างอยู่ที่โพสต์เดิม ไม่กระโดด
  const anchorFromBottomRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = anchorFromBottomRef.current;
    if (!el || anchor == null) return;
    el.scrollTop = el.scrollHeight - anchor;
    anchorFromBottomRef.current = null;
  }, [visibleCount]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop < LOAD_OLDER_PX && olderCount > 0 && anchorFromBottomRef.current == null) {
      anchorFromBottomRef.current = el.scrollHeight - el.scrollTop;
      setVisibleCount((n) => n + PAGE_SIZE);
    }
  }

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
        {/* headerRight (back-link + view switcher) before "ตัวกรอง" — reads
            left-to-right as "where you are, then how to narrow it down"
            instead of the filter button splitting the back-link away from
            the title it's next to ("สลับตำแหน่งกัน"). */}
        {headerRight && <div className="shrink-0 flex items-center gap-1">{headerRight}</div>}
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
              <div className="flex flex-col gap-1.5">
                {topicGroups.map(({ parent, children }) => {
                  const collapsed = collapsedGroups.has(parent.id);
                  return (
                    <div key={parent.id}>
                      <div className="flex items-center gap-1 rounded-lg hover:bg-[var(--bg-soft)]">
                        {children.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => toggleGroupCollapsed(parent.id)}
                            aria-label={collapsed ? `ขยาย ${parent.name}` : `ย่อ ${parent.name}`}
                            className="flex h-7 w-7 shrink-0 items-center justify-center text-[var(--ink-soft)] hover:text-[var(--ink)]"
                          >
                            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", !collapsed && "rotate-90")} />
                          </button>
                        ) : (
                          <span className="w-7 shrink-0" />
                        )}
                        <label className="flex flex-1 min-w-0 items-center gap-2.5 py-1.5 pr-1.5 text-sm font-semibold cursor-pointer">
                          <Checkbox checked={topicFilter.has(parent.id)} onCheckedChange={() => toggleTopicFilter(parent.id)} />
                          <span className="truncate">{parent.name}</span>
                        </label>
                      </div>
                      {children.length > 0 && !collapsed && (
                        <div className="flex flex-col gap-0.5 border-l border-[var(--line)] ml-3.5 pl-2.5">
                          {children.map((c) => (
                            <label
                              key={c.id}
                              className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-sm hover:bg-[var(--bg-soft)]"
                            >
                              <Checkbox checked={topicFilter.has(c.id)} onCheckedChange={() => toggleTopicFilter(c.id)} />
                              <span className="truncate">{c.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}
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
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto bg-[var(--bg-soft)] py-3 scroll-pt-4"
        >
          {/* Full width, not capped — see report-feed.tsx's own comment on
              this exact idea being tried and reverted again this same round.
              Tinted ground + space-y-3 between cards, same as report-feed.tsx
              — each post is its own bordered card now, not a flat row. */}
          <div className="space-y-6 px-2 sm:px-3">
            {olderCount > 0 && (
              <p className="py-2 text-center text-xs text-[var(--ink-soft)]">
                เลื่อนขึ้นเพื่อดูโพสต์เก่ากว่านี้ · เหลืออีก {olderCount} โพสต์
              </p>
            )}
            {groupByDay(visibleItems, (p) => p.createdAt).map((group) => (
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
