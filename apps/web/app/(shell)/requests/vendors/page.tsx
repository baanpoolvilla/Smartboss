import Link from "next/link";

import { AppScaffold } from "@/components/module/app-scaffold";
import { redirect } from "next/navigation";
import { loadRequests, readSettings, toVendor, withRequestsTenant } from "@/modules/requests/lib/db";
import { canManageVendors, requestsPage, statusOf } from "@/modules/requests/lib/page";
import { VendorEditToggle, VendorForm } from "@/modules/requests/components/vendor-form";
import { StatusChip } from "@/modules/requests/components/ui";
import { bangkokToday, baht, round2, thaiDate } from "@/modules/requests/lib/types";

export const dynamic = "force-dynamic";

/**
 * ทะเบียนช่าง/ร้านภายนอก — เลขผู้เสียภาษี บัญชีธนาคาร % หัก ณ ที่จ่ายตั้งต้น และประวัติงาน
 * ยอดปีนี้แยก ก่อนหัก / หัก ณ ที่จ่าย / จ่ายจริง ให้เห็นชัดว่าหักอะไรไปเท่าไหร่
 */
export default async function VendorsPage() {
  const { session } = await requestsPage();
  if (!(await canManageVendors(session))) redirect("/requests");
  const orgId = session.orgId;
  const year = bangkokToday().slice(0, 4);
  const { vendors, jobs, settings } = await withRequestsTenant(orgId, async (tx) => ({
    vendors: (await tx.moneyVendor.findMany({ where: { orgId }, orderBy: [{ active: "desc" }, { name: "asc" }] })).map(toVendor),
    jobs: await loadRequests(tx, orgId, { kind: "contractor", status: { notIn: ["rejected", "cancelled"] } }, 1000),
    settings: await readSettings(tx, orgId),
  }));

  return (
    <AppScaffold title="ช่าง/ร้านภายนอก" backHref="/requests" width="max-w-6xl">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-3">
          {vendors.length === 0 && <div className="rounded-(--radius-lg) border border-dashed border-(--line) bg-(--bg) p-6 text-center text-sm text-(--ink-soft)">ยังไม่มีในทะเบียน — เพิ่มทางขวา</div>}
          {vendors.map((v) => {
            const mine = jobs.filter((j) => j.vendorId === v.id);
            const thisYear = mine.filter((j) => j.workDate.startsWith(year));
            const gross = round2(thisYear.reduce((s, j) => s + j.amount + j.vatAmount, 0));
            const wht = round2(thisYear.reduce((s, j) => s + j.whtAmount, 0));
            const net = round2(thisYear.reduce((s, j) => s + j.netAmount, 0));
            return (
              <section key={v.id} className={`rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4 ${v.active ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-(--ink)">{v.name}{!v.active && " (ไม่ใช้แล้ว)"}</h2>
                    <div className="text-xs text-(--ink-soft)">
                      {v.kind === "company" ? "บริษัท/ร้าน" : "บุคคล"} · {v.taxId ? `เลขภาษี ${v.taxId}` : "ยังไม่มีเลขผู้เสียภาษี"} · หัก ณ ที่จ่าย {v.whtPercent}%{v.vatRegistered ? " · จด VAT" : ""}
                    </div>
                    {v.bankAccount && <div className="text-xs text-(--ink-soft)">{v.bankName} {v.bankAccount} · {v.accountName || v.name}</div>}
                    {v.phone && <div className="text-xs text-(--ink-soft)">โทร {v.phone}</div>}
                  </div>
                  <VendorEditToggle initial={{ ...v, kind: v.kind === "company" ? "company" : "person" }} whtRates={settings.whtRates} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 rounded-(--radius) bg-(--bg-soft) p-2.5 text-center">
                  <div><div className="text-[11px] text-(--ink-soft)">ปี {Number(year) + 543} ก่อนหัก</div><div className="text-sm font-bold tabular-nums">{baht(gross)}</div></div>
                  <div><div className="text-[11px] text-(--ink-soft)">หัก ณ ที่จ่าย</div><div className="text-sm font-bold tabular-nums text-(--danger)">{wht > 0 ? `−${baht(wht)}` : baht(0)}</div></div>
                  <div><div className="text-[11px] text-(--ink-soft)">จ่ายจริง</div><div className="text-sm font-bold tabular-nums">{baht(net)}</div></div>
                </div>
                {mine.length > 0 && (
                  <ul className="mt-2 divide-y divide-(--line) text-sm">
                    {mine.slice(0, 8).map((j) => (
                      <li key={j.id} className="flex items-center justify-between gap-2 py-1.5">
                        <Link href={`/requests/${j.id}`} className="min-w-0 truncate hover:underline">
                          <span className="text-xs text-(--ink-soft)">{thaiDate(j.workDate)} · </span>{j.title}{j.propertyName ? ` · ${j.propertyName}` : ""}
                        </Link>
                        <span className="flex shrink-0 items-center gap-2">
                          <StatusChip info={statusOf(j)} />
                          <span className="font-semibold tabular-nums">{baht(j.netAmount)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
        <aside className="min-w-0 flex-[1_1_320px] rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4">
          <h2 className="mb-3 text-sm font-bold text-(--ink)">เพิ่มช่าง/ร้าน</h2>
          <VendorForm whtRates={settings.whtRates} />
        </aside>
      </div>
    </AppScaffold>
  );
}
