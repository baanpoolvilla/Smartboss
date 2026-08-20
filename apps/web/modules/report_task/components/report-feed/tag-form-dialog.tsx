"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/modules/report_task/components/ui/dialog";
import { Input } from "@/modules/report_task/components/ui/input";
import { Label } from "@/modules/report_task/components/ui/label";
import { Button } from "@/modules/report_task/components/ui/button";
import { topicColors } from "@/modules/report_task/store/report-feed-store";
import { cn } from "@/modules/report_task/lib/utils";
import { Check } from "lucide-react";

/**
 * Name + color for a new curated tag — same one-field-plus-swatches shape as
 * a room's own "รูปลักษณ์" color picker (topic-sidebar.tsx), reused here so
 * tag color and room color read as the same kind of decision everywhere in
 * report-feed. Create-only (no rename/recolor yet — matches AlbumFormDialog
 * v1, which also shipped create-only before rename got added later).
 */
export function TagFormDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, color: string) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(topicColors[0]!);

  // Fresh name/color each time the dialog opens, same "re-seed on open"
  // pattern as AlbumFormDialog — deferred a tick since setState can't run
  // synchronously inside an effect body.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      setName("");
      setColor(topicColors[0]!);
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed, color);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>สร้างแท็กใหม่</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="tag-name">ชื่อแท็ก</Label>
          <Input
            id="tag-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="เช่น ด่วน, งานลูกค้า A, ต้องติดตาม"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-[var(--ink-soft)]">สี</Label>
          <div className="flex items-center gap-2.5 flex-wrap">
            {topicColors.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`เลือกสี ${c}`}
                className={cn(
                  "h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-transform",
                  color === c && "scale-110 ring-2 ring-offset-2 ring-[var(--line)]"
                )}
                style={{ backgroundColor: c }}
              >
                {color === c && <Check className="h-3.5 w-3.5 text-white" />}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button onClick={submit} disabled={!name.trim()}>
            สร้างแท็ก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
