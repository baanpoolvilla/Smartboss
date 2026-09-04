"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/modules/report_task/components/ui/alert-dialog";
import { Button } from "@/modules/report_task/components/ui/button";
import { Input } from "@/modules/report_task/components/ui/input";
import { useStickerStore } from "@/modules/report_task/store/sticker-store";
import { usePenaltySettingsStore } from "@/modules/report_task/store/penalty-settings-store";
import type { Sticker } from "@/modules/report_task/types";
import { AlarmClockOff, Plus, Save, Trash2 } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";
import { toast } from "sonner";
import { uuid } from "@/modules/report_task/lib/uuid";

/** Sticker rewards + missed-deadline penalty default — company-wide config, lives on the settings page (src/app/settings/page.tsx). */
export function StickerManagerPanel() {
  const stickers = useStickerStore((s) => s.stickers);
  const setStickers = useStickerStore((s) => s.setStickers);
  const defaultPoints = usePenaltySettingsStore((s) => s.defaultPoints);
  const setDefaultPoints = usePenaltySettingsStore((s) => s.setDefaultPoints);

  const [draftStickers, setDraftStickers] = useState<Sticker[]>(stickers);
  const [draftDefaultPoints, setDraftDefaultPoints] = useState(defaultPoints);

  const [newEmoji, setNewEmoji] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newPoints, setNewPoints] = useState(0);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  function updateDraftSticker(id: string, patch: Partial<Omit<Sticker, "id">>) {
    setDraftStickers((list) => list.map((st) => (st.id === id ? { ...st, ...patch } : st)));
  }

  function removeDraftSticker(id: string) {
    setDraftStickers((list) => list.filter((st) => st.id !== id));
  }

  function save() {
    setStickers(draftStickers);
    setDefaultPoints(draftDefaultPoints);
    toast.success("บันทึกการตั้งค่าสติกเกอร์แล้ว");
  }

  async function resetData() {
    await fetch("/api/report-task/tasks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "RESET_ALL_DATA" }),
    }).catch(() => {});
    window.location.reload();
  }

  function handleAdd() {
    if (!newEmoji.trim() || !newLabel.trim()) return;
    setDraftStickers((list) => [...list, { id: `stk-${uuid()}`, emoji: newEmoji.trim(), label: newLabel.trim(), points: newPoints }]);
    setNewEmoji("");
    setNewLabel("");
    setNewPoints(0);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">จัดการสติกเกอร์</h2>
        <p className="text-sm text-[var(--ink-soft)] mt-0.5">
          สติกเกอร์ใช้ติดบนงานเพื่อให้คะแนนบวก/ลบ เช่น &quot;หัวร้อน -5&quot; เมื่อลูกทีมไม่ทำงานตามกำหนด แก้ไขอิโมจิ ชื่อ หรือคะแนนได้ตามต้องการ
        </p>
      </div>

      <div className="space-y-2">
        {draftStickers.map((s) => (
          <div key={s.id} className="flex items-center gap-2 rounded-lg border border-[var(--line)] p-2.5">
            <Input
              value={s.emoji}
              onChange={(e) => updateDraftSticker(s.id, { emoji: e.target.value })}
              className="w-14 text-center text-lg"
              maxLength={4}
            />
            <Input
              value={s.label}
              onChange={(e) => updateDraftSticker(s.id, { label: e.target.value })}
              className="flex-1"
            />
            <Input
              type="number"
              value={s.points}
              onChange={(e) => updateDraftSticker(s.id, { points: Number(e.target.value) })}
              className={cn("w-20 tabular-nums", s.points < 0 ? "text-[var(--chart-red)]" : s.points > 0 ? "text-[var(--brand-green-dark)]" : "")}
            />
            <Button variant="ghost" size="icon" onClick={() => removeDraftSticker(s.id)} aria-label={`ลบสติกเกอร์ ${s.label}`}>
              <Trash2 className="h-4 w-4 text-[var(--ink-soft)]" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--line)] p-2.5">
        <Input
          value={newEmoji}
          onChange={(e) => setNewEmoji(e.target.value)}
          placeholder="🙂"
          className="w-14 text-center text-lg"
          maxLength={4}
        />
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="ชื่อสติกเกอร์ใหม่"
          className="flex-1"
        />
        <Input
          type="number"
          value={newPoints}
          onChange={(e) => setNewPoints(Number(e.target.value))}
          className="w-20"
        />
        <Button variant="outline" size="icon" onClick={handleAdd} aria-label="เพิ่มสติกเกอร์">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Missed-deadline dock is a separate mechanism from stickers (a case-by-case
          status), but its default lives here alongside the scoring config. */}
      <div className="rounded-lg border border-[var(--line)] p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="h-7 w-7 rounded-lg bg-red-50 text-[var(--chart-red)] flex items-center justify-center shrink-0">
            <AlarmClockOff className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">การหักคะแนนงานเลยกำหนด</p>
            <p className="text-[11px] text-[var(--ink-soft)]">ค่าเริ่มต้นที่จะหักเมื่อกดจากการ์ดหรือในงาน (ปรับต่อชิ้นได้ตอนหัก)</p>
          </div>
        </div>
        <div className="flex items-center gap-2 pl-9">
          <label className="text-xs text-[var(--ink-soft)]">หักครั้งละ</label>
          <span className="text-[var(--chart-red)] font-semibold">−</span>
          <Input
            type="number"
            min={1}
            value={draftDefaultPoints}
            onChange={(e) => setDraftDefaultPoints(Number(e.target.value))}
            className="w-20 tabular-nums text-[var(--chart-red)]"
          />
          <span className="text-xs text-[var(--ink-soft)]">คะแนน</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--bg-soft)] px-3 py-2.5">
        <p className="text-[11px] text-[var(--ink-soft)]">ล้างข้อมูลงานทั้งหมด คืนค่าเป็นชุดตัวอย่าง</p>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 text-[var(--chart-red)] border-red-200 hover:bg-red-50"
          onClick={() => setConfirmResetOpen(true)}
        >
          ล้างข้อมูลที่บันทึก
        </Button>
      </div>

      <Button onClick={save}>
        <Save className="h-4 w-4" /> บันทึก
      </Button>

      <AlertDialog open={confirmResetOpen} onOpenChange={setConfirmResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ล้างข้อมูลที่บันทึกไว้ทั้งหมด?</AlertDialogTitle>
            <AlertDialogDescription>
              ล้างงานทั้งหมดแล้วคืนค่าเป็นชุดตัวอย่าง — ย้อนกลับไม่ได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--chart-red)] hover:bg-red-700 text-white"
              onClick={resetData}
            >
              ล้างข้อมูล
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
