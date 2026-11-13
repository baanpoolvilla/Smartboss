"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { SlidersHorizontal, X } from "lucide-react";
import { ASSIGNED_BY_ME, ASSIGNED_TO_ME, UNASSIGNED } from "./person-filter";

/**
 * มือถือ: ตัวกรองบอร์ดใบงานรวมไว้ปุ่มเดียว เปิดเป็นแผ่นจากด้านล่าง (ผู้ใช้ 13/11/2569 เลือกแบบ 1)
 * แบบเดียวกับ Asana / ClickUp — ช่องค้นหาอยู่บนหัวตลอด ค้นไปด้วยเปลี่ยนตัวกรองไปด้วยได้
 * จอใหญ่ไม่ใช้ตัวนี้ ตัวกรองยังเรียงอยู่บนแถบหัวเหมือนเดิม
 */

export function FilterButton({ count, onClick }: { count: number; onClick: () => void }) {
  const active = count > 0;
  return (
    <button
      type="button"
      data-testid="wo-board-filter-open"
      aria-label={active ? `ตัวกรอง (กรองอยู่ ${count} อย่าง)` : "ตัวกรอง"}
      onClick={onClick}
      className={`inline-flex h-9 shrink-0 items-center gap-1 rounded-(--radius) border px-2.5 text-[13px] ${
        active ? "border-(--brand-navy) font-semibold text-(--brand-navy)" : "border-(--line) bg-(--bg) text-(--ink-soft)"
      }`}
    >
      <SlidersHorizontal className="h-4 w-4" />
      กรอง
      {active && (
        <span className="rounded-full bg-(--brand-navy) px-1.5 text-[10px] font-bold leading-4 text-white">{count}</span>
      )}
    </button>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[13px] ${
        on ? "border-(--brand-navy) bg-(--brand-navy) font-semibold text-white" : "border-(--line) bg-(--bg) text-(--ink)"
      }`}
    >
      {children}
    </button>
  );
}

export function FilterSheet({
  open,
  onClose,
  assignee,
  onAssignee,
  people,
  showMine,
  showPeople,
  showUnassigned,
  houseSelect,
  sort,
  onSort,
  resultCount,
  onClearAll,
}: {
  open: boolean;
  onClose: () => void;
  assignee: string | null;
  onAssignee: (v: string | null) => void;
  people: { id: string; name: string }[];
  showMine: boolean;
  showPeople: boolean;
  showUnassigned: boolean;
  /** ช่องเลือกบ้านของบอร์ด (ทุกบ้าน / ทั้งหมวด / รายหลัง) — null = มีบ้านหมวดเดียว ไม่ต้องกรอง */
  houseSelect: ReactNode;
  sort: "due" | "latest";
  onSort: (v: "due" | "latest") => void;
  resultCount: number;
  onClearAll: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  const quick = [ASSIGNED_TO_ME, ASSIGNED_BY_ME, UNASSIGNED];
  const pickedPerson = assignee && !quick.includes(assignee) ? assignee : "";

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end bg-black/40" onClick={onClose} data-testid="wo-board-filter-sheet">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="ตัวกรองใบงาน"
        onClick={(e) => e.stopPropagation()}
        className="grid max-h-[85vh] w-full gap-4 overflow-y-auto rounded-t-2xl bg-(--bg) px-4 pt-2 pb-[max(16px,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-(--line)" aria-hidden="true" />
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-(--ink)">ตัวกรอง</h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onClearAll} className="rounded px-2 py-1 text-sm text-(--ink-soft) hover:text-(--ink)">
              ล้างทั้งหมด
            </button>
            <button type="button" aria-label="ปิด" onClick={onClose} className="rounded p-1 text-(--ink-soft) hover:text-(--ink)">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {(showMine || showPeople) && (
        <section className="grid gap-2">
          <h3 className="text-xs font-semibold text-(--ink-soft)">ผู้รับผิดชอบ</h3>
          <div className="flex flex-wrap gap-2">
            <Chip on={assignee === null} onClick={() => onAssignee(null)}>ทุกคน</Chip>
            {showMine && (
              <>
                <Chip on={assignee === ASSIGNED_TO_ME} onClick={() => onAssignee(ASSIGNED_TO_ME)}>งานที่ฉันได้รับ</Chip>
                <Chip on={assignee === ASSIGNED_BY_ME} onClick={() => onAssignee(ASSIGNED_BY_ME)}>ฉันมอบหมาย</Chip>
              </>
            )}
            {showPeople && showUnassigned && (
              <Chip on={assignee === UNASSIGNED} onClick={() => onAssignee(UNASSIGNED)}>ยังไม่มอบหมาย</Chip>
            )}
          </div>
          {showPeople && people.length > 0 && (
            <label className="relative flex h-10 items-center rounded-(--radius) border border-(--line) bg-(--bg) pl-3 pr-8 text-sm">
              <select
                aria-label="เลือกคน"
                value={pickedPerson}
                onChange={(e) => onAssignee(e.target.value || null)}
                className={`w-full appearance-none bg-transparent outline-none ${pickedPerson ? "font-semibold text-(--brand-navy)" : "text-(--ink-soft)"}`}
              >
                <option value="">เลือกดูทีละคน</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 text-(--ink-soft)" aria-hidden="true">▾</span>
            </label>
          )}
        </section>
        )}

        {houseSelect && (
          <section className="grid gap-2">
            <h3 className="text-xs font-semibold text-(--ink-soft)">บ้าน</h3>
            {houseSelect}
          </section>
        )}

        <section className="grid gap-2">
          <h3 className="text-xs font-semibold text-(--ink-soft)">เรียงตาม</h3>
          <div className="flex flex-wrap gap-2">
            <Chip on={sort === "due"} onClick={() => onSort("due")}>ใกล้ครบกำหนด</Chip>
            <Chip on={sort === "latest"} onClick={() => onSort("latest")}>ล่าสุด</Chip>
          </div>
        </section>

        <button
          type="button"
          onClick={onClose}
          data-testid="wo-board-filter-apply"
          className="h-11 rounded-(--radius) bg-(--brand-navy) text-sm font-semibold text-white"
        >
          ดูผล {resultCount} ใบ
        </button>
      </div>
    </div>,
    document.body,
  );
}
