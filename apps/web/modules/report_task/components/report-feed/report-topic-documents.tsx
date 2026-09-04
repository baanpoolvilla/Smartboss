"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { FolderOpen, Upload } from "lucide-react";
import { AttachMenu } from "@/modules/report_task/components/shared/attach-menu";
import { listRoomFiles, addFileToRoomFolder } from "@/modules/company-files/data/files";
import { uploadCompanyFile } from "@/modules/company-files/lib/upload";
import { formatFileSize, fileIconKind } from "@/modules/company-files/lib/file-meta";
import { ReportMediaThumb } from "@/modules/report_task/components/report-feed/report-media-thumb";
import { attachmentKind } from "@/modules/report_task/lib/report-attachment-kind";
import type { CompanyFile } from "@prisma/client";

/**
 * The room's permanent file library (company-files) — a separate pool from
 * the rolling post-attachment gallery above, and NOT documents-only despite
 * the label: its upload picker and the "เพิ่มเข้าไฟล์ทั้งหมดของห้องนี้" button on
 * any post thumbnail both accept any file kind, photos and clips included
 * ("มันเก็บทุกอย่างรูปอะไรก็ได้ทุกไฟล์วิดีโอด้วย"). So each row picks its
 * render the same way the rest of the "ไฟล์" tab does — a real image/video
 * thumbnail via ReportMediaThumb when the mime says so, a generic file row
 * otherwise — rather than one file icon for everything regardless of kind.
 * Only members of this room's own room can see it (enforced server-side,
 * see room-access-server.ts). Detail/version history/sharing reuse the
 * existing company-files pages rather than being rebuilt here.
 */
export function ReportTopicDocuments({
  topicId,
  topicName,
  search = "",
}: {
  topicId: string;
  topicName: string;
  /** The "ไฟล์" tab's single search box — one box covers post attachments,
   * links, albums AND this library, so it's passed in rather than given a
   * second box of its own. */
  search?: string;
}) {
  const [files, setFiles] = useState<CompanyFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    listRoomFiles(topicId)
      .then((r) => {
        if (!cancelled) setFiles(r.files);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [topicId]);

  const q = search.trim().toLowerCase();
  const visibleFiles = q ? (files ?? []).filter((f) => f.name.toLowerCase().includes(q)) : (files ?? []);

  function handleUpload(picked: File[]) {
    if (picked.length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        for (const f of picked) {
          const uploaded = await uploadCompanyFile(f);
          await addFileToRoomFolder(topicId, topicName, uploaded);
        }
        const r = await listRoomFiles(topicId);
        setFiles(r.files);
      } catch (e) {
        setError(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="rounded-xl border border-[var(--line)] p-3.5">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
          <FolderOpen className="h-3.5 w-3.5" /> ไฟล์ทั้งหมดของห้องนี้
        </p>
        <AttachMenu
          onFiles={handleUpload}
          disabled={isPending}
          trigger={
            <>
              <Upload className="h-3.5 w-3.5" />
              {isPending ? "กำลังอัปโหลด..." : "อัปโหลดไฟล์"}
            </>
          }
          className="shrink-0 flex items-center gap-1.5 rounded-full bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white text-xs font-medium px-3 py-1.5 transition-colors disabled:opacity-50"
        />
      </div>

      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {files === null ? (
        <p className="text-xs text-[var(--ink-soft)]">กำลังโหลด...</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-[var(--ink-soft)]">ยังไม่มีไฟล์ในห้องนี้ — เห็นเฉพาะคนในห้องนี้เท่านั้น</p>
      ) : visibleFiles.length === 0 ? (
        <p className="text-xs text-[var(--ink-soft)]">ไม่มีไฟล์ตรงกับคำค้น</p>
      ) : (
        <div className="flex flex-col gap-1">
          {visibleFiles.map((f) => {
            const isMedia = attachmentKind(f.mimeType) !== "doc";
            return (
              <Link
                key={f.id}
                href={`/company-files/file/${f.id}`}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--bg-soft)] transition-colors"
              >
                <ReportMediaThumb
                  media={{ url: f.storageKey, name: f.name, mime: f.mimeType, size: f.size }}
                  fileChipVariant="icon"
                  className={isMedia ? "h-8 w-8 shrink-0 rounded-md object-cover" : "h-8 w-8 shrink-0"}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{f.name}</p>
                  <p className="text-[11px] text-[var(--ink-soft)]">
                    {formatFileSize(f.size)} · {fileIconKind(f.mimeType)} · v{f.currentVersion}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
