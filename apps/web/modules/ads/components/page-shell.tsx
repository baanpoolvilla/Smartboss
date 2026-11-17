import Link from "next/link";
import { AppScaffold } from "@/components/module/app-scaffold";
import { SyncStamp } from "./ui";

/** โครงหน้ามาตรฐานของโมดูล — ชื่อหน้า + เวลาที่ n8n ส่งข้อมูลล่าสุดทุกหน้า */
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

export function NoAccounts({ canConfigure }: { canConfigure: boolean }) {
  return (
    <div className="rounded-(--radius-lg) border border-(--line) bg-(--bg) p-10 text-center text-sm text-(--ink-soft)">
      ยังไม่มีข้อมูลโฆษณา — n8n ยังไม่ได้ส่งข้อมูลเข้ามา
      {canConfigure ? (
        <>
          {" · "}
          <Link href="/ads/settings/connection" className="text-[#1A73E8] underline">
            ไปที่หน้าการเชื่อมต่อ n8n
          </Link>{" "}
          เพื่อออก token และดูวิธีส่งข้อมูล
        </>
      ) : (
        " · ติดต่อผู้ดูแลระบบให้เชื่อมต่อ n8n"
      )}
    </div>
  );
}
