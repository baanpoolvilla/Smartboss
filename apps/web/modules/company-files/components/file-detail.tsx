"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { Download, History, Link2, RotateCcw, Trash2, Upload, Copy, Ban, Pencil, CalendarClock, FolderInput } from "lucide-react";
import {
  addFileVersion,
  restoreFileVersion,
  deleteCompanyFile,
  createShareLink,
  revokeShareLink,
  renameFile,
  moveFile,
} from "@/modules/company-files/data/files";
import { uploadCompanyFile } from "@/modules/company-files/lib/upload";
import { formatFileSize, fileIconKind, isPreviewable, fileKindOf } from "@/modules/company-files/lib/file-meta";
import { SHARE_LINK_ROLE_LABELS, type ShareLinkRole } from "@/modules/company-files/types";
import type { CompanyFile, CompanyFileVersion, CompanyFileShareLink } from "@prisma/client";

export function FileDetail({
  file,
  versions,
  shareLinks,
  uploaderNames,
  movableFolders,
}: {
  file: CompanyFile;
  versions: CompanyFileVersion[];
  shareLinks: CompanyFileShareLink[];
  uploaderNames: Record<string, string>;
  movableFolders: { id: string; name: string; roomId: string | null }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [shareRole, setShareRole] = useState<ShareLinkRole>("view");
  const [shareExpiry, setShareExpiry] = useState<string>("0");
  const [shareCreated, setShareCreated] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<string>(file.folderId ?? "__root__");

  function run(action: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง");
      }
    });
  }

  function handleNewVersion(fileList: FileList | null) {
    const picked = fileList?.[0];
    if (!picked) return;
    run(async () => {
      const uploaded = await uploadCompanyFile(picked);
      await addFileVersion(file.id, uploaded);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleDelete() {
    if (!window.confirm(`ลบไฟล์ "${file.name}" ทิ้งเลยไหม? ลบแล้วกู้คืนไม่ได้`)) return;
    run(async () => {
      await deleteCompanyFile(file.id);
      router.push(file.folderId ? `/company-files?folder=${file.folderId}` : "/company-files");
    });
  }

  function handleCreateShareLink() {
    const days = shareExpiry === "0" ? null : Number(shareExpiry);
    run(async () => {
      const link = await createShareLink(file.id, shareRole, days);
      setShareCreated(`${window.location.origin}/s/${link.token}`);
    });
  }

  function handleRename() {
    const name = window.prompt("ตั้งชื่อไฟล์ใหม่:", file.name);
    if (name === null || !name.trim()) return;
    run(async () => {
      await renameFile(file.id, name.trim());
    });
  }

  function handleMove() {
    const target = moveTarget === "__root__" ? null : moveTarget;
    if (target === file.folderId) return;
    run(async () => {
      await moveFile(file.id, target);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-(--ink-soft)">
              {fileIconKind(file.mimeType)} · {formatFileSize(file.size)} · เวอร์ชันปัจจุบัน v{file.currentVersion}
              {" · อัปโหลดโดย "}{uploaderNames[file.createdBy] ?? "ไม่ทราบชื่อ"}
            </p>
            <h2 className="text-base font-semibold mt-0.5 break-words">{file.name}</h2>
          </div>
          <div className="flex items-center gap-2">
            <a href={file.storageKey} download={file.name} className="inline-flex">
              <Button variant="outline" size="sm"><Download className="h-4 w-4" /> ดาวน์โหลด</Button>
            </a>
            <Button variant="outline" size="sm" disabled={isPending} onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" /> อัปโหลดเวอร์ชันใหม่
            </Button>
            <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => handleNewVersion(e.target.files)} />
            <Button variant="outline" size="sm" disabled={isPending} onClick={handleRename}>
              <Pencil className="h-4 w-4" /> เปลี่ยนชื่อ
            </Button>
            <Button variant="danger" size="sm" disabled={isPending} onClick={handleDelete}>
              <Trash2 className="h-4 w-4" /> ลบไฟล์
            </Button>
          </div>
        </div>

        {isPreviewable(file.mimeType) && (
          <div className="mt-4 rounded-(--radius) border border-(--line) overflow-hidden bg-(--bg-soft)">
            {fileKindOf(file.mimeType) === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={file.storageKey} alt={file.name} className="max-h-[500px] w-full object-contain" />
            ) : (
              <iframe src={file.storageKey} title={file.name} className="w-full h-[500px]" />
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      </Card>

      {/* ย้ายไฟล์ */}
      <Card className="p-4 sm:p-5">
        <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-3"><FolderInput className="h-4 w-4" /> ตำแหน่งไฟล์</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={moveTarget}
            onChange={(e) => setMoveTarget(e.target.value)}
            className="h-9 min-w-[220px] rounded-(--radius) border border-(--line) bg-(--bg) px-2 text-sm"
          >
            <option value="__root__">ไฟล์บริษัท (หน้าหลัก)</option>
            {movableFolders.map((f) => (
              <option key={f.id} value={f.id}>{f.roomId ? `ห้อง: ${f.name}` : f.name}</option>
            ))}
          </select>
          <Button size="sm" disabled={isPending || moveTarget === (file.folderId ?? "__root__")} onClick={handleMove}>
            ย้ายไปที่นี่
          </Button>
        </div>
      </Card>

      {/* ลิงก์แชร์ */}
      <Card className="p-4 sm:p-5">
        <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-3"><Link2 className="h-4 w-4" /> ลิงก์แชร์</h3>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select
            value={shareRole}
            onChange={(e) => setShareRole(e.target.value as ShareLinkRole)}
            className="h-9 rounded-(--radius) border border-(--line) bg-(--bg) px-2 text-sm"
          >
            {(Object.keys(SHARE_LINK_ROLE_LABELS) as ShareLinkRole[]).map((r) => (
              <option key={r} value={r}>{SHARE_LINK_ROLE_LABELS[r]}</option>
            ))}
          </select>
          <select
            value={shareExpiry}
            onChange={(e) => setShareExpiry(e.target.value)}
            className="h-9 rounded-(--radius) border border-(--line) bg-(--bg) px-2 text-sm"
            aria-label="อายุลิงก์"
          >
            <option value="0">ไม่มีวันหมดอายุ</option>
            <option value="7">หมดอายุใน 7 วัน</option>
            <option value="30">หมดอายุใน 30 วัน</option>
            <option value="90">หมดอายุใน 90 วัน</option>
          </select>
          <Button size="sm" disabled={isPending} onClick={handleCreateShareLink}>สร้างลิงก์</Button>
        </div>
        {shareCreated && (
          <div className="flex items-center gap-2 mb-3 rounded-(--radius) bg-(--bg-soft) px-3 py-2">
            <code className="text-xs flex-1 truncate">{shareCreated}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(shareCreated)}
              className="text-(--ink-soft) hover:text-(--ink)"
              aria-label="คัดลอกลิงก์"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {shareLinks.length === 0 ? (
          <p className="text-xs text-(--ink-soft)">ยังไม่มีลิงก์แชร์</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {shareLinks.map((link) => (
              <div key={link.id} className="flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 rounded-(--radius) bg-(--bg-soft)">
                <span className={link.revoked ? "line-through text-(--ink-soft)" : "flex items-center gap-1.5 flex-wrap"}>
                  {SHARE_LINK_ROLE_LABELS[link.role as ShareLinkRole] ?? link.role} · สร้างเมื่อ {new Date(link.createdAt).toLocaleDateString("th-TH")}
                  {link.expiresAt && (
                    <span className={`inline-flex items-center gap-1 ${new Date(link.expiresAt).getTime() < Date.now() ? "text-red-600" : "text-(--ink-soft)"}`}>
                      <CalendarClock className="h-3 w-3" />
                      {new Date(link.expiresAt).getTime() < Date.now()
                        ? "หมดอายุแล้ว"
                        : `หมดอายุ ${new Date(link.expiresAt).toLocaleDateString("th-TH")}`}
                    </span>
                  )}
                </span>
                {!link.revoked && (
                  <button
                    type="button"
                    onClick={() => run(() => revokeShareLink(link.id))}
                    className="text-(--ink-soft) hover:text-red-600 flex items-center gap-1 shrink-0"
                  >
                    <Ban className="h-3 w-3" /> เพิกถอน
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ประวัติเวอร์ชัน */}
      <Card className="p-4 sm:p-5">
        <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-3"><History className="h-4 w-4" /> ประวัติเวอร์ชัน</h3>
        <div className="flex flex-col gap-1.5">
          {versions.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 rounded-(--radius) bg-(--bg-soft)">
              <span>
                v{v.versionNumber} · {formatFileSize(v.size)} ·{" "}
                {v.uploadedBy.startsWith("share-link:") ? "ผู้ถือลิงก์แชร์" : uploaderNames[v.uploadedBy] ?? "ไม่ทราบชื่อ"} ·{" "}
                {new Date(v.uploadedAt).toLocaleString("th-TH")}
                {v.note && ` · ${v.note}`}
              </span>
              {v.versionNumber !== file.currentVersion && (
                <button
                  type="button"
                  onClick={() => run(() => restoreFileVersion(file.id, v.versionNumber))}
                  className="text-(--brand-green-dark,#166534) hover:underline flex items-center gap-1 shrink-0"
                >
                  <RotateCcw className="h-3 w-3" /> กู้คืนเวอร์ชันนี้
                </button>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
