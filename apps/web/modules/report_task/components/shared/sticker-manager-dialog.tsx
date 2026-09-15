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
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { useStickerStore } from "@/modules/report_task/store/sticker-store";
import { usePenaltySettingsStore } from "@/modules/report_task/store/penalty-settings-store";
import type { Sticker } from "@/modules/report_task/types";
import { AlarmClockOff, Plus, Save, Trash2 } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";
import { toast } from "sonner";
import { uuid } from "@/modules/report_task/lib/uuid";
import { notifyStickerChange } from "@/modules/report_task/lib/notify-sticker-change";

// แต่ก่อนช่องอิโมจิเป็นกล่องพิมพ์เฉยๆ — คนใช้งานไม่รู้จะพิมพ์อิโมจิยังไง
// ("เวลาใส่อิโมจิละ ใส่ยังไง") ต้องรู้ทางลัดของเครื่องเอง (Win+. บนวินโดวส์)
// ถึงจะพิมพ์ได้ เลยมีชุดให้กดเลือกตรงๆ แทน (ยังพิมพ์/วางเองได้อยู่ด้านล่าง
// ถ้าอยากได้แบบอื่นนอกชุดนี้). คละทั้งอารมณ์บวก/ลบเพราะสติกเกอร์คะแนนมีทั้ง
// สองแบบ.
const EMOJI_QUICK_PICKS = [
  "😡", "😠", "🤬", "⚠️", "🚨", "💢", "😤", "😑", "🙄", "😢", "😭", "🥲",
  "👏", "⭐", "🌟", "🏆", "🥇", "🎉", "🚀", "💪", "✅", "👍", "❤️", "🥳",
  "😍", "😎", "🔥", "💡", "🎯", "👌", "🤝", "💯", "👀", "🤔", "😅", "😴",
  "🤯", "👎", "💤", "⏰", "📉", "📈", "🐌", "🦥",
];

/** ปุ่มเลือกอิโมจิแบบกดจิ้มเอา แทนที่ช่องพิมพ์เปล่าๆ ที่ต้องรู้ทางลัดของ
 * เครื่องเอง — ใช้ทั้งแถวสติกเกอร์เดิมและแถวเพิ่มใหม่ */
function EmojiFieldPicker({
  value,
  onChange,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  compact?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex items-center justify-center rounded-md border border-[var(--line)] text-lg hover:bg-[var(--bg-soft)] shrink-0",
              compact ? "h-8 w-10" : "h-9 w-14"
            )}
            aria-label="เลือกอิโมจิ"
            title="เลือกอิโมจิ"
          >
            {value || "🙂"}
          </button>
        }
      />
      <PopoverContent className="w-[252px] p-2 flex flex-col gap-2">
        <div className="flex flex-wrap gap-0.5 max-h-[160px] overflow-y-auto">
          {EMOJI_QUICK_PICKS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onChange(e)}
              className={cn(
                "h-8 w-8 flex items-center justify-center rounded-md text-base hover:bg-[var(--bg-soft)]",
                value === e && "bg-[var(--accent-soft)]"
              )}
            >
              {e}
            </button>
          ))}
        </div>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="หรือพิมพ์/วางอิโมจิเอง"
          className="text-center text-sm"
          maxLength={4}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Sticker rewards + missed-deadline penalty default — company-wide config,
 * lives on the settings page (src/app/settings/page.tsx). Also embedded
 * inline in the report post reaction picker (`compact`) so a lead can add/
 * edit/delete a scored sticker right from the picker itself, not just a
 * stripped-down add-only form ("แก้ได้เลยจากหน้านี้เป็นการแก้แบบเต็มๆเลย
 * ไม่เอาแบบนี้มันน้อยไป") — `compact` just drops the sections that don't
 * make sense squeezed into a popover (intro text, missed-deadline default,
 * the destructive "reset all data" button, which stays settings-page only).
 */
export function StickerManagerPanel({
  viewingAsUserId,
  compact = false,
  onSaved,
}: {
  viewingAsUserId: string;
  compact?: boolean;
  onSaved?: () => void;
}) {
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
    // Diff against the last-loaded list (not draftStickers vs itself) so the
    // whole-company broadcast only fires for what actually changed in this
    // save, not the entire list every time — "แจ้งให้ทั้งบริษัททราบ...ว่าได้
    // เพิ่ม/แก้ไข/ลบ" implies one message per real change, not a spam blast.
    const beforeById = new Map(stickers.map((s) => [s.id, s]));
    const afterIds = new Set(draftStickers.map((s) => s.id));
    for (const before of stickers) {
      if (!afterIds.has(before.id)) notifyStickerChange("removed", before, viewingAsUserId);
    }
    for (const after of draftStickers) {
      const before = beforeById.get(after.id);
      if (!before) {
        notifyStickerChange("added", after, viewingAsUserId);
      } else if (before.emoji !== after.emoji || before.label !== after.label || before.points !== after.points) {
        notifyStickerChange("edited", after, viewingAsUserId);
      }
    }

    setStickers(draftStickers);
    setDefaultPoints(draftDefaultPoints);
    toast.success("บันทึกการตั้งค่าสติกเกอร์แล้ว");
    onSaved?.();
  }

  async function resetData() {
    try {
      const res = await fetch("/api/report-task/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "RESET_ALL_DATA" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? "ล้างข้อมูลไม่สำเร็จ");
        return;
      }
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ลองใหม่อีกครั้ง");
      return;
    }
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
    <div className={compact ? "space-y-2.5" : "space-y-4"}>
      {!compact && (
        <div>
          <h2 className="text-base font-semibold">จัดการสติกเกอร์</h2>
          <p className="text-sm text-[var(--ink-soft)] mt-0.5">
            สติกเกอร์ใช้ติดบนงานเพื่อให้คะแนนบวก/ลบ เช่น &quot;หัวร้อน -5&quot; เมื่อลูกทีมไม่ทำงานตามกำหนด แก้ไขอิโมจิ ชื่อ หรือคะแนนได้ตามต้องการ
          </p>
          {/* ชุดเดียวกันนี้ใช้กับหน้ารายงานด้วยแล้ว — แก้ที่นี่ที่เดียว มีผลทั้ง
              สองที่ ("ใช้ตัวเดียวกันกับ kanban และปรับได้จากหน้าตั้งค่าอันนั้น
              อันเดียวกัน") ระบุขอบเขตให้ชัดว่าใช้ได้เฉพาะโพสต์หลัก ไม่ใช่ทุกที่
              ในหน้ารายงาน กันเข้าใจผิดว่าคอมเมนต์ก็โดนหักคะแนนได้ด้วย ("การตอบ
              คอมเม้นจะไม่มีการหักคะแนนทั้งสิ้น"). */}
          <p className="text-[11px] text-[var(--ink-soft)] mt-1.5 rounded-md bg-[var(--bg-soft)] px-2.5 py-1.5">
            ชุดนี้ใช้ร่วมกับ <b>หน้ารายงาน</b> ด้วย — เฉพาะ CEO/เจ้าของบริษัทติดสติกเกอร์ให้ &ldquo;โพสต์หลัก&rdquo; ได้ (หักคะแนนคนที่โพสต์) ส่วนความคิดเห็นใต้โพสต์ไม่มีสติกเกอร์มีคะแนนให้ติด
          </p>
        </div>
      )}

      <div className={compact ? "space-y-1.5" : "space-y-2"}>
        {draftStickers.map((s) => (
          <div key={s.id} className={cn("flex items-center gap-2 rounded-lg border border-[var(--line)]", compact ? "p-1.5 gap-1.5" : "p-2.5")}>
            <EmojiFieldPicker value={s.emoji} onChange={(v) => updateDraftSticker(s.id, { emoji: v })} compact={compact} />
            <Input
              value={s.label}
              onChange={(e) => updateDraftSticker(s.id, { label: e.target.value })}
              className={cn("flex-1 min-w-0", compact && "px-1.5 text-xs")}
            />
            <Input
              type="number"
              value={s.points}
              onChange={(e) => updateDraftSticker(s.id, { points: Number(e.target.value) })}
              className={cn(
                "tabular-nums",
                compact ? "w-12 px-1 text-xs" : "w-20",
                s.points < 0 ? "text-[var(--chart-red)]" : s.points > 0 ? "text-[var(--brand-green-dark)]" : ""
              )}
            />
            <Button variant="ghost" size="icon" onClick={() => removeDraftSticker(s.id)} aria-label={`ลบสติกเกอร์ ${s.label}`} className={compact ? "h-7 w-7 shrink-0" : "shrink-0"}>
              <Trash2 className="h-4 w-4 text-[var(--ink-soft)]" />
            </Button>
          </div>
        ))}
      </div>

      <div className={cn("flex items-center gap-2 rounded-lg border border-dashed border-[var(--line)]", compact ? "p-1.5 gap-1.5" : "p-2.5")}>
        <EmojiFieldPicker value={newEmoji} onChange={setNewEmoji} compact={compact} />
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="ชื่อสติกเกอร์ใหม่"
          className={cn("flex-1 min-w-0", compact && "px-1.5 text-xs")}
        />
        <Input
          type="number"
          value={newPoints}
          onChange={(e) => setNewPoints(Number(e.target.value))}
          className={compact ? "w-12 px-1 text-xs" : "w-20"}
        />
        <Button variant="outline" size="icon" onClick={handleAdd} aria-label="เพิ่มสติกเกอร์" className={compact ? "h-7 w-7 shrink-0" : "shrink-0"}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Missed-deadline dock is a separate mechanism from stickers (a case-by-case
          status), but its default lives here alongside the scoring config —
          settings-page only, doesn't fit a popover squeeze. */}
      {!compact && (
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
      )}

      {!compact && (
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
      )}

      <Button onClick={save} size={compact ? "sm" : "default"} className={compact ? "w-full" : undefined}>
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
