"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/modules/report_task/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/modules/report_task/components/ui/alert-dialog";
import { Input } from "@/modules/report_task/components/ui/input";
import { Label } from "@/modules/report_task/components/ui/label";
import { Button } from "@/modules/report_task/components/ui/button";

/**
 * One name field, styled to match the rest of the app — used for both
 * creating a new album and renaming an existing one (see `initialName`).
 * Replaces the native window.prompt() that used to handle both.
 */
export function AlbumFormDialog({
  open,
  onOpenChange,
  title,
  initialName = "",
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initialName?: string;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const isDirty = name.trim() !== "" && name.trim() !== initialName.trim();

  function requestClose(nextOpen: boolean) {
    if (!nextOpen && isDirty) {
      setConfirmDiscardOpen(true);
      return;
    }
    onOpenChange(nextOpen);
  }

  // Re-seed from whichever album (if any) opened this dialog each time it
  // opens, so a previous edit never leaks into the next. Deferred a tick —
  // the compiler's purity check doesn't allow setState synchronously inside
  // an effect body.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setName(initialName), 0);
    return () => clearTimeout(timer);
  }, [open, initialName]);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="album-name">ชื่ออัลบั้ม</Label>
          <Input
            id="album-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="เช่น ทริปดูงาน ส.ค. 2026"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => requestClose(false)}>
            ยกเลิก
          </Button>
          <Button onClick={submit} disabled={!name.trim()}>
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ทิ้งชื่อที่พิมพ์ไว้?</AlertDialogTitle>
            <AlertDialogDescription>ยังไม่ได้บันทึก ถ้าปิดตอนนี้ชื่อที่พิมพ์ไว้จะหายไป</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>กรอกต่อ</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--chart-red)] hover:bg-red-700 text-white"
              onClick={() => {
                setConfirmDiscardOpen(false);
                onOpenChange(false);
              }}
            >
              ทิ้งข้อมูล
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
