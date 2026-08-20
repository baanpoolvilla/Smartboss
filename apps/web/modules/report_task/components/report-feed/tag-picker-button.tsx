"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { useReportTagStore } from "@/modules/report_task/store/report-tag-store";
import { cn } from "@/modules/report_task/lib/utils";
import { TagFormDialog } from "@/modules/report_task/components/report-feed/tag-form-dialog";
import { TagMultiSelectList } from "@/modules/report_task/components/report-feed/report-tag-multiselect";
import { Tag, TagIcon, ChevronDown, Plus } from "lucide-react";

/**
 * The tag-picker popover for the post composer/editor — multi-select
 * (unlike AlbumPickerButton's single choice, since a post can carry more
 * than one tag), same bordered-pill trigger + "create new..." footer shape
 * so it reads as a sibling of the album picker sitting right next to it.
 * The list itself (search once there's enough tags to need it, selected
 * tags pinned above the rest) is shared with PostFilterBar's tag filter via
 * TagMultiSelectList — see that file for why.
 */
export function TagPickerButton({ tagIds, onChange }: { tagIds: string[]; onChange: (tagIds: string[]) => void }) {
  const tags = useReportTagStore((s) => s.tags);
  const addTag = useReportTagStore((s) => s.addTag);
  const [open, setOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const selected = tags.filter((t) => tagIds.includes(t.id));
  const hasSelection = selected.length > 0;

  function toggle(id: string) {
    onChange(tagIds.includes(id) ? tagIds.filter((x) => x !== id) : [...tagIds, id]);
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors max-w-full",
                hasSelection
                  ? "border-[var(--brand-green)]/40 bg-[var(--accent)] text-[var(--brand-green-dark)]"
                  : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
              )}
              aria-label="ติดแท็กโพสต์นี้"
            >
              {hasSelection ? <TagIcon className="h-3.5 w-3.5 shrink-0" /> : <Tag className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{hasSelection ? selected.map((t) => t.name).join(", ") : "ติดแท็ก"}</span>
              <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
            </button>
          }
        />
        <PopoverContent align="start" className="w-64 p-1.5" onClick={(e) => e.stopPropagation()}>
          <p className="px-1.5 py-1 text-[11px] font-medium text-[var(--ink-soft)]">ติดแท็กให้โพสต์นี้ (เลือกได้หลายแท็ก)</p>
          <TagMultiSelectList
            tags={tags}
            selectedIds={tagIds}
            onToggle={toggle}
            emptyLabel="ยังไม่มีแท็ก — สร้างแท็กแรกด้านล่าง"
            footer={
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setCreateDialogOpen(true);
                }}
                className="w-full flex items-center gap-1.5 rounded-md px-1.5 py-1.5 mt-1.5 border-t border-[var(--line)] text-xs font-medium text-[var(--brand-green-dark)] hover:bg-[var(--accent)]"
              >
                <Plus className="h-3.5 w-3.5" />
                สร้างแท็กใหม่...
              </button>
            }
          />
        </PopoverContent>
      </Popover>
      <TagFormDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={(name, color) => onChange([...tagIds, addTag(name, color)])}
      />
    </>
  );
}
