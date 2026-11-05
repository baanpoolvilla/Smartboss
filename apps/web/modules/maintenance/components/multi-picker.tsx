"use client";

import { useRef, useState } from "react";
import { Check, ChevronDown, Plus, Search, UserPlus, X } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "./dialog";

/** รายการเกินเท่านี้ถึงมีช่องค้นหา */
const SEARCH_FROM = 8;

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

  // รายชื่อยาวต้องค้นได้ ไม่งั้นเลื่อนหาลำบาก (ผู้ใช้ 5/11/2569 "คนเป็นร้อย เลื่อนหากันตายเลย")
  const [query, setQuery] = useState("");
  const showSearch = boxed && options.filter((o) => !exclude.includes(o.id)).length > SEARCH_FROM;
  const q = query.trim().toLowerCase();

  const openPicker = () => {
    setDraft(selected);
    setQuery("");
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
            <div className="sticky -top-4 z-10 -mx-1 mb-1 flex flex-col gap-1.5 bg-(--bg) px-1 pb-1.5 pt-1">
              {showSearch && (
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)" aria-hidden="true" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    // หน้าต่างอยู่ในฟอร์ม Enter ต้องไม่ส่งฟอร์มสร้างใบ
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.preventDefault();
                    }}
                    placeholder="พิมพ์เพื่อค้นหา"
                    aria-label="ค้นหาในรายชื่อ"
                    data-testid="picker-search"
                    className="h-10 w-full rounded-(--radius) border border-(--line) bg-(--bg) pl-9 pr-3 text-base text-(--ink) outline-none focus:border-(--app) sm:text-sm"
                  />
                </label>
              )}
              <p className="text-xs font-semibold text-(--ink)" data-testid="picker-count">เลือกแล้ว {draft.length}</p>
            </div>
          )}
          <div className="flex flex-col">
            {options
              .filter((o) => !exclude.includes(o.id))
              .filter((o) => !q || `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(q))
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
            {q && !options.some((o) => !exclude.includes(o.id) && `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(q)) && (
              <p className="py-6 text-center text-sm text-(--ink-soft)">ไม่พบ &quot;{query.trim()}&quot;</p>
            )}
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
  /** ผู้ที่มอบหมายงานได้ */
  users: PickOption[];
  defaultAssignee?: string;
}) {
  const [assignee, setAssignee] = useState(defaultAssignee);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectRef = useRef<HTMLSelectElement>(null);
  const q = query.trim().toLowerCase();
  const current = users.find((u) => u.id === assignee);
  const matches = users
    .filter((u) => !q || `${u.label} ${u.sub ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => Number(b.id === assignee) - Number(a.id === assignee));
  const openPicker = () => {
    setQuery("");
    setOpen(true);
  };

  return (
    <div className="flex min-w-0 flex-col gap-1" data-wo-field="assignee">
      <span className="text-xs text-(--ink-soft)">ผู้รับผิดชอบ *</span>
      {/* select ตัวจริงยังอยู่ในฟอร์ม ตัวตรวจช่องบังคับ ใบส่วนตัว และ CC อ่านค่าจากตัวนี้ */}
      <select
        ref={selectRef}
        name="assignedTo"
        required
        value={assignee}
        onChange={(e) => setAssignee(e.target.value)}
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
      >
        <option value="" disabled>เลือกคน</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={openPicker}
        data-testid="assignee-field"
        title={current?.label}
        className="flex h-10 w-full items-center justify-between gap-1 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-left text-sm hover:bg-(--bg-soft)"
      >
        <span className={`truncate ${current ? "text-(--ink)" : "text-(--ink-soft)"}`}>{current?.label ?? "เลือกคน"}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-(--ink-soft)" aria-hidden="true" />
      </button>

      {open && (
        <Modal
          title="เลือกผู้รับผิดชอบ"
          onClose={() => setOpen(false)}
          actions={
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
          }
        >
          {users.length > SEARCH_FROM && (
            <div className="sticky -top-4 z-10 -mx-1 mb-1 bg-(--bg) px-1 pb-1.5 pt-1">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)" aria-hidden="true" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                  placeholder="พิมพ์เพื่อค้นหา"
                  aria-label="ค้นหาในรายชื่อ"
                  data-testid="picker-search"
                  className="h-10 w-full rounded-(--radius) border border-(--line) bg-(--bg) pl-9 pr-3 text-base text-(--ink) outline-none focus:border-(--app) sm:text-sm"
                />
              </label>
            </div>
          )}
          <div className="flex flex-col">
            {matches.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  setAssignee(u.id);
                  setOpen(false);
                  // CC ในตัวเลือกขั้นสูงฟังค่าจากฟอร์ม — ตั้งค่าด้วย state ไม่เกิด change เอง
                  requestAnimationFrame(() => selectRef.current?.dispatchEvent(new Event("change", { bubbles: true })));
                }}
                className="flex items-center justify-between gap-3 border-b border-(--line) py-2.5 text-left text-sm last:border-0"
              >
                <span className="min-w-0">
                  <span className="block text-(--ink)">{u.label}</span>
                  {u.sub && <span className="block text-xs text-(--ink-soft)">{u.sub}</span>}
                </span>
                {u.id === assignee && <Check className="h-4 w-4 shrink-0 text-(--brand-navy)" aria-label="เลือกอยู่" />}
              </button>
            ))}
            {matches.length === 0 && <p className="py-6 text-center text-sm text-(--ink-soft)">ไม่พบ &quot;{query.trim()}&quot;</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
