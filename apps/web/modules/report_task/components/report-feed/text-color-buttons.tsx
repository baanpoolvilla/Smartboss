"use client";

import { useEffect, useRef, useState } from "react";
import { ALargeSmall, Baseline, Highlighter, X } from "lucide-react";
import { HIGHLIGHT_COLORS, TEXT_COLORS } from "@/modules/report_task/lib/report-feed-rich-text";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * ปุ่มสีตัวอักษร + ไฮไลต์ของแถบจัดรูปแบบ แบบ Microsoft Teams (ผู้ใช้ 31/10/2569)
 * ทุกปุ่มกัน mousedown ไว้ — คลิกแล้วข้อความที่เลือกในช่องพิมพ์ต้องยังเลือกอยู่ (ไม่ใช้ Popover ที่ย้ายโฟกัส)
 * ขีดสีใต้ไอคอน = สีที่ใช้ล่าสุด · กดแล้วเลือกสีจากชุด (สีนอกชุดเก็บไม่ได้ ดู TEXT_COLORS)
 */
export function TextColorButtons({
  onColor,
  onHighlight,
  buttonClassName,
  iconClassName = "h-3 w-3",
}: {
  /** null = ล้างสี */
  onColor: (hex: string | null) => void;
  onHighlight: (hex: string | null) => void;
  buttonClassName: string;
  iconClassName?: string;
}) {
  const [open, setOpen] = useState<"c" | "h" | null>(null);
  const [lastColor, setLastColor] = useState<string>(TEXT_COLORS.red.hex);
  const [lastHighlight, setLastHighlight] = useState<string>(HIGHLIGHT_COLORS.yellow.hex);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const keep = (e: React.MouseEvent) => e.preventDefault();
  const palette = open === "c" ? TEXT_COLORS : HIGHLIGHT_COLORS;

  return (
    <span ref={rootRef} className="relative inline-flex items-center">
      <button
        type="button"
        onMouseDown={keep}
        onClick={() => setOpen(open === "c" ? null : "c")}
        className={buttonClassName}
        aria-label="สีตัวอักษร"
        aria-expanded={open === "c"}
        title="สีตัวอักษร"
      >
        <span className="flex flex-col items-center leading-none">
          <Baseline className={iconClassName} />
          <span className="mt-px h-[2px] w-3 rounded-full" style={{ backgroundColor: lastColor }} />
        </span>
      </button>
      <button
        type="button"
        onMouseDown={keep}
        onClick={() => setOpen(open === "h" ? null : "h")}
        className={buttonClassName}
        aria-label="ไฮไลต์ข้อความ"
        aria-expanded={open === "h"}
        title="ไฮไลต์ข้อความ"
      >
        <span className="flex flex-col items-center leading-none">
          <Highlighter className={iconClassName} />
          <span className="mt-px h-[2px] w-3 rounded-full" style={{ backgroundColor: lastHighlight }} />
        </span>
      </button>
      {open && (
        <span
          role="menu"
          aria-label={open === "c" ? "เลือกสีตัวอักษร" : "เลือกสีไฮไลต์"}
          className="absolute left-0 top-full z-50 mt-1 flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-1.5 shadow-lg"
        >
          {Object.values(palette).map((c) => (
            <button
              key={c.hex}
              type="button"
              role="menuitem"
              onMouseDown={keep}
              onClick={() => {
                if (open === "c") {
                  setLastColor(c.hex);
                  onColor(c.hex);
                } else {
                  setLastHighlight(c.hex);
                  onHighlight(c.hex);
                }
                setOpen(null);
              }}
              aria-label={`${open === "c" ? "สี" : "ไฮไลต์"}${c.label}`}
              title={c.label}
              className={cn("h-6 w-6 rounded-full ring-1 ring-inset ring-black/10 transition-transform hover:scale-110", open === "c" && "flex items-center justify-center bg-[var(--bg)]")}
              style={open === "c" ? undefined : { backgroundColor: c.hex }}
            >
              {open === "c" && <span className="text-sm font-bold" style={{ color: c.hex }}>A</span>}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onMouseDown={keep}
            onClick={() => {
              if (open === "c") onColor(null);
              else onHighlight(null);
              setOpen(null);
            }}
            aria-label={open === "c" ? "ล้างสีตัวอักษร" : "ล้างไฮไลต์"}
            title={open === "c" ? "ล้างสี" : "ล้างไฮไลต์"}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      )}
    </span>
  );
}

/** ใส่/ล้างสีกับข้อความที่เลือกในช่องพิมพ์ (contentEditable) — สีนอกชุดถูกตัดทิ้งตอนอ่านกลับ จึงใช้สีตัวอักษรปกติแทน "ล้าง" */
export function applyTextColor(el: HTMLElement, kind: "c" | "h", hex: string | null) {
  el.focus();
  if (kind === "c") {
    document.execCommand("foreColor", false, hex ?? getComputedStyle(el).color);
  } else {
    const value = hex ?? "transparent";
    if (!document.execCommand("hiliteColor", false, value)) document.execCommand("backColor", false, value);
  }
}

export type TextStyleChoice = "h1" | "h2" | "h3" | "normal";
export type TextSizeChoice = "sm" | "normal" | "lg" | "xl";

const STYLE_ITEMS: { id: TextStyleChoice; label: string; className: string }[] = [
  { id: "h1", label: "หัวข้อใหญ่", className: "text-lg font-bold" },
  { id: "h2", label: "หัวข้อ", className: "text-base font-bold" },
  { id: "h3", label: "หัวข้อย่อย", className: "text-sm font-bold" },
  { id: "normal", label: "ข้อความปกติ", className: "text-sm" },
];
const SIZE_ITEMS: { id: TextSizeChoice; label: string; className: string }[] = [
  { id: "sm", label: "เล็ก", className: "text-xs" },
  { id: "normal", label: "ปกติ", className: "text-sm" },
  { id: "lg", label: "ใหญ่", className: "text-base" },
  { id: "xl", label: "ใหญ่มาก", className: "text-lg" },
];

/** เมนู "รูปแบบข้อความ" แบบ Teams — หัวข้อ (ขนาด+ตัวหนาทั้งบรรทัด) และขนาดตัวอักษร · ไม่ย้ายโฟกัสออกจากช่องพิมพ์ */
export function TextStyleMenu({
  onStyle,
  onSize,
  buttonClassName,
  iconClassName = "h-3 w-3",
}: {
  onStyle: (style: TextStyleChoice) => void;
  onSize: (size: TextSizeChoice) => void;
  buttonClassName: string;
  iconClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const item = "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[var(--ink)] hover:bg-[var(--bg-soft)]";
  return (
    <span ref={rootRef} className="relative inline-flex items-center">
      <button
        type="button"
        onMouseDown={keep}
        onClick={() => setOpen((v) => !v)}
        className={buttonClassName}
        aria-label="รูปแบบข้อความและขนาด"
        aria-expanded={open}
        title="หัวข้อ / ขนาดตัวอักษร"
      >
        <ALargeSmall className={iconClassName} />
      </button>
      {open && (
        <span role="menu" aria-label="รูปแบบข้อความ" className="absolute left-0 top-full z-50 mt-1 flex w-48 flex-col rounded-lg border border-[var(--line)] bg-[var(--bg)] p-1 shadow-lg">
          <span className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold text-[var(--ink-soft)]">รูปแบบ (ทั้งบรรทัด)</span>
          {STYLE_ITEMS.map((s) => (
            <button key={s.id} type="button" role="menuitem" onMouseDown={keep} onClick={() => { onStyle(s.id); setOpen(false); }} className={cn(item, s.className)}>
              {s.label}
            </button>
          ))}
          <span className="my-1 h-px bg-[var(--line)]" />
          <span className="px-2.5 pb-0.5 text-[11px] font-semibold text-[var(--ink-soft)]">ขนาดตัวอักษร (ที่เลือกไว้)</span>
          {SIZE_ITEMS.map((s) => (
            <button key={s.id} type="button" role="menuitem" onMouseDown={keep} onClick={() => { onSize(s.id); setOpen(false); }} className={cn(item, s.className)}>
              {s.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/** เลือกทั้งบรรทัดที่เคอร์เซอร์อยู่ ถ้ายังไม่ได้เลือกอะไร (หัวข้อแบบ Teams ใช้กับทั้งย่อหน้า) */
function selectLineIfCollapsed() {
  const sel = window.getSelection() as (Selection & { modify?: (a: string, d: string, g: string) => void }) | null;
  if (!sel || !sel.isCollapsed || !sel.modify) return;
  sel.modify("move", "backward", "lineboundary");
  sel.modify("extend", "forward", "lineboundary");
}

const FONT_SIZE_OF: Record<TextSizeChoice, string> = { sm: "2", normal: "3", lg: "5", xl: "6" };

export function applyTextSize(el: HTMLElement, size: TextSizeChoice) {
  el.focus();
  document.execCommand("fontSize", false, FONT_SIZE_OF[size]);
}

export function applyTextStyle(el: HTMLElement, style: TextStyleChoice) {
  el.focus();
  selectLineIfCollapsed();
  document.execCommand("fontSize", false, style === "h1" ? "6" : style === "h2" ? "5" : "3");
  const wantBold = style !== "normal";
  if (document.queryCommandState("bold") !== wantBold) document.execCommand("bold");
}

/** ย่อหน้าเข้า/ออก — ช่องว่างหน้าบรรทัด 4 ช่อง (โพสต์แสดงช่องว่างหน้าบรรทัดตามที่พิมพ์อยู่แล้ว) */
export function applyIndent(el: HTMLElement, dir: "in" | "out") {
  el.focus();
  const sel = window.getSelection() as (Selection & { modify?: (a: string, d: string, g: string) => void }) | null;
  if (!sel?.modify) return;
  sel.modify("move", "backward", "lineboundary");
  if (dir === "in") {
    document.execCommand("insertText", false, "\u00a0\u00a0\u00a0\u00a0");
    return;
  }
  for (let i = 0; i < 4; i++) sel.modify("extend", "forward", "character");
  const picked = sel.toString();
  const n = picked.length - picked.replace(/^[\s\u00a0]+/, "").length;
  sel.collapseToStart();
  if (n === 0) return;
  for (let i = 0; i < n; i++) sel.modify("extend", "forward", "character");
  document.execCommand("delete");
}
