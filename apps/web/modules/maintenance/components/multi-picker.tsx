"use client";

import { useState } from "react";
import { Plus, UserPlus, X } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "./dialog";

export interface PickOption {
  id: string;
  label: string;
  sub?: string;
}

/**
 * เลือกหลายรายการผ่าน dialog + แสดงเป็น Chip ลบได้
 * ตรงกับ _showPropertyPicker / _showCcPicker ของ ChangYai
 */
export function MultiPicker({
  name,
  title,
  heading,
  hint,
  emptyText,
  addLabel,
  options,
  defaultSelected = [],
  exclude = [],
  chipBg = "#EFF6FF",
  icon = "home",
  onChange,
  boxed = false,
}: {
  name: string;
  title: string;
  heading: string;
  hint?: string;
  emptyText: string;
  addLabel: string;
  options: PickOption[];
  defaultSelected?: string[];
  exclude?: string[];
  chipBg?: string;
  icon?: "home" | "user";
  onChange?: (ids: string[]) => void;
  /** ทั้งช่องกดเลือกได้ ไม่มีปุ่มแยก แบบช่องผู้รับผิดชอบของหน้าสร้างงาน (ผู้ใช้ 5/11/2569) — ไม่ส่ง = แบบเดิม */
  boxed?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(defaultSelected);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(defaultSelected);

  const set = (ids: string[]) => {
    setSelected(ids);
    onChange?.(ids);
  };

  const labelOf = (id: string) =>
    options.find((o) => o.id === id)?.label ?? id;

  const openPicker = () => {
    setDraft(selected);
    setOpen(true);
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {boxed ? (
        <>
          <span className="text-xs text-(--ink-soft)">{heading}</span>
          {/* div ไม่ใช่ button — ข้างในมีปุ่มลบของแต่ละชิป ซ้อน button ไม่ได้ */}
          <div
            role="button"
            tabIndex={0}
            onClick={openPicker}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
              e.preventDefault();
              openPicker();
            }}
            title={selected.map(labelOf).join(", ") || undefined}
            className="flex h-10 w-full cursor-pointer items-center gap-1.5 overflow-hidden rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm hover:bg-(--bg-soft) focus-visible:outline-2 focus-visible:outline-(--app)"
          >
            {selected.length === 0 && <span className="text-(--ink-soft)">{emptyText}</span>}
            {/* สูงเท่าเดิมเสมอ (ผู้ใช้ 5/11/2569 "มันไม่รกเลยหรอ") — ชื่อแรก + จำนวนที่เหลือ กดช่องเพื่อดูครบ */}
            {selected.slice(0, 1).map((id) => (
              <span
                key={id}
                className="inline-flex min-w-0 items-center gap-1 rounded-[10px] border border-(--line) px-2 py-0.5 text-xs text-(--ink)"
                style={{ backgroundColor: chipBg }}
              >
                <span className="truncate">{labelOf(id)}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    set(selected.filter((x) => x !== id));
                  }}
                  aria-label={`เอา ${labelOf(id)} ออก`}
                  className="shrink-0 text-[#EF5350]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {selected.length > 1 && (
              <span className="shrink-0 text-xs font-semibold text-(--ink-soft)" data-testid="picker-more">+{selected.length - 1}</span>
            )}
          </div>
        </>
      ) : (
        <>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-(--ink)">{heading}</span>
        <button
          type="button"
          onClick={() => {
            setDraft(selected);
            setOpen(true);
          }}
          className="ml-auto inline-flex items-center gap-1 rounded-(--radius) px-2 py-1 text-sm text-[#0F766E] hover:bg-(--bg-soft)"
        >
          {icon === "home" ? (
            <Plus className="h-4 w-4" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          {addLabel}
        </button>
      </div>

      {selected.length === 0 ? (
        <button
          type="button"
          onClick={() => {
            setDraft(selected);
            setOpen(true);
          }}
          className="py-2 text-left text-[13px] text-(--ink-soft)"
        >
          {emptyText}
        </button>
      ) : (
        <div className="flex flex-wrap gap-2 py-1">
          {selected.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-[10px] border border-(--line) px-2 py-1 text-xs text-(--ink)"
              style={{ backgroundColor: chipBg }}
            >
              {labelOf(id)}
              <button
                type="button"
                onClick={() => set(selected.filter((x) => x !== id))}
                aria-label="ลบ"
                className="text-[#EF5350]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="border-b border-(--line) pt-1" />
        </>
      )}

      {selected.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}

      {open && (
        <Modal
          title={title}
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  set(draft.filter((id) => !exclude.includes(id)));
                  setOpen(false);
                }}
              >
                ตกลง
              </Button>
            </>
          }
        >
          {hint && (
            <p className="mb-2 text-xs text-(--ink-soft)">{hint}</p>
          )}
          {boxed && (
            <p className="mb-1 text-xs font-semibold text-(--ink)" data-testid="picker-count">เลือกแล้ว {draft.length}</p>
          )}
          <div className="flex flex-col">
            {options
              .filter((o) => !exclude.includes(o.id))
              // คนที่เลือกไว้ขึ้นบนสุด กด +2 แล้วเห็นเลย (ผู้ใช้ 5/11/2569) · เรียงจากค่าตอนเปิด ติ๊กออกระหว่างดูแถวจะได้ไม่กระโดด
              .sort((a, b) => (boxed ? Number(selected.includes(b.id)) - Number(selected.includes(a.id)) : 0))
              .map((o) => (
                <label
                  key={o.id}
                  className="flex items-center gap-3 border-b border-(--line) py-2.5 text-sm last:border-0"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={draft.includes(o.id)}
                    onChange={(e) =>
                      setDraft(
                        e.target.checked
                          ? [...draft, o.id]
                          : draft.filter((x) => x !== o.id)
                      )
                    }
                  />
                  <span className="min-w-0">
                    <span className="block text-(--ink)">{o.label}</span>
                    {o.sub && (
                      <span className="block text-xs text-(--ink-soft)">
                        {o.sub}
                      </span>
                    )}
                  </span>
                </label>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

/** ฟอร์มสร้างใบงาน: ผู้รับผิดชอบหลัก + CC ที่ตัดคนซ้ำกันออกให้ (เหมือนของเดิม) */
export function AssigneeAndCc({
  users,
  defaultAssignee = "",
}: {
  /** ผู้ที่มอบหมายงานได้ (ผู้ดูแลบ้านเห็นเฉพาะช่าง/ผู้ดูแลบ้าน) */
  users: PickOption[];
  defaultAssignee?: string;
}) {
  const [assignee, setAssignee] = useState(defaultAssignee);

  return (
    <>
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-xs text-(--ink-soft)">
          ผู้รับผิดชอบ *
        </span>
        {/* ต้องมีผู้รับผิดชอบทุกใบ (ผู้ใช้ 2/11/2569 "ไม่มีผู้รับผิดชอบจะรู้ได้ไงว่าของใคร") */}
        <select
          name="assignedTo"
          required
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className="flex h-10 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink) focus-visible:border-(--brand-green) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/30"
        >
          <option value="" disabled>เลือกคน</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.sub ? `${u.label} (${u.sub})` : u.label}
            </option>
          ))}
        </select>
      </label>

      
    </>
  );
}
