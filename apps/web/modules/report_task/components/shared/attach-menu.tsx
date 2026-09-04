"use client";

import { useRef } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { Paperclip, Image as ImageIcon, Camera, FileText } from "lucide-react";
import { REPORT_ATTACHMENT_ACCEPT } from "@/modules/report_task/lib/report-attachment-kind";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * One "แนบไฟล์" trigger that opens 3 explicit choices instead of a single
 * bare `<input type="file">` with no `accept` (Item 6).
 *
 * Android's file picker chooses which app it opens based on `accept`, and a
 * bare input with none opens **Files/Documents** — no Gallery/Photos tab at
 * all, so a user reporting the bug via a screenshot had no way to reach
 * their own photo library short of digging through a Files app they don't
 * normally use. Splitting into 3 separate hidden inputs, each with the
 * `accept` that actually targets the app it's for, is the same pattern
 * ChatGPT's own attach button uses:
 *   - "คลังภาพ/วิดีโอ" → `image/*,video/*` → opens Gallery/Photos directly
 *   - "ถ่ายรูป/วิดีโอ" → `image/*` + `capture="environment"` → opens the camera directly
 *   - "ไฟล์อื่นๆ" → the same `REPORT_ATTACHMENT_ACCEPT` list every upload
 *     already validates against → Files/Documents, for the actual document
 *     case that bare input used to always land on
 */
export function AttachMenu({
  onFiles,
  disabled,
  label = "แนบรูป/คลิป/ไฟล์",
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
   * the same 3-way menu underneath. */
  trigger?: React.ReactNode;
  "aria-label"?: string;
}) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
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
            onClick={() => pick(galleryRef)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--bg-soft)]"
          >
            <ImageIcon className="h-4 w-4 text-[var(--ink-soft)]" /> คลังภาพ/วิดีโอ
          </button>
          <button
            type="button"
            onClick={() => pick(cameraRef)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--bg-soft)]"
          >
            <Camera className="h-4 w-4 text-[var(--ink-soft)]" /> ถ่ายรูป/วิดีโอ
          </button>
          <button
            type="button"
            onClick={() => pick(fileRef)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--bg-soft)]"
          >
            <FileText className="h-4 w-4 text-[var(--ink-soft)]" /> ไฟล์อื่นๆ
          </button>
        </PopoverContent>
      </Popover>

      {/* hidden inputs — one per intent, each `accept`ing only what that
          intent actually needs, so mobile OSes route to the right picker */}
      <input ref={galleryRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleChange} disabled={disabled} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleChange} disabled={disabled} />
      <input ref={fileRef} type="file" accept={REPORT_ATTACHMENT_ACCEPT} multiple className="hidden" onChange={handleChange} disabled={disabled} />
    </>
  );
}
