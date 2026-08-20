"use client";

import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import type { ReportTag } from "@/modules/report_task/store/report-tag-store";
import { displayName } from "@/modules/report_task/lib/directory";
import { lateCutoffFor } from "@/modules/report_task/lib/report-cutoff";
import { cn } from "@/modules/report_task/lib/utils";
import { Button } from "@/modules/report_task/components/ui/button";
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
import { Bookmark, Image as ImageIcon, Tag as TagIcon, TriangleAlert, User, X } from "lucide-react";

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
  opts: { topicOf: (post: ReportPost) => ReportTopic | undefined; viewingAsUserId: string }
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
      const topic = opts.topicOf(p);
      if (!topic || !lateCutoffFor(p.createdAt, topic.cutoffs)) return false;
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
}: {
  filters: PostFilters;
  onChange: (next: PostFilters) => void;
  /** Who to offer in the "ผู้โพสต์" multi-select — topicMembers for a single room, all visible authors for ภาพรวมทั้งหมด. */
  authorOptions: string[];
  /** The full curated tag list (see report-tag-store.ts) — org-wide, not scoped per room, since tags are a shared vocabulary rather than something each room accrues on its own. */
  tagOptions: ReportTag[];
}) {
  const activeCount = postFiltersActiveCount(filters);

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
    <div className="flex items-center gap-1.5 flex-wrap">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                filters.authorIds.size > 0
                  ? "border-[var(--brand-green)]/40 bg-[var(--accent)] text-[var(--brand-green-dark)]"
                  : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
              )}
            >
              <User className="h-3 w-3" />
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
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  filters.tagIds.size > 0
                    ? "border-[var(--brand-green)]/40 bg-[var(--accent)] text-[var(--brand-green-dark)]"
                    : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
                )}
              >
                <TagIcon className="h-3 w-3" />
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
      />
      <FilterChip
        icon={() => <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
        label="ยังไม่อ่าน"
        active={filters.unreadOnly}
        onClick={() => onChange({ ...filters, unreadOnly: !filters.unreadOnly })}
      />
      <FilterChip
        icon={ImageIcon}
        label="มีรูป"
        active={filters.hasImageOnly}
        onClick={() => onChange({ ...filters, hasImageOnly: !filters.hasImageOnly })}
      />
      <FilterChip
        icon={Bookmark}
        label="บันทึกไว้"
        active={filters.savedOnly}
        onClick={() => onChange({ ...filters, savedOnly: !filters.savedOnly })}
      />

      {activeCount > 0 && (
        <Button variant="ghost" size="sm" className="h-7 text-xs text-[var(--ink-soft)]" onClick={() => onChange(emptyPostFilters)}>
          <X className="h-3 w-3" />
          ล้างตัวกรอง ({activeCount})
        </Button>
      )}
    </div>
  );
}

function FilterChip({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-[var(--brand-green)]/40 bg-[var(--accent)] text-[var(--brand-green-dark)]"
          : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}
