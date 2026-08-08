"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { cn } from "@/modules/report_task/lib/utils";
import { AlbumFormDialog } from "@/modules/report_task/components/report-feed/album-form-dialog";
import { Bookmark, BookmarkCheck, FolderPlus, Check, ChevronDown, X } from "lucide-react";

/**
 * The album-picker popover — a bookmark-style icon overlaid on an image
 * thumbnail (post composer, reply composer, the "ไฟล์" gallery), or an
 * inline labeled button for picking one album for a whole post at once
 * (see `variant`). Same icon language as "บันทึกข้อความนี้" elsewhere in the
 * app (Bookmark/BookmarkCheck).
 */
export function AlbumPickerButton({
  topicId,
  imageName,
  albumId,
  onChange,
  size = "default",
  variant = "overlay",
}: {
  topicId: string;
  /** What's being labeled in aria-labels/prompts — one photo's name, or e.g. "ทุกรูปในโพสต์นี้" for the whole-post picker. */
  imageName: string;
  albumId: string | undefined;
  onChange: (albumId: string | undefined) => void;
  /** "default" (composer thumbnails, 20px) or "sm" (reply thumbnails, 16px) — only matters for variant="overlay". */
  size?: "default" | "sm";
  /** "overlay" = small circular icon meant to sit on top of a photo. "inline" = a bordered pill with a text label, for standalone placement (e.g. "picture this whole post into one album"). */
  variant?: "overlay" | "inline";
}) {
  const albums = useReportFeedStore((s) => s.albums).filter((a) => a.topicId === topicId);
  const addAlbum = useReportFeedStore((s) => s.addAlbum);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const [open, setOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const inAlbum = !!albumId;
  const currentAlbumName = albumId ? albums.find((a) => a.id === albumId)?.name : undefined;
  const btnSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const iconSize = size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3";

  function pick(id: string | undefined) {
    onChange(id);
    setOpen(false);
  }

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          variant === "inline" ? (
            <button
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                inAlbum
                  ? "border-[var(--brand-green)]/40 bg-[var(--accent)] text-[var(--brand-green-dark)]"
                  : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
              )}
              aria-label={`เก็บ${imageName}ลงอัลบั้ม`}
            >
              {inAlbum ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
              {currentAlbumName ?? "ไม่เก็บอัลบั้ม"}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          ) : (
            <button
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "shrink-0 flex items-center justify-center rounded-full transition-colors",
                btnSize,
                inAlbum ? "bg-[var(--brand-green)] text-[var(--ink)]" : "bg-black/60 text-white/80 hover:text-white"
              )}
              aria-label={inAlbum ? `จัดการอัลบั้มของรูป ${imageName}` : `เก็บรูป ${imageName} ลงอัลบั้ม`}
              title={inAlbum ? "อยู่ในอัลบั้ม (แตะเพื่อเปลี่ยน)" : "ดูแล้วทิ้ง — ไม่อยู่ในอัลบั้ม (แตะเพื่อเก็บ)"}
            >
              {inAlbum ? <BookmarkCheck className={iconSize} /> : <Bookmark className={iconSize} />}
            </button>
          )
        }
      />
      <PopoverContent align="start" className="w-56 p-1.5" onClick={(e) => e.stopPropagation()}>
        <p className="px-1.5 py-1 text-[11px] font-medium text-[var(--ink-soft)]">
          {variant === "inline" ? "เก็บรูปในโพสต์นี้ลงอัลบั้ม" : "เก็บรูปนี้ลงอัลบั้ม"}
        </p>
        <div className="max-h-40 overflow-y-auto space-y-0.5">
          <button
            onClick={() => pick(undefined)}
            className={cn(
              "w-full flex items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-xs text-left hover:bg-[var(--bg-soft)]",
              !albumId && "bg-[var(--accent)]"
            )}
          >
            <span className="flex items-center gap-1.5 text-[var(--ink-soft)]">
              <X className="h-3 w-3" /> ไม่เก็บอัลบั้ม
            </span>
            {!albumId && <Check className="h-3 w-3 text-[var(--brand-green-dark)]" />}
          </button>
          {albums.map((a) => (
            <button
              key={a.id}
              onClick={() => pick(a.id)}
              className={cn(
                "w-full flex items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-xs text-left hover:bg-[var(--bg-soft)]",
                albumId === a.id && "bg-[var(--accent)]"
              )}
            >
              <span className="truncate">{a.name}</span>
              {albumId === a.id && <Check className="h-3 w-3 shrink-0 text-[var(--brand-green-dark)]" />}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            setOpen(false);
            setCreateDialogOpen(true);
          }}
          className="w-full flex items-center gap-1.5 rounded-md px-1.5 py-1.5 mt-1.5 border-t border-[var(--line)] text-xs font-medium text-[var(--brand-green-dark)] hover:bg-[var(--accent)]"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          สร้างอัลบั้มใหม่...
        </button>
      </PopoverContent>
    </Popover>
    <AlbumFormDialog
      open={createDialogOpen}
      onOpenChange={setCreateDialogOpen}
      title="สร้างอัลบั้มใหม่"
      onSubmit={(name) => pick(addAlbum(topicId, name, viewingAsUserId))}
    />
    </>
  );
}
