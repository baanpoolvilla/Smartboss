"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, Search } from "lucide-react";
import { cn } from "@smartboss/ui/cn";

/**
 * ตัวเลือกอิโมจิกลางของทั้งแอป — ชุดมาตรฐาน Unicode ครบทุกหมวด ค้นหาได้ทั้งคำไทยและอังกฤษ
 * (เดิมแต่ละโมดูลมีรายการสั้น ๆ ของตัวเอง 6–20 ตัว ไม่เหมือนกันสักที่)
 *
 * เป็นแค่ "เนื้อหา" — ผู้ใช้เอาไปวางใน Popover/กล่องลอยของตัวเอง และจัดการเปิด/ปิดเอง
 * ข้อมูลมาจาก lib/emoji-data.json (สร้างด้วย scripts/gen-emoji-data.mjs) โหลดเมื่อเปิดครั้งแรกเท่านั้น
 */

type EmojiRow = [emoji: string, keywords: string];
type EmojiData = Record<string, EmojiRow[]>;

/** หมวดตามลำดับของ Unicode — id ตรงกับ group ของ emojibase */
const CATEGORIES: { id: string; icon: string; label: string }[] = [
  { id: "0", icon: "😀", label: "หน้ายิ้มและอารมณ์" },
  { id: "1", icon: "👋", label: "คนและร่างกาย" },
  { id: "3", icon: "🐶", label: "สัตว์และธรรมชาติ" },
  { id: "4", icon: "🍔", label: "อาหารและเครื่องดื่ม" },
  { id: "5", icon: "✈️", label: "การเดินทางและสถานที่" },
  { id: "6", icon: "⚽", label: "กิจกรรม" },
  { id: "7", icon: "💡", label: "สิ่งของ" },
  { id: "8", icon: "❤️", label: "สัญลักษณ์" },
  { id: "9", icon: "🏳️", label: "ธง" },
];

const COLS = 8;
const RECENT_KEY = "sb_emoji_recent_v1";
const RECENT_MAX = 24;
const SEARCH_MAX = 120;

let cache: EmojiData | null = null;
let loading: Promise<EmojiData> | null = null;
function loadEmojiData(): Promise<EmojiData> {
  if (cache) return Promise.resolve(cache);
  loading ??= import("@/lib/emoji-data.json").then((m) => {
    cache = m.default as unknown as EmojiData;
    return cache;
  });
  return loading;
}

function readRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((e): e is string => typeof e === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function pushRecent(emoji: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, RECENT_MAX)));
  } catch {
    // localStorage ใช้ไม่ได้ (โหมดส่วนตัว ฯลฯ) — แค่ไม่จำ "ใช้ล่าสุด"
  }
}

export function EmojiPicker({
  onPick,
  exclude,
  autoFocusSearch = true,
  className,
}: {
  onPick: (emoji: string) => void;
  /** อิโมจิที่ไม่ให้เลือกจากที่นี่ (เช่น สติกเกอร์มีคะแนน ซึ่งมีแถวของตัวเอง) */
  exclude?: readonly string[];
  /** โฟกัสช่องค้นหาทันทีที่เปิด (พิมพ์หาได้เลย) — ปิดบนจอสัมผัสเองอยู่แล้ว ไม่ให้คีย์บอร์ดเด้ง */
  autoFocusSearch?: boolean;
  className?: string;
}) {
  const [data, setData] = useState<EmojiData | null>(cache);
  const [query, setQuery] = useState("");
  // ตัวเลือกนี้ถูกสร้างตอนผู้ใช้กดเปิดเท่านั้น (ฝั่งเบราว์เซอร์) — อ่าน "ใช้ล่าสุด" ได้ตั้งแต่ค่าเริ่มต้น
  const [recent] = useState<string[]>(readRecent);
  const [category, setCategory] = useState<string>(() => (recent.length > 0 ? "recent" : "0"));
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void loadEmojiData().then((d) => alive && setData(d));
    if (autoFocusSearch && !window.matchMedia("(pointer: coarse)").matches) searchRef.current?.focus();
    return () => {
      alive = false;
    };
  }, [autoFocusSearch]);

  const q = query.trim().toLowerCase();
  const all = useMemo<string[]>(() => {
    if (!data) return category === "recent" ? recent : [];
    if (q) {
      const hits: string[] = [];
      for (const c of CATEGORIES) {
        for (const [emoji, words] of data[c.id] ?? []) {
          if (words.includes(q) || emoji === query.trim()) hits.push(emoji);
          if (hits.length >= SEARCH_MAX) return hits;
        }
      }
      return hits;
    }
    if (category === "recent") return recent;
    return (data[category] ?? []).map(([emoji]) => emoji);
  }, [data, q, query, category, recent]);
  const shown = useMemo(() => (exclude?.length ? all.filter((e) => !exclude.includes(e)) : all), [all, exclude]);

  const pick = (emoji: string) => {
    pushRecent(emoji);
    onPick(emoji);
  };

  const heading = q ? `ผลการค้นหา "${query.trim()}"` : category === "recent" ? "ใช้ล่าสุด" : CATEGORIES.find((c) => c.id === category)?.label;

  /** ลูกศรเลื่อนในตาราง · ขึ้นจากแถวบนสุด = กลับไปช่องค้นหา */
  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }[e.key];
    if (step === undefined) return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-emoji]"));
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    if (i + step < 0) {
      searchRef.current?.focus();
      return;
    }
    buttons[Math.min(buttons.length - 1, i + step)]?.focus();
  };

  return (
    <div className={cn("flex w-[22rem] max-w-full flex-col gap-1.5", className)}>
      <label className="flex items-center gap-2 rounded-lg border border-(--line) bg-(--bg-soft) px-2.5 py-1.5 focus-within:border-(--brand-green,var(--line))">
        <Search className="h-3.5 w-3.5 shrink-0 text-(--ink-soft)" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              gridRef.current?.querySelector<HTMLButtonElement>("button[data-emoji]")?.focus();
            } else if (e.key === "Enter" && shown[0]) {
              e.preventDefault();
              pick(shown[0]);
            }
          }}
          placeholder="ค้นหาอิโมจิ เช่น ยิ้ม, หัวใจ, ok"
          aria-label="ค้นหาอิโมจิ"
          // 16px บนจอสัมผัส — เล็กกว่านี้ iPhone ซูมหน้าเข้าเองตอนแตะ
          className="min-w-0 flex-1 bg-transparent text-sm text-(--ink) outline-none placeholder:text-(--ink-soft) [@media(pointer:coarse)]:text-base"
        />
      </label>

      {!q && (
        <div role="tablist" aria-label="หมวดอิโมจิ" className="flex items-center justify-between gap-0.5">
          {[{ id: "recent", icon: "🕘", label: "ใช้ล่าสุด" }, ...CATEGORIES].map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={category === c.id}
              aria-label={c.label}
              title={c.label}
              // ไม่ดึงโฟกัส/เคอร์เซอร์ออกจากช่องที่กำลังพิมพ์อยู่
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setCategory(c.id);
                gridRef.current?.scrollTo({ top: 0 });
              }}
              className={cn(
                "flex h-8 min-w-0 flex-1 items-center justify-center rounded-md text-lg leading-none transition-colors",
                category === c.id ? "bg-(--bg-soft) shadow-[inset_0_-2px_0_var(--ink)]" : "opacity-60 hover:bg-(--bg-soft) hover:opacity-100"
              )}
            >
              {c.icon}
            </button>
          ))}
        </div>
      )}

      <p className="px-0.5 text-[11px] font-medium text-(--ink-soft)">{heading}</p>

      <div
        ref={gridRef}
        role="grid"
        aria-label="เลือกอิโมจิ"
        onKeyDown={onGridKeyDown}
        className="grid h-56 content-start gap-0.5 overflow-y-auto overscroll-contain"
        style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
      >
        {shown.map((emoji) => (
          <button
            key={emoji}
            type="button"
            data-emoji
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(emoji)}
            aria-label={`ใส่ ${emoji}`}
            className="flex aspect-square items-center justify-center rounded-lg text-2xl leading-none hover:bg-(--bg-soft) focus-visible:bg-(--bg-soft) focus-visible:outline-none"
          >
            {emoji}
          </button>
        ))}
        {shown.length === 0 && (
          <p className="col-span-full px-1 py-6 text-center text-xs text-(--ink-soft)">
            {!data ? "กำลังโหลดอิโมจิ…" : q ? `ไม่พบอิโมจิที่ตรงกับ "${query.trim()}"` : "ยังไม่มีอิโมจิที่ใช้ล่าสุด — เลือกจากหมวดด้านบน"}
          </p>
        )}
      </div>

      <p className="hidden px-0.5 text-[11px] text-(--ink-soft) [@media(hover:hover)]:block">พิมพ์เพื่อค้นหา · ↓ เข้าตาราง · Enter ใส่ · Esc ปิด</p>
    </div>
  );
}

/**
 * แถวกดรีแอคชัน — อิโมจิด่วนจำนวนเท่าเดิม ตามด้วยปุ่ม "…" ที่กางตัวเลือกชุดเต็มในที่เดิม
 * (แบบ LINE/Facebook: ไม่เปลืองที่ตอนพัก แต่เลือกได้ทุกตัวเมื่อต้องการ)
 */
export function ReactionPicker({
  quick,
  isActive,
  onPick,
  exclude,
  className,
  buttonClassName,
  activeClassName,
}: {
  quick: readonly string[];
  /** อิโมจินี้ถูกกดอยู่แล้ว (เน้นพื้นหลัง) */
  isActive?: (emoji: string) => boolean;
  onPick: (emoji: string) => void;
  exclude?: readonly string[];
  /** คลาสของแถวอิโมจิด่วน */
  className?: string;
  buttonClassName?: string;
  activeClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className={cn("flex flex-row flex-wrap items-center gap-0.5", className)}>
        {quick.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onPick(emoji)}
            aria-label={`กด ${emoji}`}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-md text-2xl leading-none transition-transform hover:scale-110 hover:bg-(--bg-soft)",
              buttonClassName,
              isActive?.(emoji) && (activeClassName ?? "bg-(--accent)")
            )}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "ซ่อนอิโมจิทั้งหมด" : "เลือกอิโมจิอื่น"}
          title={open ? "ซ่อน" : "อิโมจิทั้งหมด"}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-(--ink-soft) hover:bg-(--bg-soft)",
            open && "bg-(--bg-soft) text-(--ink)"
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
      {open && <EmojiPicker onPick={onPick} exclude={exclude} className="border-t border-(--line) pt-1.5" />}
    </div>
  );
}

/**
 * หน้าตาป้ายรีแอคชันใต้ข้อความ/โพสต์ — แบบเดียวกับแชททุกโมดูล: ป้ายมนลอย ไม่มีกรอบแข็ง ใช้เงานุ่ม ๆ
 * (สีพื้น/ตัวอักษรของ "ฉันกดแล้ว" กับ "ยังไม่กด" ให้แต่ละโมดูลใส่เองตามธีมของตัวเอง)
 */
export const REACTION_CHIP_CLASS =
  "flex h-8 items-center gap-1 rounded-full px-2 text-[13px] font-semibold shadow-[0_1px_4px_rgba(0,0,0,0.15)] ring-2 ring-(--bg) transition-transform active:scale-95";
