"use client";

import { useRef } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { Paperclip, Image as ImageIcon, FileText } from "lucide-react";
import { REPORT_ATTACHMENT_ACCEPT } from "@/modules/report_task/lib/report-attachment-kind";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * One "แนบไฟล์" trigger that opens 2 explicit choices instead of a single
 * bare `<input type="file">` with no `accept` (Item 6).
 *
 * Android's file picker chooses which app it opens based on `accept`, and a
 * bare input with none opens **Files/Documents** — no Gallery/Photos tab at
 * all. We split into 2 hidden inputs, each with the `accept` that targets the
 * app it's for:
 *   - "รูป / วิดีโอ" → `image/*,video/*` → the OS itself offers Gallery **and**
 *     Camera (iOS shows "ถ่ายรูป/วิดีโอ / คลังภาพ / เลือกไฟล์", Android shows
 *     camera + gallery), so a separate `capture` camera button is redundant
 *     and would only ever capture a still photo (capture is single-mode).
 *   - "ไฟล์" → the same `REPORT_ATTACHMENT_ACCEPT` list every upload already
 *     validates against → Files/Documents, for the actual document case.
 */
export function AttachMenu({
  onFiles,
  disabled,
  label = "แนบรูป/ไฟล์",
  className,
  trigger,
  ...rest
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
  /** Replaces the default Paperclip-icon+label content — for an icon-only
   * trigger (e.g. a round "+" button in a chat composer) that still needs
   * the same menu underneath. */
  trigger?: React.ReactNode;
  "aria-label"?: string;
}) {
  const mediaRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function pick(ref: React.RefObject<HTMLInputElement | null>) {
    ref.current?.click();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length > 0) onFiles(picked);
    // Otherwise re-picking the exact same file(s) a second time wouldn't
    // fire onChange at all — the input never "changed" from the browser's
    // point of view.
    e.target.value = "";
  }

  return (
    <>
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              disabled={disabled}
              className={cn(
                trigger ? undefined : "inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-soft)] hover:text-[var(--ink)] disabled:opacity-50",
                className
              )}
              {...rest}
            >
              {trigger ?? (
                <>
                  <Paperclip className="h-3.5 w-3.5" /> {label}
                </>
              )}
            </button>
          }
        />
        <PopoverContent align="start" className="w-52 p-1">
          <button
            type="button"
            onClick={() => pick(mediaRef)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--bg-soft)]"
          >
            <ImageIcon className="h-4 w-4 text-[var(--ink-soft)]" /> รูป / วิดีโอ
          </button>
          <button
            type="button"
            onClick={() => pick(fileRef)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--bg-soft)]"
          >
            <FileText className="h-4 w-4 text-[var(--ink-soft)]" /> ไฟล์
          </button>
        </PopoverContent>
      </Popover>

      {/* hidden inputs — the media input's `image/*,video/*` accept makes the
          OS itself offer camera + gallery, so no separate capture button is
          needed; the file input targets Files/Documents */}
      <input ref={mediaRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleChange} disabled={disabled} />
      <input ref={fileRef} type="file" accept={REPORT_ATTACHMENT_ACCEPT} multiple className="hidden" onChange={handleChange} disabled={disabled} />
    </>
  );
}
