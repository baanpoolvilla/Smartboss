"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, ChevronDown, ChevronUp } from "lucide-react";

/**
 * หน้าตาของแถบ "รอคุณ" (ใช้ร่วมกันทุกหน้า: โปรเจกต์ / ในโปรเจกต์ / ใบงาน / สั่งซื้ออุปกรณ์)
 * แบบแรกเป็นแถวชมพูยาวเต็มจอ ข้อความชิดซ้าย รายละเอียดไปอยู่ขวาสุด อ่านยาก ("ไม่สวย" 18/10/2569)
 * ⇒ การ์ดเล็กเรียงเป็นตาราง กว้างพอดีเนื้อหา: ไอคอนวงกลมสีตามเรื่อง · ชื่อเรื่องตัวหนา · รายละเอียดบรรทัดล่าง
 */
export interface PendingCardItem {
  key: string;
  /** "💬 ความคิดเห็นใหม่" — อีโมจิตัวแรกใช้เป็นไอคอน ที่เหลือเป็นป้าย */
  kind: string;
  title: string;
  meta?: string | null;
  at?: string | null;
  href?: string | null;
  onClick?: () => void;
}

const TONE: Record<string, { bg: string; fg: string }> = {
  "💬": { bg: "#e0ecff", fg: "#1d4ed8" },
  "✅": { bg: "#dcf3e1", fg: "#15803d" },
  "👤": { bg: "#ede4ff", fg: "#6d28d9" },
  "📋": { bg: "#ede4ff", fg: "#6d28d9" },
  "📎": { bg: "#fdf0d5", fg: "#b45309" },
  "⏰": { bg: "#ffe8d6", fg: "#c2410c" },
  "📦": { bg: "#d5f3ef", fg: "#0f766e" },
};
const DEFAULT_TONE = { bg: "#fde2e2", fg: "#b91c1c" };

function splitKind(kind: string): { icon: string; label: string } {
  const sp = kind.indexOf(" ");
  const head = sp > 0 ? kind.slice(0, sp) : "";
  // อีโมจิ = ตัวแรกไม่ใช่ตัวอักษร/ตัวเลข
  return head && !/[\p{L}\p{N}]/u.test(head) ? { icon: head, label: kind.slice(sp + 1) } : { icon: "🔔", label: kind };
}

export function agoTh(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return "เมื่อกี้";
  if (m < 60) return `${m} นาที`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ชม.`;
  return `${Math.round(h / 24)} วัน`;
}

function Card({ item }: { item: PendingCardItem }) {
  const { icon, label } = splitKind(item.kind);
  const tone = TONE[icon] ?? DEFAULT_TONE;
  const inner = (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[17px]" style={{ backgroundColor: tone.bg }} aria-hidden>
        {icon}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate text-[11.5px] font-bold" style={{ color: tone.fg }}>{label}</span>
          {item.at && <span className="ml-auto shrink-0 text-[11px] text-(--ink-soft)">{agoTh(item.at)}</span>}
        </span>
        <span className="truncate text-[13.5px] font-semibold text-(--ink)">{item.title}</span>
        {item.meta && <span className="truncate text-[11.5px] text-(--ink-soft)">{item.meta}</span>}
      </span>
    </>
  );
  const cls =
    "flex min-w-0 items-center gap-2.5 rounded-xl border border-(--line) bg-(--bg) px-3 py-2.5 text-left transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-[var(--brand-green,#4cb848)]";
  if (item.href) return <Link href={item.href} className={cls}>{inner}</Link>;
  return (
    <button type="button" onClick={item.onClick} className={cls}>
      {inner}
    </button>
  );
}

const SHOW = 6;

export function PendingCards({ items, className }: { items: PendingCardItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const shown = open ? items : items.slice(0, SHOW);
  return (
    <section className={`grid gap-2 ${className ?? ""}`} aria-label="เรื่องที่รอคุณ">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-[#dc2626]" />
        <b className="text-[14px] text-(--ink)">รอคุณ</b>
        <span className="rounded-full bg-[#dc2626] px-2 text-[11.5px] font-bold leading-5 text-white">{items.length}</span>
        <span className="text-[12px] text-(--ink-soft)">กดเพื่อเปิดดู · ดูแล้วหายเอง</span>
        {items.length > SHOW && (
          <button type="button" onClick={() => setOpen((v) => !v)} className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--brand-green-dark,#1e7830)] hover:underline">
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {open ? "ย่อ" : `ดูทั้งหมด ${items.length}`}
          </button>
        )}
      </div>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,270px),1fr))]">
        {shown.map((i) => (
          <Card key={i.key} item={i} />
        ))}
      </div>
    </section>
  );
}
