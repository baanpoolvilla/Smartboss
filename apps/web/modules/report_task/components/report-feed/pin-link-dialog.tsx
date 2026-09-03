"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/modules/report_task/components/ui/dialog";
import { Input } from "@/modules/report_task/components/ui/input";
import { Label } from "@/modules/report_task/components/ui/label";
import { Button } from "@/modules/report_task/components/ui/button";

/**
 * Names a link on the way to being pinned to a room, and renames one already
 * pinned. A bare URL is unreadable in a list ("อยากตั้งชื่อ") — this is the
 * one step that turns it into something findable by name later.
 *
 * The URL itself is shown but not editable: a pin always points at a link
 * that already exists somewhere in the room, so letting it be retyped here
 * would just be a way to create a broken one.
 */
export function PinLinkDialog({
  open,
  onOpenChange,
  url,
  initialTitle = "",
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  initialTitle?: string;
  onSubmit: (title: string) => void;
}) {
  const [title, setTitle] = useState(initialTitle);

  // Re-seed each time it opens so a previous link's name never leaks into the
  // next one — same deferred-setState shape AlbumFormDialog uses (the
  // compiler's purity check rejects a synchronous setState in an effect body).
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setTitle(initialTitle), 0);
    return () => clearTimeout(timer);
  }, [open, initialTitle]);

  function submit() {
    // An unnamed pin is still worth keeping — it falls back to the URL, which
    // is exactly what the un-pinned list already showed.
    onSubmit(title.trim() || url);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initialTitle ? "เปลี่ยนชื่อลิงก์" : "ปักหมุดลิงก์"}</DialogTitle>
          <DialogDescription className="break-all">{url}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="pin-link-title">ชื่อลิงก์</Label>
          <Input
            id="pin-link-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="เช่น แบบแปลน Drive"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button onClick={submit}>{initialTitle ? "บันทึก" : "ปักหมุด"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
