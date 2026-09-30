import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import { AppScaffold } from "@/components/module/app-scaffold";
import { SyncStamp } from "./ui";

/** โครงหน้ามาตรฐานของโมดูล — ชื่อหน้า + เวลาซิงค์ล่าสุดทุกหน้า (spec §7) */
export function AdsPage({
  title,
  lastSynced,
  actions,
  children,
}: {
  title: string;
  lastSynced: Date | null;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // เต็มความกว้างจอ — ตารางแคมเปญ/กลุ่มโฆษณามีหลายคอลัมน์ ยิ่งกว้างยิ่งไม่ต้องเลื่อนแนวนอน
    <AppScaffold title={title} width="max-w-none">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SyncStamp at={lastSynced} />
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </AppScaffold>
  );
}

/** ปุ่มส่งออก PDF/Excel ของรายงานหนึ่งฉบับ (spec §7 ฟังก์ชันร่วม / §8 /ads/export) */
export function ExportButtons({ reportId }: { reportId: string }) {
  const cls =
    "inline-flex h-9 items-center gap-1.5 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) hover:bg-(--bg-soft)";
  return (
    <>
      <Link href={`/api/ads/export?report_id=${reportId}&format=pdf`} target="_blank" className={cls} prefetch={false}>
        <FileText className="h-4 w-4" /> PDF
      </Link>
      <a href={`/api/ads/export?report_id=${reportId}&format=xlsx`} className={cls}>
        <FileSpreadsheet className="h-4 w-4" /> Excel
      </a>
    </>
  );
}

export function NoAccounts({ canConfigure }: { canConfigure: boolean }) {
  return (
    <div className="rounded-(--radius-lg) border border-(--line) bg-(--bg) p-10 text-center text-sm text-(--ink-soft)">
      ยังไม่มีบัญชีโฆษณา
      {canConfigure ? (
        <>
          {" — "}
          <Link href="/ads/settings/connection" className="text-[#1A73E8] underline">
            ไปที่หน้าการเชื่อมต่อ API
          </Link>{" "}
          เพื่อดึงรายชื่อบัญชีใต้ MCC
        </>
      ) : (
        " — ติดต่อผู้ดูแลระบบให้เชื่อมต่อ Google Ads API"
      )}
    </div>
  );
}
