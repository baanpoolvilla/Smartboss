"use client";

import { useEffect, useRef, useState } from "react";
import { Baseline, Highlighter, X } from "lucide-react";
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
