import {
  Plus,
  Trash2,
  CheckCircle2,
  RotateCcw,
  ArrowRightLeft,
  CalendarClock,
  Flag,
  UserCog,
  Sticker,
  MinusCircle,
  Pencil,
  Circle,
  Crown,
  type LucideIcon,
} from "lucide-react";

export interface ActivityActionMeta {
  icon: LucideIcon;
  /** Tailwind text-color class for the icon chip — also doubles as the left accent bar color on each row. */
  colorClass: string;
  bgClass: string;
}

const DEFAULT_META: ActivityActionMeta = {
  icon: Circle,
  colorClass: "text-[var(--ink-soft)]",
  bgClass: "bg-[var(--bg-soft)]",
};

/**
 * Classifies a free-text activity `action` string (Thai, written ad-hoc at
 * each `logActivity`/`logTicketActivity` call site — there's no shared enum)
 * into an icon + color so the feed reads as distinct kinds of events at a
 * glance instead of one long run of identical-looking rows. Substring match,
 * most-specific first, so a new action string added later still lands in a
 * sensible bucket instead of needing this list updated in lockstep.
 */
export function activityActionMeta(action: string): ActivityActionMeta {
  const a = action;

  if (a.includes("ลบ")) return { icon: Trash2, colorClass: "text-[var(--chart-red)]", bgClass: "bg-red-50" };

  if (a.includes("หักคะแนนอัตโนมัติ")) return { icon: MinusCircle, colorClass: "text-[var(--chart-red)]", bgClass: "bg-red-50" };
  if (a.includes("ยกเลิกการหักคะแนน")) return { icon: RotateCcw, colorClass: "text-[var(--chart-amber)]", bgClass: "bg-amber-50" };
  if (a.includes("หักคะแนน")) return { icon: MinusCircle, colorClass: "text-[var(--chart-red)]", bgClass: "bg-red-50" };

  if (a.includes("เปิดงานกลับ") || a.includes("เปิดตั๋วกลับ") || a.includes("ยกเลิกเครื่องหมายเสร็จ") || a.includes("กู้คืน"))
    return { icon: RotateCcw, colorClass: "text-[var(--chart-amber)]", bgClass: "bg-amber-50" };

  if (a.includes("เสร็จ") || a.includes("ยืนยันว่าตั๋วแก้ไขแล้ว"))
    return { icon: CheckCircle2, colorClass: "text-[var(--brand-green-dark)]", bgClass: "bg-[var(--accent)]" };

  if (a.includes("สร้าง") || a.includes("แจ้งปัญหาใหม่"))
    return { icon: Plus, colorClass: "text-[var(--brand-green-dark)]", bgClass: "bg-[var(--accent)]" };

  if (a.includes("เปลี่ยนสถานะ")) return { icon: ArrowRightLeft, colorClass: "text-[var(--chart-blue)]", bgClass: "bg-blue-50" };

  if (a.includes("กำหนดส่ง")) return { icon: CalendarClock, colorClass: "text-[var(--chart-amber)]", bgClass: "bg-amber-50" };

  if (a.includes("ความสำคัญ")) return { icon: Flag, colorClass: "text-[var(--chart-amber)]", bgClass: "bg-amber-50" };

  if (a.includes("ผู้รับผิดชอบ") || a.includes("หัวหน้าหลัก"))
    return { icon: UserCog, colorClass: "text-[var(--chart-blue)]", bgClass: "bg-blue-50" };

  if (a.includes("สติกเกอร์")) return { icon: Sticker, colorClass: "text-[var(--chart-violet)]", bgClass: "bg-violet-50" };

  if (a.includes("เจ้าของบริษัท")) return { icon: Crown, colorClass: "text-[var(--chart-amber)]", bgClass: "bg-amber-50" };

  if (a.includes("แก้ไข")) return { icon: Pencil, colorClass: "text-[var(--chart-blue)]", bgClass: "bg-blue-50" };

  return DEFAULT_META;
}
