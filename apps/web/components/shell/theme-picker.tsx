"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { parseThemePref, THEME_COLOR, THEME_COOKIE, THEME_PREFS, type ThemePref } from "@/lib/theme";

const ICON = { light: Sun, dark: Moon, system: Monitor } as const;

function readPref(): ThemePref {
  if (typeof document === "undefined") return "light";
  return parseThemePref(document.documentElement.getAttribute("data-theme-pref"));
}

/** เปลี่ยนธีมทันทีบนหน้าที่เปิดอยู่ + จำในคุกกี้ 1 ปี (เซิร์ฟเวอร์อ่านตอนโหลดหน้าถัดไป) */
export function applyThemePref(pref: ThemePref) {
  const d = document.documentElement;
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  d.setAttribute("data-theme-pref", pref);
  d.setAttribute("data-theme", dark ? "dark" : "light");
  d.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? THEME_COLOR.dark : THEME_COLOR.light);
  document.cookie = `${THEME_COOKIE}=${pref}; path=/; max-age=31536000; samesite=lax`;
}

function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>("light");
  useEffect(() => setPref(readPref()), []);
  // "ตามเครื่อง": เปลี่ยนตามเครื่องทันทีเมื่อผู้ใช้สลับโหมดของระบบ
  useEffect(() => {
    if (pref !== "system") return;
    const m = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyThemePref("system");
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [pref]);
  return [pref, (p) => { applyThemePref(p); setPref(p); }];
}

/** ปุ่มเลือก 3 แบบ (หน้า บัญชีของฉัน) */
export function ThemePicker() {
  const [pref, set] = useThemePref();
  return (
    <div role="radiogroup" aria-label="ธีมหน้าจอ" className="grid grid-cols-3 gap-2 sm:max-w-md">
      {THEME_PREFS.map((t) => {
        const Icon = ICON[t.id];
        const on = pref === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => set(t.id)}
            className={`flex flex-col items-center gap-1.5 rounded-(--radius) border px-3 py-3 text-sm transition-colors ${
              on ? "border-(--brand-navy) bg-(--bg-soft) font-semibold text-(--ink)" : "border-(--line) text-(--ink-soft) hover:bg-(--bg-soft)"
            }`}
          >
            <Icon className="h-5 w-5" aria-hidden />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** ปุ่มเล็กบนแถบบน — กดสลับ สว่าง ↔ มืด (ถ้าเลือก "ตามเครื่อง" ไว้ กดแล้วเป็นแบบตรงข้ามกับที่เห็นอยู่) */
export function ThemeToggleButton({ className = "" }: { className?: string }) {
  const [pref, set] = useThemePref();
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const d = document.documentElement;
    const sync = () => setIsDark(d.getAttribute("data-theme") === "dark");
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(d, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, [pref]);
  const label = isDark ? "เปลี่ยนเป็นธีมสว่าง" : "เปลี่ยนเป็นธีมมืด";
  return (
    <button
      type="button"
      onClick={() => set(isDark ? "light" : "dark")}
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-(--ink-soft) transition-colors hover:bg-(--bg-soft) hover:text-(--ink) ${className}`}
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
