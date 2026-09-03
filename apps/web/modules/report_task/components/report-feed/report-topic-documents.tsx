"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { FileIcon, FolderOpen, Upload } from "lucide-react";
import { listRoomFiles, addFileToRoomFolder } from "@/modules/company-files/data/files";
import { uploadCompanyFile } from "@/modules/company-files/lib/upload";
import { formatFileSize, fileIconKind } from "@/modules/company-files/lib/file-meta";
import type { CompanyFile } from "@prisma/client";

/**
 * "เอกสาร" ของห้องนี้ — คนละก้อนกับแกลเลอรีรูปด้านบน (ซึ่งดึงจากรูปที่แนบในโพสต์)
 * นี่คือเอกสารจริงที่อัปโหลดตรงเข้าโฟลเดอร์ที่ผูกกับห้องนี้ในไฟล์บริษัท เห็นเฉพาะ
 * คนที่ยังเป็นสมาชิกห้องอยู่ (บังคับจริงฝั่งเซิร์ฟเวอร์ ดู room-access-server.ts)
 * รายละเอียด/เวอร์ชัน/แชร์ ใช้หน้าเดิมของไฟล์บริษัทเลย ไม่ทำซ้ำที่นี่
 */
export function ReportTopicDocuments({ topicId, topicName }: { topicId: string; topicName: string }) {
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

  function handleUpload(fileList: FileList | null) {
    const picked = fileList ? Array.from(fileList) : [];
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
          <FolderOpen className="h-3.5 w-3.5" /> เอกสารของห้องนี้
        </p>
        <label className="shrink-0 flex items-center gap-1.5 rounded-full bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white text-xs font-medium px-3 py-1.5 transition-colors cursor-pointer">
          <Upload className="h-3.5 w-3.5" />
          {isPending ? "กำลังอัปโหลด..." : "อัปโหลดเอกสาร"}
          <input type="file" multiple className="hidden" disabled={isPending} onChange={(e) => handleUpload(e.target.files)} />
        </label>
      </div>

      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {files === null ? (
        <p className="text-xs text-[var(--ink-soft)]">กำลังโหลด...</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-[var(--ink-soft)]">ยังไม่มีเอกสารในห้องนี้ — เห็นเฉพาะคนในห้องนี้เท่านั้น</p>
      ) : (
        <div className="flex flex-col gap-1">
          {files.map((f) => (
            <Link
              key={f.id}
              href={`/company-files/file/${f.id}`}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--bg-soft)] transition-colors"
            >
              <FileIcon className="h-4 w-4 shrink-0 text-[var(--ink-soft)]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{f.name}</p>
                <p className="text-[11px] text-[var(--ink-soft)]">
                  {formatFileSize(f.size)} · {fileIconKind(f.mimeType)} · v{f.currentVersion}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
