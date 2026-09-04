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
import { useProjectTopicStore } from "@/modules/report_task/store/project-topic-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { colorPalette } from "@/modules/report_task/store/event-color-store";
import { chartColors } from "@/modules/report_task/lib/chart-colors";
import type { ProjectTopic } from "@/modules/report_task/types";
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
          {colorPalette.map((c) => (
            <button
              key={c.value}
              onClick={() => onChange(c.value)}
              className="h-7 w-7 rounded-md flex items-center justify-center ring-1 ring-black/5 hover:scale-110 transition-transform"
              style={{ backgroundColor: c.value }}
              title={c.name}
              aria-label={c.name}
            >
              {value === c.value && <Check className="h-4 w-4 text-white" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Manage project topics — rename/set color/delete, on top of the quick
 * "+ สร้างหัวข้อใหม่" creator already in new-task-dialog.tsx (that one stays;
 * this is for cleanup/upkeep once topics pile up). Deleting a topic here
 * clears `projectTopicId` off any task that still points to it, instead of
 * leaving tasks referencing a topic that no longer exists (they'd silently
 * vanish from the per-person topic board otherwise — see person-topics-board.tsx).
 */
export function ProjectTopicSettingsPanel() {
  const storedTopics = useProjectTopicStore((s) => s.topics);
  const setTopics = useProjectTopicStore((s) => s.setTopics);
  const [draft, setDraft] = useState<ProjectTopic[]>(storedTopics);
  const [newLabel, setNewLabel] = useState("");
  const [removeTarget, setRemoveTarget] = useState<ProjectTopic | null>(null);

  function updateDraft(id: string, patch: Partial<Omit<ProjectTopic, "id">>) {
    setDraft((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function removeDraft(id: string) {
    setDraft((d) => d.filter((x) => x.id !== id));
  }

  function add() {
    const name = newLabel.trim();
    if (!name) return;
    setDraft((d) => [...d, { id: `topic-${uuid()}`, name, color: chartColors.blue }]);
    setNewLabel("");
  }

  function save() {
    const keptIds = new Set(draft.map((t) => t.id));
    const removedIds = storedTopics.filter((t) => !keptIds.has(t.id)).map((t) => t.id);
    if (removedIds.length > 0) {
      useTaskStore.setState((s) => ({
        tasks: s.tasks.map((t) =>
          t.projectTopicId && removedIds.includes(t.projectTopicId) ? { ...t, projectTopicId: undefined } : t
        ),
      }));
    }
    setTopics(draft);
    toast.success("บันทึกหัวข้อโปรเจคแล้ว");
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">จัดการหัวข้อโปรเจค</h2>
        <p className="text-sm text-[var(--ink-soft)] mt-0.5">
          เปลี่ยนชื่อ ตั้งสี หรือลบหัวข้อโปรเจคได้ที่นี่ (สร้างหัวข้อใหม่แบบเร็วๆ ระหว่างสร้างงานก็ยังทำได้เหมือนเดิม)
          — ลบหัวข้อไหน งานที่เคยติดหัวข้อนั้นจะกลายเป็น &ldquo;ไม่ระบุหัวข้อโปรเจค&rdquo; แทน ไม่ได้ถูกลบไปด้วย —
          กด บันทึก เพื่อยืนยันการเปลี่ยนแปลง
        </p>
      </div>

      {draft.length === 0 && (
        <p className="text-sm text-[var(--ink-soft)]">ยังไม่มีหัวข้อโปรเจคเลย</p>
      )}

      <div className="space-y-2">
        {draft.map((t) => (
          <div key={t.id} className="flex items-center gap-2 rounded-lg border border-[var(--line)] p-2">
            <ColorPicker value={t.color ?? chartColors.blue} onChange={(color) => updateDraft(t.id, { color })} />
            <Input value={t.name} onChange={(e) => updateDraft(t.id, { name: e.target.value })} className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setRemoveTarget(t)}
              title="ลบ"
              aria-label={`ลบหัวข้อโปรเจค ${t.name}`}
            >
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
          placeholder="ชื่อหัวข้อโปรเจคใหม่"
          className="flex-1"
        />
        <Button variant="outline" size="icon" onClick={add} aria-label="เพิ่มหัวข้อโปรเจค">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <Button onClick={save}>
        <Save className="h-4 w-4" /> บันทึก
      </Button>

      <AlertDialog open={!!removeTarget} onOpenChange={(v) => !v && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบหัวข้อโปรเจค &quot;{removeTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              งานที่เคยติดหัวข้อนี้จะกลายเป็น &quot;ไม่ระบุหัวข้อโปรเจค&quot; แทน (ไม่ได้ถูกลบไปด้วย) —
              ยังไม่มีผลจนกว่าจะกด &quot;บันทึก&quot;
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
