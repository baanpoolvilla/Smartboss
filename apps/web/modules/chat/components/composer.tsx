"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import type { ChatAttachment } from "../types";
import { uploadAttachment } from "../lib/api";
import { formatFileSize } from "../lib/format";

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,application/zip";

export function Composer({
  disabled,
  onSend,
}: {
  disabled?: boolean;
  onSend: (input: { body?: string; attachments?: ChatAttachment[] }) => void;
}) {
  const [text, setText] = useState("");
  const [pendingFile, setPendingFile] = useState<{ name: string; size: number } | null>(null);
  const [uploaded, setUploaded] = useState<ChatAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setPendingFile({ name: file.name, size: file.size });
    setUploading(true);
    try {
      const attachment = await uploadAttachment(file);
      setUploaded(attachment);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ");
      setPendingFile(null);
    } finally {
      setUploading(false);
    }
  }

  function clearAttachment() {
    setPendingFile(null);
    setUploaded(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleSubmit() {
    const body = text.trim();
    if (!body && !uploaded) return;
    if (uploading) {
      toast.error("รอไฟล์แนบอัปโหลดเสร็จก่อน");
      return;
    }
    onSend({ body: body || undefined, attachments: uploaded ? [uploaded] : undefined });
    setText("");
    clearAttachment();
  }

  return (
    <div className="border-t border-[var(--line)] bg-[var(--bg)] p-3">
      {pendingFile && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] px-3 py-1.5 text-xs">
          <span aria-hidden>📎</span>
          <span className="min-w-0 flex-1 truncate">{pendingFile.name}</span>
          <span className="text-[var(--ink-soft)]">{uploading ? "กำลังอัปโหลด..." : formatFileSize(pendingFile.size)}</span>
          <button type="button" onClick={clearAttachment} className="text-[var(--ink-soft)] hover:text-[var(--ink)]" aria-label="เอาไฟล์แนบออก">
            ✕
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] disabled:opacity-50"
          title="แนบรูป/ไฟล์"
          aria-label="แนบรูป/ไฟล์"
        >
          📎
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          disabled={disabled}
          rows={1}
          placeholder="พิมพ์ข้อความ..."
          className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl border border-[var(--line)] bg-[var(--bg-soft)] px-3.5 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-soft)] focus-visible:border-[var(--brand-green)] focus-visible:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || (!text.trim() && !uploaded)}
          className="h-10 shrink-0 rounded-full bg-[var(--brand-green)] px-4 text-sm font-medium text-white hover:brightness-95 disabled:opacity-40"
        >
          ส่ง
        </button>
      </div>
    </div>
  );
}
