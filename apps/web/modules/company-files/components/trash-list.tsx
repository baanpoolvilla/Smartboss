"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { RotateCcw, Trash2, FileIcon, Folder as FolderIcon } from "lucide-react";
import {
  restoreCompanyFile,
  purgeCompanyFile,
  restoreFolder,
  purgeFolder,
  type TrashRow,
} from "@/modules/company-files/data/files";

export function TrashList({ items }: { items: TrashRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง");
      }
    });
  }

  function handleRestore(it: TrashRow) {
    run(() => (it.kind === "file" ? restoreCompanyFile(it.id) : restoreFolder(it.id)));
  }

  function handlePurge(it: TrashRow) {
    if (!window.confirm(`ลบถาวร "${it.name}" ทิ้งเลยไหม? ลบแล้วกู้คืนไม่ได้อีก`)) return;
    run(() => (it.kind === "file" ? purgeCompanyFile(it.id) : purgeFolder(it.id)));
  }

  if (items.length === 0) {
    return <Card className="p-10 text-center text-sm text-(--ink-soft)">ถังขยะว่าง</Card>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {items.map((it) => (
        <Card key={`${it.kind}-${it.id}`} className="p-3 flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius) bg-(--bg-soft)">
            {it.kind === "folder" ? (
              <FolderIcon className="h-4.5 w-4.5 text-(--ink-soft)" />
            ) : (
              <FileIcon className="h-4.5 w-4.5 text-(--ink-soft)" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{it.name}</p>
            <p className="text-[11px] text-(--ink-soft)">
              {it.sourceLabel} · ลบเมื่อ {new Date(it.deletedAt).toLocaleDateString("th-TH")}
            </p>
          </div>
          <Button variant="outline" size="sm" disabled={isPending} onClick={() => handleRestore(it)}>
            <RotateCcw className="h-4 w-4" /> กู้คืน
          </Button>
          <Button variant="danger" size="sm" disabled={isPending} onClick={() => handlePurge(it)}>
            <Trash2 className="h-4 w-4" /> ลบถาวร
          </Button>
        </Card>
      ))}
    </div>
  );
}
