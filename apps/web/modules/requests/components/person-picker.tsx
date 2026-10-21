"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";

export interface PickItem {
  id: string;
  name: string;
  /** บรรทัดรอง — แยกคนชื่อซ้ำ (แผนก · บทบาท · อีเมล) */
  sub: string;
  /** ป้ายเล็กหลังชื่อ เช่น "คนงาน" */
  badge?: string;
  /** คำที่ค้นได้เพิ่ม (อีเมล รหัส) */
  keywords?: string;
}

const MAX_SHOWN = 30;

/** ไทย/อังกฤษ ตัวเล็ก ไม่สนช่องว่าง — "กาย it" เจอ "กาย-IT" */
const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.()]/g, "");

/**
 * ช่องเลือกคนแบบพิมพ์ค้นหา — พิมพ์ไม่กี่ตัวแล้วเลือกจากรายการที่ขึ้นมา (ผู้ใช้ 21/10/2569)
 * รองรับพนักงานเยอะ: แสดงทีละไม่เกิน 30 คน บอกให้พิมพ์เพิ่มถ้ามีมากกว่านั้น · ชื่อซ้ำแยกด้วยบรรทัดรอง
 * แป้นพิมพ์: ↑ ↓ เลือก · Enter ยืนยัน · Esc ปิด
 */
export function PersonPicker({
  label,
  items,
  value,
  onChange,
  placeholder = "พิมพ์ชื่อ แผนก หรืออีเมล",
  hint,
  emptyText = "ไม่พบชื่อนี้",
  allowClear = false,
}: {
  label: string;
  items: PickItem[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  hint?: string;
  emptyText?: string;
  /** ช่องไม่บังคับ — มีปุ่ม "เอาออก" */
  allowClear?: boolean;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const picked = items.find((i) => i.id === value) ?? null;
  // ชื่อเดียวกันมีมากกว่าหนึ่งคน — ขึ้นป้ายเตือนให้ดูบรรทัดรอง
  const dupNames = useMemo(() => {
    const c = new Map<string, number>();
    for (const i of items) c.set(norm(i.name), (c.get(norm(i.name)) ?? 0) + 1);
    return c;
  }, [items]);

  const matches = useMemo(() => {
    const n = norm(q);
    if (!n) return items;
    const hit = items.filter((i) => norm(`${i.name} ${i.sub} ${i.keywords ?? ""}`).includes(n));
    // ชื่อขึ้นต้นด้วยคำที่พิมพ์ขึ้นก่อน
    return hit.sort((a, b) => Number(!norm(a.name).startsWith(n)) - Number(!norm(b.name).startsWith(n)));
  }, [items, q]);
  const shown = matches.slice(0, MAX_SHOWN);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(item: PickItem) {
    onChange(item.id);
    setQ("");
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && shown[active]) {
        e.preventDefault();
        choose(shown[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className="relative flex flex-col gap-1.5 text-sm">
      <label htmlFor={id} className="font-semibold text-(--ink)">{label}</label>
      <div className="relative">
      {picked && !open ? (
        <div className="flex min-h-11 items-center justify-between gap-2 rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-1.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-semibold text-(--ink)">{picked.name}</span>
              {picked.badge && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-900">{picked.badge}</span>}
            </div>
            {picked.sub && <div className="truncate text-xs text-(--ink-soft)">{picked.sub}</div>}
          </div>
          <div className="flex shrink-0 items-center">
            {allowClear && (
              <button type="button" className="rounded-full px-2.5 py-1 text-xs font-medium text-(--ink-soft) hover:bg-(--bg-soft)" onClick={() => onChange("")}>
                เอาออก
              </button>
            )}
            <button
              type="button"
              className="rounded-full px-2.5 py-1 text-xs font-medium text-(--app-strong) hover:bg-(--bg-soft)"
              onClick={() => {
                setOpen(true);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
            >
              เปลี่ยน
            </button>
          </div>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)" aria-hidden="true" />
          <input
            ref={inputRef}
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            autoComplete="off"
            value={q}
            placeholder={placeholder}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKey}
            className="h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) pl-9 pr-9 text-sm text-(--ink) focus-visible:border-(--app) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--app)/25"
          />
          {picked && (
            <button type="button" aria-label="ปิดการค้นหา" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-(--ink-soft) hover:bg-(--bg-soft)" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      {open && (
        <ul ref={listRef} id={`${id}-list`} role="listbox" className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-80 overflow-y-auto rounded-(--radius) border border-(--line) bg-(--bg) py-1 shadow-(--shadow-pop)">
          {shown.length === 0 && <li className="px-3 py-3 text-sm text-(--ink-soft)">{emptyText}</li>}
          {shown.map((item, i) => {
            const dup = (dupNames.get(norm(item.name)) ?? 0) > 1;
            return (
              <li
                key={item.id}
                data-idx={i}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(item);
                }}
                className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 ${i === active ? "bg-slate-100" : ""} ${item.id === value ? "font-semibold" : ""}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm text-(--ink)">{item.name}</span>
                    {item.badge && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-900">{item.badge}</span>}
                    {dup && <span className="shrink-0 rounded-full bg-red-100 px-1.5 text-[11px] font-semibold text-red-800">ชื่อซ้ำ ดูบรรทัดล่าง</span>}
                  </div>
                  {item.sub && <div className="truncate text-xs text-(--ink-soft)">{item.sub}</div>}
                </div>
              </li>
            );
          })}
          {matches.length > MAX_SHOWN && (
            <li className="border-t border-(--line) px-3 py-2 text-xs text-(--ink-soft)">อีก {matches.length - MAX_SHOWN} คน — พิมพ์เพิ่มเพื่อให้แคบลง</li>
          )}
        </ul>
      )}
      </div>
      {hint && <span className="text-xs text-(--ink-soft)">{hint}</span>}
    </div>
  );
}
