import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { BackLink } from "@/components/module/back-link";

const SHORT_MONTHS = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** ปุ่มย้อนกลับสำหรับหน้าที่ส่ง `leading` ให้ AppScaffold (leading ชนะ backHref) */
export function AppBarBack({ href }: { href: string }) {
  return (
    <BackLink href={href} className="shrink-0 rounded-full p-2 text-(--app-strong) transition-colors hover:bg-(--bg-soft)">
      <ArrowLeft className="h-5 w-5" />
    </BackLink>
  );
}

/** เลือกเดือนบนแถบหัวแทนชื่อหน้า (ผู้ใช้ 4/11/2569) — มือถือย่อชื่อเดือนให้พอวางคู่ปุ่มขวา */
export function AppBarMonthNav({
  prevHref,
  nextHref,
  label,
  month,
  year,
}: {
  prevHref: string;
  nextHref: string;
  /** ชื่อเต็มที่หน้าใช้อยู่ เช่น "พฤศจิกายน 2026" */
  label: string;
  /** 1-12 */
  month: number;
  year: number;
}) {
  const arrow = "shrink-0 rounded-full p-1.5 text-(--ink) transition-colors hover:bg-(--bg-soft)";
  return (
    <div className="flex min-w-0 items-center gap-0.5" data-testid="app-bar-month-nav">
      <Link href={prevHref} aria-label="เดือนก่อน" className={arrow}>
        <ChevronLeft className="h-5 w-5" />
      </Link>
      <span className="truncate text-center text-sm font-semibold text-(--ink) sm:text-base">
        <span className="sm:hidden">{SHORT_MONTHS[month]} {year}</span>
        <span className="hidden sm:inline">{label}</span>
      </span>
      <Link href={nextHref} aria-label="เดือนถัดไป" className={arrow}>
        <ChevronRight className="h-5 w-5" />
      </Link>
    </div>
  );
}
