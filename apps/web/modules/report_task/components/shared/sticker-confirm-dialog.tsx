"use client";

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
import type { Sticker } from "@/modules/report_task/types";

/**
 * §6 — every sticker send goes through this confirm step first instead of
 * firing on click. Shared across every send point (task card, task detail
 * sheet, escalations panel) so the copy/behavior never drifts between them.
 */
export function StickerConfirmDialog({
  open,
  onOpenChange,
  sticker,
  recipientName,
  taskTitle,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sticker: Sticker | null;
  recipientName: string;
  taskTitle: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open && !!sticker} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <span className="text-xl">{sticker?.emoji}</span> ส่งสติกเกอร์
          </AlertDialogTitle>
          <AlertDialogDescription>
            ส่ง &ldquo;{sticker?.emoji} {sticker?.label}&rdquo; ให้ <span className="font-medium text-[var(--ink)]">{recipientName}</span> สำหรับงาน
            &ldquo;{taskTitle}&rdquo;?
            {!!sticker && sticker.points !== 0 && (
              <span className="block mt-2 text-[var(--chart-red-dark)]">
                สติกเกอร์นี้จะบันทึกลงประวัติงาน และ
                {sticker.points < 0 ? `หักคะแนน ${Math.abs(sticker.points)} แต้ม` : `ให้คะแนน +${sticker.points} แต้ม`}ของผู้รับผิดชอบ
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>ยืนยันส่ง</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
