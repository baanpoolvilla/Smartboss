import Link from "next/link";
import { Card } from "@smartboss/ui/components/card";
import { FileIcon } from "lucide-react";
import { formatFileSize, fileIconKind } from "@/modules/company-files/lib/file-meta";
import type { AllFilesRow } from "@/modules/company-files/data/files";

/**
 * มุมมองรวม "ไฟล์ทั้งหมด" ที่ผู้ใช้เห็นได้ ไม่ว่าจะอยู่ที่ราก โฟลเดอร์ไหน หรือ
 * ห้องไหน — แบบเดียวกับหน้า SharePoint/OneDrive ที่รวมไฟล์จากทุกไซต์ที่มีสิทธิ์
 * ไว้หน้าเดียว แทนที่จะให้ไล่กดเข้าโฟลเดอร์/ห้องทีละที่ ไฟล์ในห้องที่เข้าไม่ได้
 * จะไม่ปรากฏในลิสต์นี้เลย (กรองจริงฝั่งเซิร์ฟเวอร์ ดู listAllFiles)
 */
export function AllFilesList({ files }: { files: AllFilesRow[] }) {
  if (files.length === 0) {
    return <Card className="p-10 text-center text-sm text-(--ink-soft)">ยังไม่มีไฟล์ที่คุณเห็นได้เลย</Card>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {files.map((f) => (
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
            </div>
            <span className="text-[11px] text-(--ink-soft) shrink-0 rounded-full bg-(--bg-soft) px-2.5 py-1">
              {f.sourceLabel}
            </span>
          </Card>
        </Link>
      ))}
    </div>
  );
}
