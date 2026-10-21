import Link from "next/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";

import { AppScaffold } from "@/components/module/app-scaffold";
import { PrintButton } from "@/modules/daily_worker/components/print-button";
import { REQ_PERMS } from "@/modules/requests/permissions";
import { requestsPage, statusOf, beneficiaryLabel } from "@/modules/requests/lib/page";
import { groupBy, kindTotals, monthRequests } from "@/modules/requests/lib/report";
import { KindChip, StatusChip } from "@/modules/requests/components/ui";
import { KINDS, KIND_META, bangkokToday, baht, costOf, monthTitle, round2, shiftMonthOf, thaiDate } from "@/modules/requests/lib/types";

export const dynamic = "force-dynamic";

/** รายงานรายเดือน — แยกประเภท · รายคน · รายบ้าน + ตารางทุกใบ (ส่งออก Excel / พิมพ์ PDF) */
export default async function RequestsReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { session, viewer } = await requestsPage(REQ_PERMS.viewAll);
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : bangkokToday().slice(0, 7);
  const rows = await monthRequests(session.orgId, viewer, month);
  const kinds = kindTotals(rows);
  const total = round2(rows.reduce((s, r) => s + costOf(r), 0));
  const paid = round2(rows.reduce((s, r) => s + r.paidTotal, 0));
  const people = groupBy(rows, (r) => [r.beneficiaryUserId ?? r.vendorId ?? r.beneficiaryName, `${r.beneficiaryName} (${beneficiaryLabel(r)})`]);
  const places = groupBy(rows.filter((r) => r.propertyName), (r) => [r.propertyId ?? r.propertyName!, r.propertyName!]);
  const wht = round2(rows.reduce((s, r) => s + r.whtAmount, 0));

  return (
    <AppScaffold title="รายงานเบิกจ่าย & OT" backHref="/requests" width="max-w-6xl">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Link href={`?month=${shiftMonthOf(month, -1)}`} aria-label="เดือนก่อน" className="rounded-full border border-(--line) bg-(--bg) p-2 hover:bg-(--bg-soft)"><ChevronLeft className="h-4 w-4" /></Link>
          <div className="min-w-40 rounded-full border border-(--line) bg-(--bg) px-4 py-2 text-center text-sm font-semibold">{monthTitle(month)}</div>
          <Link href={`?month=${shiftMonthOf(month, 1)}`} aria-label="เดือนถัดไป" className="rounded-full border border-(--line) bg-(--bg) p-2 hover:bg-(--bg-soft)"><ChevronRight className="h-4 w-4" /></Link>
          <span className="flex-1" />
          <a href={`/requests/report/export?month=${month}`} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-(--line) bg-(--bg) px-3.5 text-sm hover:bg-(--bg-soft)">
            <Download className="h-4 w-4" aria-hidden="true" /> Excel
          </a>
          <PrintButton />
        </div>
        <h1 className="hidden text-lg font-bold print:block">รายงานเบิกจ่าย & OT · {monthTitle(month)}</h1>

        <section className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          <div className="rounded-(--radius-lg) border border-(--line) bg-(--bg) p-3.5">
            <div className="text-xs text-(--ink-soft)">รวมทุกประเภท</div>
            <div className="text-2xl font-bold tabular-nums">{baht(total)}</div>
            <div className="text-[11px] text-(--ink-soft)">{rows.length} ใบ · จ่ายแล้ว {baht(paid)}</div>
          </div>
          {kinds.filter((k) => k.count > 0).map((k) => (
            <div key={k.kind} className="rounded-(--radius-lg) border border-(--line) bg-(--bg) p-3.5">
              <div className="flex items-center gap-1.5 text-xs text-(--ink-soft)"><KindChip kind={k.kind} /> {k.count} ใบ</div>
              <div className="mt-1 text-xl font-bold tabular-nums">{baht(k.total)}</div>
              <div className="text-[11px] text-(--ink-soft)">จ่ายแล้ว {baht(k.paid)}{k.kind === "contractor" && wht > 0 ? ` · หัก ณ ที่จ่าย ${baht(wht)}` : ""}</div>
            </div>
          ))}
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[
            { title: "รายคน", groups: people },
            { title: "รายบ้าน", groups: places },
          ].map((block) => (
            <section key={block.title} className="rounded-(--radius-lg) border border-(--line) bg-(--bg)">
              <h2 className="border-b border-(--line) px-4 py-3 text-sm font-bold">{block.title}</h2>
              {block.groups.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-(--ink-soft)">ไม่มีข้อมูล</div>
              ) : (
                <ul className="divide-y divide-(--line)">
                  {block.groups.slice(0, 30).map((g) => (
                    <li key={g.key} className="flex items-center justify-between gap-3 px-4 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{g.label}</div>
                        <div className="truncate text-xs text-(--ink-soft)">
                          {KINDS.filter((k) => g.byKind[k]).map((k) => `${KIND_META[k].short} ${baht(g.byKind[k]!)}`).join(" · ")}
                        </div>
                      </div>
                      <div className="shrink-0 text-sm font-bold tabular-nums">{baht(g.total)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <section className="rounded-(--radius-lg) border border-(--line) bg-(--bg)">
          <h2 className="border-b border-(--line) px-4 py-3 text-sm font-bold">ทุกใบ</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-(--bg-soft) text-left text-xs text-(--ink-soft)">
                <tr>
                  <th className="px-3 py-2 font-semibold">วันที่</th>
                  <th className="px-3 py-2 font-semibold">เลขที่</th>
                  <th className="px-3 py-2 font-semibold">ประเภท</th>
                  <th className="px-3 py-2 font-semibold">ของใคร</th>
                  <th className="px-3 py-2 font-semibold">รายการ</th>
                  <th className="px-3 py-2 text-right font-semibold">ยอด</th>
                  <th className="px-3 py-2 text-right font-semibold">จ่ายแล้ว</th>
                  <th className="px-3 py-2 font-semibold">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--line)">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{thaiDate(r.workDate)}</td>
                    <td className="whitespace-nowrap px-3 py-2"><Link href={`/requests/${r.id}`} className="text-(--app-strong) hover:underline">{r.code}</Link></td>
                    <td className="px-3 py-2"><KindChip kind={r.kind} /></td>
                    <td className="px-3 py-2">{r.beneficiaryName}</td>
                    <td className="px-3 py-2">{r.title}{r.propertyName ? <span className="text-xs text-(--ink-soft)"> · {r.propertyName}</span> : null}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{baht(costOf(r))}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{baht(r.paidTotal)}</td>
                    <td className="px-3 py-2"><StatusChip info={statusOf(r)} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-(--line) font-bold">
                <tr>
                  <td className="px-3 py-2" colSpan={5}>รวม {rows.length} ใบ</td>
                  <td className="px-3 py-2 text-right tabular-nums">{baht(total)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{baht(paid)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </div>
    </AppScaffold>
  );
}
