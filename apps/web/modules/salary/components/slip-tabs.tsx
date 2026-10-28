import Link from "next/link";
import { Printer } from "lucide-react";

import { outline } from "./ui";

/** สลิป: แบบเอกสาร (ค่าเริ่มต้น) / แบบอธิบายวิธีคิดทีละบรรทัด — แท็บที่เลือกใช้กรอบสีน้ำเงินเข้ม (ไม่ใช้เขียว) */
export function SlipTabs({ docHref, detailHref, detail, printHref }: { docHref: string; detailHref: string; detail: boolean; printHref?: string }) {
  const tab = (on: boolean) =>
    `inline-flex h-10 items-center rounded-full border px-4 text-sm ${on ? "border-(--brand-navy,#1b2537) bg-(--brand-navy,#1b2537)/10 font-semibold text-(--ink)" : "border-(--line) text-(--ink-soft) hover:text-(--ink)"}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="รูปแบบสลิป" className="flex gap-2">
        <Link href={docHref} className={tab(!detail)} aria-current={!detail ? "page" : undefined}>สลิปเงินเดือน</Link>
        <Link href={detailHref} className={tab(detail)} aria-current={detail ? "page" : undefined}>ดูวิธีคิดแต่ละรายการ</Link>
      </nav>
      {printHref && (
        <Link href={printHref} target="_blank" className={`${outline} ml-auto h-10`}>
          <Printer className="h-4 w-4" aria-hidden="true" /> พิมพ์ / PDF
        </Link>
      )}
    </div>
  );
}
