import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";

import { AppScaffold } from "@/components/module/app-scaffold";
import { DW_PERMS } from "@/modules/daily_worker/permissions";
import { bangkokToday, loadMonth } from "@/modules/daily_worker/lib/data";
import { readAudit } from "@/modules/daily_worker/lib/db";
import { shiftMonth } from "@/modules/daily_worker/lib/types";
import { AUDIT_LABEL, AuditList } from "@/modules/daily_worker/components/audit-list";
import { PayTabs } from "@/modules/daily_worker/components/pay-tabs";

export const dynamic = "force-dynamic";

const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

/**
 * ประวัติการแก้ไขของโมดูลคนงาน (ผู้ใช้ขอ 19/10/2569) — อ่านจาก daily_worker.audit_events
 * (เพิ่มได้อย่างเดียว ลบ/แก้ไม่ได้ · แยกตามบริษัทด้วย RLS) · กรองตามเดือน คน และประเภท
 */
export default async function PayLogPage({ searchParams }: { searchParams: Promise<{ month?: string; employment?: string; action?: string }> }) {
  const session = await requireOrg();
  if (![DW_PERMS.view, DW_PERMS.manage, DW_PERMS.override, DW_PERMS.pay].some((p) => hasPermission(session, p))) redirect("/");
  const sp = await searchParams;
  const today = bangkokToday();
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const from = new Date(`${month}-01T00:00:00+07:00`);
  const to = new Date(`${shiftMonth(month, 1)}-01T00:00:00+07:00`);
  const [events, data] = await Promise.all([
    readAudit(session.orgId, { from, to, employmentId: sp.employment || undefined, limit: 1000 }),
    loadMonth(session.orgId, month).catch(() => null),
  ]);
  const names: Record<string, string> = Object.fromEntries((data?.workers ?? []).filter((w) => w.employmentId).map((w) => [w.employmentId!, w.name]));
  const shown = sp.action ? events.filter((e) => e.action === sp.action) : events;
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { month, employment: sp.employment, action: sp.action, ...o };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `?${p.toString()}`;
  };
  const [y, m] = month.split("-").map(Number) as [number, number];

  return (
    <AppScaffold title="จ่ายเงินคนงาน" width="max-w-5xl">
      <div className="flex flex-col gap-4">
        <PayTabs active="log" month={month} canSetPay={hasPermission(session, DW_PERMS.pay)} />

        <div className="flex flex-wrap items-center gap-2">
          <Link href={qs({ month: shiftMonth(month, -1) })} className="rounded-full border border-(--line) bg-(--bg) p-2 hover:bg-(--bg-soft)" aria-label="เดือนก่อน">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <b className="min-w-32 text-center">
            {MONTHS[m - 1]} {y + 543}
          </b>
          <Link href={qs({ month: shiftMonth(month, 1) })} className="rounded-full border border-(--line) bg-(--bg) p-2 hover:bg-(--bg-soft)" aria-label="เดือนถัดไป">
            <ChevronRight className="h-4 w-4" />
          </Link>
          <span className="text-xs text-(--ink-soft)">{shown.length} รายการ</span>
        </div>

        <div className="flex flex-wrap gap-1.5 text-xs">
          <Link href={qs({ employment: undefined })} className={`rounded-full px-2.5 py-1 ${!sp.employment ? "bg-(--ink) text-(--bg)" : "border border-(--line)"}`}>
            ทุกคน
          </Link>
          {Object.entries(names).map(([id, name]) => (
            <Link key={id} href={qs({ employment: id })} className={`rounded-full px-2.5 py-1 ${sp.employment === id ? "bg-(--ink) text-(--bg)" : "border border-(--line)"}`}>
              {name}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Link href={qs({ action: undefined })} className={`rounded-full px-2.5 py-1 ${!sp.action ? "bg-(--ink) text-(--bg)" : "border border-(--line)"}`}>
            ทุกประเภท
          </Link>
          {Object.entries(AUDIT_LABEL).map(([k, v]) => (
            <Link key={k} href={qs({ action: k })} className={`rounded-full px-2.5 py-1 ${sp.action === k ? "bg-(--ink) text-(--bg)" : "border border-(--line)"}`}>
              {v.text}
            </Link>
          ))}
        </div>

        <AuditList events={shown} names={names} />
        <p className="text-xs text-(--ink-soft)">ประวัตินี้แก้หรือลบไม่ได้ · เริ่มบันทึกตั้งแต่ 19 ต.ค. 2569 (การแก้ก่อนหน้านั้นดูได้ที่ตัวรายการเอง เช่น &quot;แก้โดย …&quot; ในหน้ารายคน)</p>
      </div>
    </AppScaffold>
  );
}
