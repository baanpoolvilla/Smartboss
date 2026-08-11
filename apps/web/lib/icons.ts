import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  Bug,
  Building,
  Building2,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  Clock,
  Contact,
  Fingerprint,
  History,
  Home,
  KanbanSquare,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  Megaphone,
  MessageSquareText,
  Package,
  ReceiptText,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";

/**
 * manifest เก็บชื่อ icon เป็น string (ข้าม server→client ได้) — ตารางนี้แปลงกลับเป็น component
 * ชื่อที่ใช้อ้างอิงจาก lucide-react ตรง ๆ
 */
const ICONS: Record<string, LucideIcon> = {
  Boxes,
  Bug,
  Building,
  Building2,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  Clock,
  Contact,
  Fingerprint,
  History,
  Home,
  KanbanSquare,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  Megaphone,
  MessageSquareText,
  Package,
  ReceiptText,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Users,
  Wallet,
  Wrench,
};

export function iconByName(name?: string): LucideIcon {
  return (name ? ICONS[name] : undefined) ?? Boxes;
}
