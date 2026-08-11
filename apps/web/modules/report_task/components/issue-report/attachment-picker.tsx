"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Paperclip, X, FileText, Loader2 } from "lucide-react";
import { uploadIssueAttachment } from "@/modules/report_task/lib/attachment-upload";
import type { IssueAttachment } from "@/modules/report_task/types/issue";
import { cn } from "@/modules/report_task/lib/utils";

const MAX_FILES = 10;

/**
 * Drag-and-drop + clipboard-paste + picker-button attachment zone, shared by
 * the report dialog and the ticket detail composer (spec §5.2 point 1: "Ctrl+V
 * ต้องวางรูปได้เลย" is called out as the single most important bit of this UI).
 */
export function AttachmentPicker({
  attachments,
  onChange,
  uploadedBy,
  disabled,
}: {
  attachments: IssueAttachment[];
  onChange: (next: IssueAttachment[]) => void;
  uploadedBy: string;
  disabled?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    if (attachments.length + list.length > MAX_FILES) {
      toast.error(`แนบได้สูงสุด ${MAX_FILES} ไฟล์ต่อตั๋ว`);
      return;
    }
    setUploading((n) => n + list.length);
    try {
      const uploaded = await Promise.all(
        list.map(async (file) => {
          try {
            return await uploadIssueAttachment(file, uploadedBy);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "อัปโหลดไฟล์ไม่สำเร็จ");
            return null;
          }
        })
      );
      const ok = uploaded.filter((a): a is IssueAttachment => a !== null);
      if (ok.length > 0) onChange([...attachments, ...ok]);
    } finally {
      setUploading((n) => n - list.length);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-dashed p-3 transition-colors",
        dragOver ? "border-[var(--brand-green)] bg-[var(--accent)]/40" : "border-[var(--line)]"
      )}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!disabled && e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
      }}
      onPaste={(e) => {
        if (disabled) return;
        const files = Array.from(e.clipboardData?.files ?? []);
        if (files.length) void addFiles(files);
      }}
      tabIndex={-1}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-soft)] hover:text-[var(--ink)] disabled:opacity-50"
        >
          <Paperclip className="h-3.5 w-3.5" /> แนบรูป/ไฟล์ — ลากวาง หรือวางจากคลิปบอร์ด (Ctrl+V) ได้
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {(attachments.length > 0 || uploading > 0) && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div key={a.id} className="relative group">
              {a.isPreviewable ? (
                <img src={a.url} alt={a.name} className="h-16 w-16 rounded-md object-cover border border-[var(--line)]" />
              ) : (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-16 w-28 flex-col items-center justify-center gap-1 rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-1 text-center"
                >
                  <FileText className="h-4 w-4 text-[var(--ink-soft)]" />
                  <span className="text-[10px] text-[var(--ink-soft)] truncate w-full">{a.name}</span>
                </a>
              )}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(attachments.filter((x) => x.id !== a.id))}
                  className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ink)] text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label={`ลบไฟล์ ${a.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {uploading > 0 &&
            Array.from({ length: uploading }).map((_, i) => (
              <div key={i} className="flex h-16 w-16 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--bg-soft)]">
                <Loader2 className="h-4 w-4 animate-spin text-[var(--ink-soft)]" />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
