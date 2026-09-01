"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { Folder as FolderIcon, FileIcon, Upload, FolderPlus, ChevronRight, Home, MessagesSquare, Trash2 } from "lucide-react";
import { createFolder, createFile, type FolderPathEntry } from "@/modules/company-files/data/files";
import { uploadCompanyFile } from "@/modules/company-files/lib/upload";
import { formatFileSize, fileIconKind } from "@/modules/company-files/lib/file-meta";
import type { CompanyFile, CompanyFolder } from "@prisma/client";

/**
 * Folder browser for "ไฟล์บริษัท" — plain URL-driven navigation (`?folder=id`,
 * a server component re-fetches on every link click) rather than client-side
 * state, same reasoning the admin issue-reports list uses: this module has
 * no Dialog/Sheet component available (packages/ui is deliberately minimal —
 * see admin module's own pages), so folders/files are plain pages, not
 * modals.
 */
export function FileBrowser({
  currentFolderId,
  path,
  folders,
  files,
  roomFolders = [],
  uploaderNames = {},
}: {
  currentFolderId: string | null;
  path: FolderPathEntry[];
  folders: CompanyFolder[];
  files: CompanyFile[];
  /** โฟลเดอร์ที่ผูกกับห้องของโมดูลรายงาน — เห็นเฉพาะคนที่ยังเป็นสมาชิกห้องนั้นอยู่
   * (ข้อมูลก็กรองมาจากฝั่งเซิร์ฟเวอร์แล้ว ที่นี่แค่โชว์) มีแค่ตอนอยู่หน้าราก */
  roomFolders?: CompanyFolder[];
  /** userId → ชื่อ (คนแก้ล่าสุด/คนอัปโหลด) สำหรับคอลัมน์ "แก้โดย" — ส่งจาก page ฝั่ง server */
  uploaderNames?: Record<string, string>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sortBy, setSortBy] = useState<"name" | "modified" | "size">("name");

  const sortedFiles = [...files].sort((a, b) => {
    if (sortBy === "modified") return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    if (sortBy === "size") return b.size - a.size;
    return a.name.localeCompare(b.name, "th");
  });

  function handleCreateFolder() {
    const name = window.prompt("ตั้งชื่อโฟลเดอร์:");
    if (!name?.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        await createFolder(currentFolderId, name.trim());
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "สร้างโฟลเดอร์ไม่สำเร็จ");
      }
    });
  }

  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    const picked = Array.from(fileList);
    startTransition(async () => {
      try {
        for (const f of picked) {
          const uploaded = await uploadCompanyFile(f);
          await createFile(currentFolderId, uploaded);
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ");
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm text-(--ink-soft) flex-wrap">
        <Link href="/company-files" className="flex items-center gap-1 hover:text-(--ink)">
          <Home className="h-3.5 w-3.5" /> ไฟล์บริษัท
        </Link>
        {path.map((p) => (
          <span key={p.id} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5" />
            <Link href={`/company-files?folder=${p.id}`} className="hover:text-(--ink)">
              {p.name}
            </Link>
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={isPending} onClick={handleCreateFolder}>
          <FolderPlus className="h-4 w-4" /> สร้างโฟลเดอร์
        </Button>
        <Button size="sm" disabled={isPending} onClick={handleUploadClick}>
          <Upload className="h-4 w-4" /> อัปโหลดไฟล์
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFilesSelected(e.target.files)}
        />
        {isPending && <span className="text-xs text-(--ink-soft)">กำลังทำงาน...</span>}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "name" | "modified" | "size")}
          className="ml-auto h-9 rounded-(--radius) border border-(--line) bg-(--bg) px-2 text-sm"
          aria-label="เรียงไฟล์ตาม"
        >
          <option value="name">เรียงตามชื่อ</option>
          <option value="modified">แก้ล่าสุดก่อน</option>
          <option value="size">ขนาดใหญ่ก่อน</option>
        </select>
        <Link
          href="/company-files/trash"
          className="inline-flex items-center gap-1.5 h-9 rounded-(--radius) border border-(--line) px-3 text-sm text-(--ink-soft) hover:text-(--ink) hover:bg-(--bg-soft)"
        >
          <Trash2 className="h-4 w-4" /> ถังขยะ
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {roomFolders.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-(--ink-soft) flex items-center gap-1.5">
            <MessagesSquare className="h-3.5 w-3.5" /> ห้องรายงาน
          </p>
          {roomFolders.map((f) => (
            <Link key={f.id} href={`/company-files?folder=${f.id}`}>
              <Card className="p-3 flex items-center gap-3 hover:bg-(--bg-soft) transition-colors">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius) bg-(--accent-soft,#e0f2fe)">
                  <MessagesSquare className="h-4.5 w-4.5 text-(--accent-dark,#0177ac)" />
                </span>
                <span className="text-sm font-medium truncate">{f.name}</span>
                <span className="text-[11px] text-(--ink-soft) ml-auto shrink-0">เห็นเฉพาะสมาชิกห้องนี้</span>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {folders.length === 0 && files.length === 0 ? (
        <Card className="p-10 text-center text-sm text-(--ink-soft)">โฟลเดอร์นี้ยังไม่มีอะไรเลย</Card>
      ) : (
        <div className="flex flex-col gap-1.5">
          {folders.map((f) => (
            <Link key={f.id} href={`/company-files?folder=${f.id}`}>
              <Card className="p-3 flex items-center gap-3 hover:bg-(--bg-soft) transition-colors">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius) bg-(--bg-soft)">
                  <FolderIcon className="h-4.5 w-4.5 text-(--ink-soft)" />
                </span>
                <span className="text-sm font-medium truncate">{f.name}</span>
              </Card>
            </Link>
          ))}
          {sortedFiles.map((f) => (
            <Link key={f.id} href={`/company-files/file/${f.id}`}>
              <Card className="p-3 flex items-center gap-3 hover:bg-(--bg-soft) transition-colors">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius) bg-(--bg-soft)">
                  <FileIcon className="h-4.5 w-4.5 text-(--ink-soft)" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{f.name}</p>
                  <p className="text-[11px] text-(--ink-soft)">
                    {formatFileSize(f.size)} · {fileIconKind(f.mimeType)} · v{f.currentVersion}
                  </p>
                  <p className="text-[11px] text-(--ink-faint,#7f93a6)">
                    แก้ล่าสุด {new Date(f.updatedAt).toLocaleDateString("th-TH")}
                    {(uploaderNames[f.updatedBy ?? ""] ?? uploaderNames[f.createdBy]) && (
                      <> · โดย {uploaderNames[f.updatedBy ?? ""] ?? uploaderNames[f.createdBy]}</>
                    )}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
