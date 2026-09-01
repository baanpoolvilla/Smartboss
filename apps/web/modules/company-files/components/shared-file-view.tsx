"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { Download, Upload, Lock } from "lucide-react";
import { addFileVersionViaShareLink, verifyShareLinkPassword } from "@/modules/company-files/data/files";
import { uploadCompanyFile } from "@/modules/company-files/lib/upload";
import { formatFileSize, fileIconKind, isPreviewable, fileKindOf } from "@/modules/company-files/lib/file-meta";
import type { CompanyFile } from "@prisma/client";

export function SharedFileView({ token, file, role, needsPassword = false }: { token: string; file: CompanyFile; role: string; needsPassword?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [unlockedPw, setUnlockedPw] = useState<string | null>(needsPassword ? null : "");
  const [pwError, setPwError] = useState<string | null>(null);
  const locked = needsPassword && unlockedPw === null;
  const shareUrl = `/api/company-files/share/${token}${unlockedPw ? `?pw=${encodeURIComponent(unlockedPw)}` : ""}`;

  function handleUnlock() {
    setPwError(null);
    startTransition(async () => {
      const ok = await verifyShareLinkPassword(token, passwordInput);
      if (ok) setUnlockedPw(passwordInput);
      else setPwError("รหัสผ่านไม่ถูกต้อง");
    });
  }

  function handleReplace(fileList: FileList | null) {
    const picked = fileList?.[0];
    if (!picked) return;
    setError(null);
    startTransition(async () => {
      try {
        const uploaded = await uploadCompanyFile(picked);
        await addFileVersionViaShareLink(token, uploaded);
        setDone(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ");
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    });
  }

  return (
    <Card className="p-5 sm:p-6">
      <p className="text-xs text-(--ink-soft)">
        {fileIconKind(file.mimeType)} · {formatFileSize(file.size)} · {role === "edit" ? "แชร์แบบแก้ไขได้" : "แชร์แบบดูอย่างเดียว"}
      </p>
      <h1 className="text-lg font-semibold mt-1 break-words">{file.name}</h1>

      {locked && (
        <div className="mt-4 flex flex-col gap-2 rounded-(--radius) border border-(--line) bg-(--bg-soft) p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium"><Lock className="h-4 w-4" /> ลิงก์นี้มีรหัสผ่าน</p>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="ใส่รหัสผ่าน"
              className="h-9 flex-1 rounded-(--radius) border border-(--line) bg-white px-2 text-sm"
            />
            <Button size="sm" disabled={isPending || !passwordInput} onClick={handleUnlock}>ปลดล็อก</Button>
          </div>
          {pwError && <p className="text-xs text-red-600">{pwError}</p>}
        </div>
      )}

      {!locked && isPreviewable(file.mimeType) && (
        <div className="mt-4 rounded-(--radius) border border-(--line) overflow-hidden bg-(--bg-soft)">
          {fileKindOf(file.mimeType) === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shareUrl} alt={file.name} className="max-h-[500px] w-full object-contain" />
          ) : (
            <iframe src={shareUrl} title={file.name} className="w-full h-[500px]" />
          )}
        </div>
      )}

      {!locked && (
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a href={shareUrl} download={file.name}>
          <Button variant="outline" size="sm"><Download className="h-4 w-4" /> ดาวน์โหลด</Button>
        </a>
        {role === "edit" && (
          <>
            <Button size="sm" disabled={isPending} onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" /> อัปโหลดไฟล์ใหม่แทนที่
            </Button>
            <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => handleReplace(e.target.files)} />
          </>
        )}
      </div>
      )}

      {done && <p className="text-sm text-green-700 mt-3">อัปโหลดเวอร์ชันใหม่แล้ว</p>}
      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
    </Card>
  );
}
