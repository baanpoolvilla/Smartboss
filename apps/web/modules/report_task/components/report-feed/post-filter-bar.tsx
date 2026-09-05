"use client";

import { useState } from "react";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import type { ReportTag } from "@/modules/report_task/store/report-tag-store";
import { displayName } from "@/modules/report_task/lib/directory";
import { lateCutoffFor } from "@/modules/report_task/lib/report-cutoff";
import { roundsForUserOnDay } from "@/modules/report_task/lib/submission-rounds";
import { isExemptDate, type DateExemptions } from "@/modules/report_task/lib/report-feed-exemptions";
import { localDateStr } from "@/modules/report_task/lib/now";
import type { SubmitterGroup } from "@/modules/report_task/store/report-feed-store";
import { cn } from "@/modules/report_task/lib/utils";
import { Button } from "@/modules/report_task/components/ui/button";
import { Checkbox } from "@/modules/report_task/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/modules/report_task/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { TagMultiSelectList } from "@/modules/report_task/components/report-feed/report-tag-multiselect";
import { Bookmark, ChevronDown, Image as ImageIcon, ListFilter, Search, Tag as TagIcon, TriangleAlert, User, X } from "lucide-react";

export interface PostFilters {
  authorIds: Set<string>;
  tagIds: Set<string>;
  lateOnly: boolean;
  unreadOnly: boolean;
  hasImageOnly: boolean;
  savedOnly: boolean;
}

export const emptyPostFilters: PostFilters = {
  authorIds: new Set(),
  tagIds: new Set(),
  lateOnly: false,
  unreadOnly: false,
  hasImageOnly: false,
  savedOnly: false,
};

export function postFiltersActiveCount(f: PostFilters): number {
  return f.authorIds.size + f.tagIds.size + Number(f.lateOnly) + Number(f.unreadOnly) + Number(f.hasImageOnly) + Number(f.savedOnly);
}

/** A post's own topic — needed for the ส่งช้า check, which is per-room
 * (each room has its own cutoffs). Callers with a single fixed topic (a
 * room's own feed) can pass a `() => topic` constant; ภาพรวมทั้งหมด looks it
 * up per post instead. */
export function filterPosts(
  posts: ReportPost[],
  filters: PostFilters,
  opts: {
    topicOf: (post: ReportPost) => ReportTopic | undefined;
    viewingAsUserId: string;
    submitterGroups: SubmitterGroup[];
    exemptions?: DateExemptions;
  }
): ReportPost[] {
  if (postFiltersActiveCount(filters) === 0) return posts;
  return posts.filter((p) => {
    if (filters.authorIds.size > 0 && !filters.authorIds.has(p.authorId)) return false;
    // OR across selected tags (matches ANY of them), same "narrow to these"
    // reading as the author filter above — a post picking one of several
    // selected tags is exactly the point of letting more than one be checked.
    if (filters.tagIds.size > 0 && !p.tagIds.some((id) => filters.tagIds.has(id))) return false;
    if (filters.unreadOnly && !p.unreadFor.includes(opts.viewingAsUserId)) return false;
    if (filters.hasImageOnly && p.images.length === 0) return false;
    if (filters.savedOnly && !p.savedBy.includes(opts.viewingAsUserId)) return false;
    if (filters.lateOnly) {
      // "ไม่นับเป็นการส่ง daily" posts never carry a ตรงเวลา/สาย badge on the
      // card (see report-card.tsx) — mirror that here so "ส่งช้า" can't
      // surface one anyway. Same for a poster who was exempt that day
      // (approved leave/day-off/holiday) — no real obligation, no badge.
      if (p.excludeFromSubmission) return false;
      if (opts.exemptions && isExemptDate(opts.exemptions, p.authorId, localDateStr(new Date(p.createdAt)))) return false;
      const topic = opts.topicOf(p);
      // Scoped to the post's own author (not "any cutoff was active"), same
      // reasoning as the on-time badge on the card itself — a round's
      // deadline only binds the people it names, so a post from someone
      // outside that list was never "late" to begin with.
      const dayCutoffs = topic ? roundsForUserOnDay(topic, p.authorId, localDateStr(new Date(p.createdAt)), opts.submitterGroups) : [];
      if (!topic || !lateCutoffFor(p.createdAt, dayCutoffs)) return false;
    }
    return true;
  });
}

/** Filter chip row (1.3) — ผู้โพสต์ / ส่งช้า / ยังไม่อ่าน / มีรูป / บันทึกไว้,
 * same shape whether it sits under a single room's tabs or ภาพรวมทั้งหมด's
 * own date/topic strip. */
export function PostFilterBar({
  filters,
  onChange,
  authorOptions,
  tagOptions,
  size = "sm",
}: {
  filters: PostFilters;
  onChange: (next: PostFilters) => void;
  /** Who to offer in the "ผู้โพสต์" multi-select — topicMembers for a single room, all visible authors for ภาพรวมทั้งหมด. */
  authorOptions: string[];
  /** The full curated tag list (see report-tag-store.ts) — org-wide, not scoped per room, since tags are a shared vocabulary rather than something each room accrues on its own. */
  tagOptions: ReportTag[];
  /** "lg" — bigger touch targets for the mobile filter sheet, where the same
   * tiny desktop-row chips (h-7-ish, text-xs) sat in a lot of empty space
   * and read as an unfinished, "ยังงงๆ" mobile adaptation rather than a
   * screen actually designed for a thumb. Default stays exactly as it was
   * for every existing (desktop-row) caller. */
  size?: "sm" | "lg";
}) {
  const activeCount = postFiltersActiveCount(filters);
  const chipSize = size === "lg" ? "gap-2 px-3.5 py-2.5 text-sm" : "gap-1.5 px-2.5 py-1 text-xs";
  const iconSize = size === "lg" ? "h-4 w-4" : "h-3 w-3";

  function toggleAuthor(id: string) {
    const next = new Set(filters.authorIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...filters, authorIds: next });
  }

  function toggleTag(id: string) {
    const next = new Set(filters.tagIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...filters, tagIds: next });
  }

  return (
    <div className={cn("flex items-center flex-wrap", size === "lg" ? "gap-2" : "gap-1.5")}>
      {/* Each chip already shows its own count/highlight, but on a narrow
          row that wraps to 2-3 lines the ones further along could scroll out
          of view — this small badge up front is the one thing always visible
          that says "N ตัวกรองกำลังทำงานอยู่" at a glance, same idea as the
          "(N)" badge report-all-posts-feed.tsx's own filter trigger already
          shows ("กรอง(N) ให้ชัดเจนในหน้าการ์ด"). */}
      {activeCount > 0 && (
        <span className="flex items-center gap-1 rounded-full bg-[var(--brand-green-dark)] px-2 py-1 text-[11px] font-semibold text-white tabular-nums shrink-0">
          กรองอยู่ {activeCount}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              className={cn(
                "flex items-center rounded-full border font-medium transition-colors",
                chipSize,
                filters.authorIds.size > 0
                  ? "border-[var(--brand-green)]/40 bg-[var(--accent)] text-[var(--brand-green-dark)]"
                  : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
              )}
            >
              <User className={iconSize} />
              {filters.authorIds.size === 0 ? "ทุกคน" : `${filters.authorIds.size} คน`}
            </button>
          }
        />
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          <DropdownMenuGroup>
            <DropdownMenuLabel>กรองตามผู้โพสต์</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {authorOptions.map((id) => (
              <DropdownMenuCheckboxItem key={id} checked={filters.authorIds.has(id)} onCheckedChange={() => toggleAuthor(id)}>
                {displayName(id)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {tagOptions.length > 0 && (
        <Popover>
          <PopoverTrigger
            render={
              <button
                className={cn(
                  "flex items-center rounded-full border font-medium transition-colors",
                  chipSize,
                  filters.tagIds.size > 0
                    ? "border-[var(--brand-green)]/40 bg-[var(--accent)] text-[var(--brand-green-dark)]"
                    : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                )}
              >
                <TagIcon className={iconSize} />
                {filters.tagIds.size === 0 ? "ทุกแท็ก" : `${filters.tagIds.size} แท็ก`}
              </button>
            }
          />
          {/* Same Popover + search-once-it's-worth-it list as TagPickerButton
              (see report-tag-multiselect.tsx) rather than the author filter's
              plain DropdownMenu — a scrolling checkbox list with no search is
              the exact thing that gets confusing once a company has a lot of
              tags, which is the point of picking a different widget here. */}
          <PopoverContent align="start" className="w-64 p-1.5">
            <p className="px-1.5 py-1 text-[11px] font-medium text-[var(--ink-soft)]">กรองตามแท็ก (เลือกได้หลายแท็ก)</p>
            <TagMultiSelectList tags={tagOptions} selectedIds={[...filters.tagIds]} onToggle={toggleTag} />
          </PopoverContent>
        </Popover>
      )}

      <FilterChip
        icon={TriangleAlert}
        label="ส่งช้า"
        active={filters.lateOnly}
        onClick={() => onChange({ ...filters, lateOnly: !filters.lateOnly })}
        chipSize={chipSize}
        iconSize={iconSize}
      />
      <FilterChip
        icon={() => <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
        label="ยังไม่อ่าน"
        active={filters.unreadOnly}
        onClick={() => onChange({ ...filters, unreadOnly: !filters.unreadOnly })}
        chipSize={chipSize}
        iconSize={iconSize}
      />
      <FilterChip
        icon={ImageIcon}
        label="มีรูป"
        active={filters.hasImageOnly}
        onClick={() => onChange({ ...filters, hasImageOnly: !filters.hasImageOnly })}
        chipSize={chipSize}
        iconSize={iconSize}
      />
      <FilterChip
        icon={Bookmark}
        label="บันทึกไว้"
        active={filters.savedOnly}
        onClick={() => onChange({ ...filters, savedOnly: !filters.savedOnly })}
        chipSize={chipSize}
        iconSize={iconSize}
      />

      {activeCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className={cn("text-[var(--ink-soft)]", size === "lg" ? "h-9 text-sm" : "h-7 text-xs")}
          onClick={() => onChange(emptyPostFilters)}
        >
          <X className={iconSize} />
          ล้างทั้งหมด ({activeCount})
        </Button>
      )}
    </div>
  );
}

/** Compact "ตัวกรอง N ▾" trigger + popover — same filters/onChange contract
 * as PostFilterBar above (no filtering logic duplicated, just a different
 * shell around it), for the desktop header row. Six always-visible pills
 * ("ทุกคน ทุกแท็ก ส่งช้า ยังไม่อ่าน มีรูป บันทึกไว้") ran into the tab row
 * next to it and dominated the header before any post was even on screen —
 * one button that opens a real popover with labeled sections reads as far
 * calmer, same idea Linear/Notion use for a room with more than 2-3 filter
 * dimensions. PostFilterBar itself is untouched and still backs the mobile
 * bottom sheet, which already has room for a full chip row. */
export function PostFilterButton({
  filters,
  onChange,
  authorOptions,
  tagOptions,
}: {
  filters: PostFilters;
  onChange: (next: PostFilters) => void;
  authorOptions: string[];
  tagOptions: ReportTag[];
}) {
  const activeCount = postFiltersActiveCount(filters);
  const [open, setOpen] = useState(false);
  const [authorQuery, setAuthorQuery] = useState("");
  const visibleAuthors = authorOptions.filter((id) => !authorQuery.trim() || displayName(id).toLowerCase().includes(authorQuery.trim().toLowerCase()));

  function toggleAuthor(id: string) {
    const next = new Set(filters.authorIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...filters, authorIds: next });
  }

  function toggleTag(id: string) {
    const next = new Set(filters.tagIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...filters, tagIds: next });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            className={cn(
              "flex h-[34px] items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors shrink-0",
              activeCount > 0
                ? "border-[var(--brand-green)]/40 bg-[var(--accent)] text-[var(--brand-green-dark)]"
                : "border-[var(--line)] bg-white text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
            )}
          >
            <ListFilter className="h-3.5 w-3.5" />
            กรอง
            {activeCount > 0 && <span className="tabular-nums">{activeCount}</span>}
            <ChevronDown className="h-3 w-3" />
          </button>
        }
      />
      <PopoverContent align="end" className="w-[320px] max-h-[70vh] overflow-y-auto p-0">
        <p className="px-3 pt-3 text-sm font-semibold">กรองโพสต์</p>
        <div className="p-3 space-y-4">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">ผู้โพสต์</p>
              {filters.authorIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, authorIds: new Set() })}
                  className="text-[11px] font-medium text-[var(--brand-green-dark)] hover:underline"
                >
                  ล้าง
                </button>
              )}
            </div>
            {/* Search once there's enough people to actually need it — same
                threshold idea TagMultiSelectList already uses for tags. A
                room whose member list scrolled past a tiny 128px box with no
                way to jump straight to a name was a big part of "ใช้งานยาก". */}
            {authorOptions.length > 6 && (
              <div className="relative mb-1.5">
                <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]" />
                <input
                  value={authorQuery}
                  onChange={(e) => setAuthorQuery(e.target.value)}
                  placeholder="ค้นหาผู้โพสต์..."
                  className="w-full rounded-md border border-[var(--line)] bg-transparent py-1.5 pl-7 pr-2 text-xs outline-none focus-visible:border-[var(--brand-green)]/50"
                />
              </div>
            )}
            <div className="max-h-44 overflow-y-auto space-y-0.5">
              {visibleAuthors.length === 0 ? (
                <p className="px-1.5 py-2 text-xs text-[var(--ink-soft)]">ไม่พบผู้โพสต์ที่ตรงกับ &quot;{authorQuery}&quot;</p>
              ) : (
                visibleAuthors.map((id) => (
                  <label key={id} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-[var(--bg-soft)] cursor-pointer text-sm">
                    <Checkbox checked={filters.authorIds.has(id)} onCheckedChange={() => toggleAuthor(id)} />
                    {displayName(id)}
                  </label>
                ))
              )}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)] mb-1.5">สถานะ</p>
            <div className="space-y-0.5">
              <label className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--bg-soft)] cursor-pointer text-sm">
                <Checkbox checked={filters.lateOnly} onCheckedChange={() => onChange({ ...filters, lateOnly: !filters.lateOnly })} />
                <TriangleAlert className="h-3.5 w-3.5 text-[var(--ink-soft)]" /> ส่งช้า
              </label>
              <label className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--bg-soft)] cursor-pointer text-sm">
                <Checkbox checked={filters.unreadOnly} onCheckedChange={() => onChange({ ...filters, unreadOnly: !filters.unreadOnly })} />
                <span className="h-2 w-2 rounded-full bg-[var(--ink-soft)]" /> ยังไม่อ่าน
              </label>
              <label className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--bg-soft)] cursor-pointer text-sm">
                <Checkbox checked={filters.hasImageOnly} onCheckedChange={() => onChange({ ...filters, hasImageOnly: !filters.hasImageOnly })} />
                <ImageIcon className="h-3.5 w-3.5 text-[var(--ink-soft)]" /> มีรูป
              </label>
              <label className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--bg-soft)] cursor-pointer text-sm">
                <Checkbox checked={filters.savedOnly} onCheckedChange={() => onChange({ ...filters, savedOnly: !filters.savedOnly })} />
                <Bookmark className="h-3.5 w-3.5 text-[var(--ink-soft)]" /> บันทึกไว้
              </label>
            </div>
          </div>

          {tagOptions.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)] mb-1.5">แท็ก</p>
              {/* A checkbox row here, not TagMultiSelectList's own
                  dot+button treatment (that one's shared with the post
                  composer's tag picker, a different context) — the plain
                  colored-dot button next to this popover's checkbox rows
                  above read as a different kind of control, not one more
                  filter to tick ("ใช้งานยากมาก"). Same checkbox everywhere
                  in this popover instead. */}
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {tagOptions.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-[var(--bg-soft)] cursor-pointer text-sm">
                    <Checkbox checked={filters.tagIds.has(t.id)} onCheckedChange={() => toggleTag(t.id)} />
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} aria-hidden />
                    <span className="truncate">{t.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] px-3 py-2">
          <Button variant="ghost" size="sm" className="text-xs text-[var(--ink-soft)]" disabled={activeCount === 0} onClick={() => onChange(emptyPostFilters)}>
            ล้างทั้งหมด
          </Button>
          <Button size="sm" className="text-xs" onClick={() => setOpen(false)}>
            ดูผลลัพธ์
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Small × chips under the tab row — only rendered once at least one filter
 * is active (see PostFilterButton above for where they're set), so a quiet
 * room never shows an empty strip. Same underlying filters/onChange, just a
 * quick way to drop one filter (or all of them) without reopening the
 * popover. */
export function ActiveFilterChips({
  filters,
  onChange,
  authorOptions,
}: {
  filters: PostFilters;
  onChange: (next: PostFilters) => void;
  authorOptions: string[];
}) {
  const activeCount = postFiltersActiveCount(filters);
  if (activeCount === 0) return null;

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filters.authorIds.size > 0) {
    chips.push({
      key: "authors",
      label: filters.authorIds.size === 1 ? displayName([...filters.authorIds][0]!) : `ผู้โพสต์ ${filters.authorIds.size} คน`,
      onRemove: () => onChange({ ...filters, authorIds: new Set() }),
    });
  }
  if (filters.tagIds.size > 0) {
    chips.push({ key: "tags", label: `${filters.tagIds.size} แท็ก`, onRemove: () => onChange({ ...filters, tagIds: new Set() }) });
  }
  if (filters.lateOnly) chips.push({ key: "late", label: "ส่งช้า", onRemove: () => onChange({ ...filters, lateOnly: false }) });
  if (filters.unreadOnly) chips.push({ key: "unread", label: "ยังไม่อ่าน", onRemove: () => onChange({ ...filters, unreadOnly: false }) });
  if (filters.hasImageOnly) chips.push({ key: "image", label: "มีรูป", onRemove: () => onChange({ ...filters, hasImageOnly: false }) });
  if (filters.savedOnly) chips.push({ key: "saved", label: "บันทึกไว้", onRemove: () => onChange({ ...filters, savedOnly: false }) });

  return (
    <div className="flex items-center flex-wrap gap-1.5">
      {chips.map((c) => (
        <span
          key={c.key}
          className="flex items-center gap-1 h-[26px] rounded-md bg-[var(--bg-soft)] pl-2 pr-1 text-[11px] font-medium text-[var(--ink-soft)]"
        >
          {c.label}
          <button onClick={c.onRemove} aria-label={`ลบตัวกรอง ${c.label}`} className="h-4 w-4 flex items-center justify-center rounded-full hover:bg-white hover:text-[var(--ink)]">
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <button onClick={() => onChange(emptyPostFilters)} className="h-[26px] px-1.5 text-[11px] font-medium text-[var(--brand-green-dark)] hover:underline">
        ล้างทั้งหมด
      </button>
    </div>
  );
}

function FilterChip({
  icon: Icon,
  label,
  active,
  onClick,
  chipSize,
  iconSize,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
  chipSize: string;
  iconSize: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center rounded-full border font-medium transition-colors",
        chipSize,
        active
          ? "border-[var(--brand-green)]/40 bg-[var(--accent)] text-[var(--brand-green-dark)]"
          : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
      )}
    >
      <Icon className={iconSize} />
      {label}
    </button>
  );
}
