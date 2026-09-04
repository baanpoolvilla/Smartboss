"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
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
import { Button } from "@/modules/report_task/components/ui/button";
import { Input } from "@/modules/report_task/components/ui/input";
import { useReportTagStore, type ReportTag } from "@/modules/report_task/store/report-tag-store";
import { topicColors } from "@/modules/report_task/store/report-feed-store";
import { Plus, Trash2, Check, Save } from "lucide-react";
import { toast } from "sonner";
import { uuid } from "@/modules/report_task/lib/uuid";

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button className="h-9 w-9 rounded-md border border-[var(--line)] flex items-center justify-center hover:bg-[var(--bg-soft)]" title="เลือกสี" aria-label="เลือกสี">
            <span className="h-4 w-4 rounded-full" style={{ backgroundColor: value }} />
          </button>
        }
      />
      <PopoverContent align="start" className="w-auto p-2">
        <div className="grid grid-cols-4 gap-1.5">
          {topicColors.map((c) => (
            <button
              key={c}
              onClick={() => onChange(c)}
              className="h-7 w-7 rounded-md flex items-center justify-center ring-1 ring-black/5 hover:scale-110 transition-transform"
              style={{ backgroundColor: c }}
              aria-label={c}
            >
              {value === c && <Check className="h-4 w-4 text-white" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Manage report tags — rename/set color/delete, on top of the quick
 * "+ สร้างแท็กใหม่" creator already in tag-picker-button.tsx (that one stays;
 * this is for cleanup once tags pile up — the picker and filter dropdown had
 * no delete affordance at all before this). Deleting a tag here doesn't touch
 * any post's `tagIds` — a post referencing a since-deleted id just silently
 * drops that chip (ReportCard/report-tag-chip.tsx only render tags that still
 * exist in the store), so nothing needs cleaning up on that side.
 */
export function ReportTagSettingsPanel() {
  const storedTags = useReportTagStore((s) => s.tags);
  const setTags = useReportTagStore((s) => s.setTags);
  const [draft, setDraft] = useState<ReportTag[]>(storedTags);
  const [newLabel, setNewLabel] = useState("");
  const [removeTarget, setRemoveTarget] = useState<ReportTag | null>(null);

  function updateDraft(id: string, patch: Partial<Omit<ReportTag, "id">>) {
    setDraft((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function removeDraft(id: string) {
    setDraft((d) => d.filter((x) => x.id !== id));
  }

  function add() {
    const name = newLabel.trim();
    if (!name) return;
    setDraft((d) => [...d, { id: `rtag-${uuid()}`, name, color: topicColors[d.length % topicColors.length]! }]);
    setNewLabel("");
  }

  function save() {
    setTags(draft);
    toast.success("บันทึกแท็กแล้ว");
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">จัดการแท็ก</h2>
        <p className="text-sm text-[var(--ink-soft)] mt-0.5">
          เปลี่ยนชื่อ ตั้งสี หรือลบแท็กที่ใช้ติดโพสต์รายงานได้ที่นี่ (สร้างแท็กใหม่แบบเร็วๆ ตอนโพสต์ก็ยังทำได้เหมือนเดิม)
          — ลบแท็กไหน โพสต์ที่เคยติดแท็กนั้นจะแค่หายจากป้ายแท็ก ไม่ได้ถูกลบโพสต์ไปด้วย —
          กด บันทึก เพื่อยืนยันการเปลี่ยนแปลง
        </p>
      </div>

      {draft.length === 0 && <p className="text-sm text-[var(--ink-soft)]">ยังไม่มีแท็กเลย</p>}

      <div className="space-y-2">
        {draft.map((t) => (
          <div key={t.id} className="flex items-center gap-2 rounded-lg border border-[var(--line)] p-2">
            <ColorPicker value={t.color} onChange={(color) => updateDraft(t.id, { color })} />
            <Input value={t.name} onChange={(e) => updateDraft(t.id, { name: e.target.value })} className="flex-1" />
            <Button variant="ghost" size="icon" onClick={() => setRemoveTarget(t)} title="ลบ" aria-label={`ลบแท็ก ${t.name}`}>
              <Trash2 className="h-4 w-4 text-[var(--ink-soft)]" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--line)] p-2">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="ชื่อแท็กใหม่"
          className="flex-1"
        />
        <Button variant="outline" size="icon" onClick={add} aria-label="เพิ่มแท็ก">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <Button onClick={save}>
        <Save className="h-4 w-4" /> บันทึก
      </Button>

      <AlertDialog open={!!removeTarget} onOpenChange={(v) => !v && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบแท็ก &quot;{removeTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              โพสต์ที่เคยติดแท็กนี้จะแค่หายจากป้ายแท็ก (ไม่ได้ถูกลบโพสต์ไปด้วย) — ยังไม่มีผลจนกว่าจะกด &quot;บันทึก&quot;
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--chart-red)] hover:bg-red-700 text-white"
              onClick={() => {
                if (removeTarget) removeDraft(removeTarget.id);
                setRemoveTarget(null);
              }}
            >
              ลบ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
