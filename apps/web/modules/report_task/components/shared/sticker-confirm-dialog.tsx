"use client";

import { useState } from "react";
import { Check, User, Users } from "lucide-react";
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
import { cn } from "@/modules/report_task/lib/utils";
import type { Sticker } from "@/modules/report_task/types";

export interface StickerTarget {
  id: string;
  name: string;
}

/**
 * §6 — every sticker send goes through this confirm step first instead of
 * firing on click. Shared across every send point (task card, task detail
 * sheet, escalations panel) so the copy/behavior never drifts between them.
 *
 * งานกลุ่ม (ส่ง \`targets\` มา 2 คนขึ้นไป): ถามก่อนว่าจะส่งให้ "ทั้งกลุ่ม" หรือ "รายคน" (แล้วเลือกชื่อ)
 * ต้องเลือกก่อนถึงกดยืนยันได้ — สติกเกอร์นี้มีผลกับคะแนน (เช่น หัวร้อน -5) จึงไม่เดาให้
 * รายคนเลือกได้หลายคนในครั้งเดียว — onConfirm ได้รายการ id ที่เลือก (รายคน) หรือ undefined (ทั้งกลุ่ม /
 * งานที่ไม่ต้องเลือก) ผู้เรียกติดสติกเกอร์ให้ทีละคนตามรายการ
 */
export function StickerConfirmDialog({
  open,
  onOpenChange,
  sticker,
  recipientName,
  taskTitle,
  /** "งาน" (Kanban's own tasks) or "โพสต์" (a report-feed post gets a
   * scored sticker too now — same set, same confirm step, just different
   * noun so the copy reads right for either sender). */
  itemLabel = "งาน",
  targets,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sticker: Sticker | null;
  recipientName: string;
  taskTitle: string;
  itemLabel?: "งาน" | "โพสต์";
  targets?: StickerTarget[];
  onConfirm: (targetUserIds?: string[]) => void;
}) {
  return (
    <AlertDialog open={open && !!sticker} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {/* key: เปิดใหม่ทุกครั้งเริ่มจากยังไม่ได้เลือก (ไม่จำตัวเลือกครั้งก่อน) */}
        <StickerConfirmBody
          key={open ? "open" : "closed"}
          sticker={sticker}
          recipientName={recipientName}
          taskTitle={taskTitle}
          itemLabel={itemLabel}
          targets={targets}
          onConfirm={onConfirm}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function StickerConfirmBody({
  sticker,
  recipientName,
  taskTitle,
  itemLabel,
  targets,
  onConfirm,
}: {
  sticker: Sticker | null;
  recipientName: string;
  taskTitle: string;
  itemLabel: "งาน" | "โพสต์";
  targets?: StickerTarget[];
  onConfirm: (targetUserIds?: string[]) => void;
}) {
  const hasChoice = (targets?.length ?? 0) > 1;
  const [mode, setMode] = useState<"all" | "one" | null>(null);
  const [personIds, setPersonIds] = useState<string[]>([]);

  const picked = (targets ?? []).filter((t) => personIds.includes(t.id));
  // 1 คน = ชื่อ, 2-3 คน = ชื่อคั่นด้วยจุลภาค, มากกว่านั้น = ย่อ "และอีก N คน"
  const pickedLabel =
    picked.length <= 3 ? picked.map((p) => p.name).join(", ") : `${picked.slice(0, 2).map((p) => p.name).join(", ")} และอีก ${picked.length - 2} คน`;
  const recipient = !hasChoice ? recipientName : mode === "all" ? "ทั้งกลุ่ม" : mode === "one" && picked.length > 0 ? pickedLabel : "…";
  const canConfirm = !hasChoice || mode === "all" || (mode === "one" && picked.length > 0);
  const togglePerson = (id: string) => setPersonIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2">
          <span className="text-xl">{sticker?.emoji}</span> ส่งสติกเกอร์
        </AlertDialogTitle>
        <AlertDialogDescription>
          ส่ง &ldquo;{sticker?.emoji} {sticker?.label}&rdquo; ให้ <span className="font-medium text-[var(--ink)]">{recipient}</span> สำหรับ{itemLabel}
          &ldquo;{taskTitle}&rdquo;?
          {!!sticker && sticker.points !== 0 && (
            <span className="block mt-2 text-[var(--chart-red-dark)]">
              สติกเกอร์นี้จะบันทึกลงประวัติงาน และ
              {sticker.points < 0 ? `หักคะแนน ${Math.abs(sticker.points)} แต้ม` : `ให้คะแนน +${sticker.points} แต้ม`}
              {hasChoice
                ? mode === "one" && picked.length > 0
                  ? picked.length > 1
                    ? ` ให้แต่ละคน: ${pickedLabel}`
                    : `ของ ${pickedLabel}`
                  : mode === "all"
                    ? "ของทุกคนในกลุ่ม"
                    : "ของผู้ที่เลือก"
                : "ของผู้รับผิดชอบ"}
            </span>
          )}
        </AlertDialogDescription>
      </AlertDialogHeader>

      {hasChoice && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-[var(--ink-soft)]">งานกลุ่ม — ส่งให้ใคร?</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ChoiceButton
              selected={mode === "all"}
              onClick={() => {
                setMode("all");
                setPersonIds([]);
              }}
              icon={<Users className="h-4 w-4" />}
              title="ทั้งกลุ่ม"
              sub={`ทุกคน ${targets!.length} คน`}
            />
            <ChoiceButton
              selected={mode === "one"}
              onClick={() => setMode("one")}
              icon={<User className="h-4 w-4" />}
              title="รายคน"
              sub={mode === "one" && picked.length > 0 ? `เลือกแล้ว ${picked.length} คน` : "เลือกได้หลายคน"}
            />
          </div>
          {mode === "one" && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="เลือกคน (เลือกได้หลายคน)">
              {targets!.map((t) => {
                const on = personIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => togglePerson(t.id)}
                    className={cn(
                      "inline-flex max-w-full items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      on
                        ? "border-[var(--brand-green)] bg-[var(--accent)] text-[var(--brand-green-dark)]"
                        : "border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--brand-green)]"
                    )}
                  >
                    {on && <Check className="h-3 w-3 shrink-0" />}
                    <span className="truncate">{t.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <AlertDialogFooter>
        <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
        <AlertDialogAction disabled={!canConfirm} onClick={() => onConfirm(mode === "one" ? picked.map((p) => p.id) : undefined)}>
          ยืนยันส่ง
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}

function ChoiceButton({
  selected,
  onClick,
  icon,
  title,
  sub,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
        selected ? "border-[var(--brand-green)] bg-[var(--accent)]" : "border-[var(--line)] bg-white hover:border-[var(--brand-green)]"
      )}
    >
      <span className={cn("shrink-0", selected ? "text-[var(--brand-green-dark)]" : "text-[var(--ink-soft)]")}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--ink)]">{title}</span>
        <span className="block text-[11px] text-[var(--ink-soft)]">{sub}</span>
      </span>
    </button>
  );
}
