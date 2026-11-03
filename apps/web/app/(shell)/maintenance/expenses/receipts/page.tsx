import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";
import { loadMonthReceipts } from "@/modules/maintenance/data/expense-receipts";
import { fmtThaiDate, fmtThaiDateTime } from "@/modules/maintenance/lib/format";
import { paymentMethodLabel } from "@/modules/maintenance/lib/receipt-read";

const MONTHS = ["", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const baht = (n: number) => `฿${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/** ใบเสร็จของแจ้งซ่อม รายเดือน แยกตามบ้าน (ผู้ใช้ 3/11/2569 "โมดูลใครโมดูลมัน เอามาสรุปยอดได้") */
export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string; house?: string }> }) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.expenseView)) redirect("/");
  const sp = await searchParams;
  const now = new Date();
  const year = Number(sp.year) || now.getFullYear();
  const month = Number(sp.month) || now.getMonth() + 1;
  const house = sp.house || null;
  const data = await loadMonthReceipts(session.orgId, year, month, house);
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const q = (y: number, m: number, h: string | null) => `/maintenance/expenses/receipts?year=${y}&month=${m}${h ? `&house=${h}` : ""}`;

  return (
    <AppScaffold
      title="ใบเสร็จ"
      width="max-w-none"
      backHref={`/maintenance/expenses?year=${year}&month=${month}`}
      actions={
        <a
          href={`/maintenance/expenses/receipts/export?year=${year}&month=${month}${house ? `&house=${house}` : ""}`}
          title="ดาวน์โหลด CSV"
          aria-label="ดาวน์โหลด CSV"
          className="rounded-full p-2 text-(--app-strong) transition-colors hover:bg-(--bg-soft)"
        >
          <Download className="h-5 w-5" />
        </a>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href={q(prev.y, prev.m, house)} aria-label="เดือนก่อน" className="rounded-(--radius) border border-(--line) p-2 hover:bg-(--bg-soft)">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <span className="min-w-36 text-center text-sm font-semibold text-(--ink)">{MONTHS[month]} {year + 543}</span>
        <Link href={q(next.y, next.m, house)} aria-label="เดือนถัดไป" className="rounded-(--radius) border border-(--line) p-2 hover:bg-(--bg-soft)">
          <ChevronRight className="h-4 w-4" />
        </Link>
        <form method="get" className="flex items-center gap-2">
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="month" value={month} />
          <select name="house" defaultValue={house ?? ""} aria-label="เลือกบ้าน" className="h-9 rounded-(--radius) border border-(--line) bg-(--bg) px-2 text-sm text-(--ink)">
            <option value="">ทุกบ้าน</option>
            {data.houses.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
          <button type="submit" className="h-9 rounded-(--radius) border border-(--line) px-3 text-sm hover:bg-(--bg-soft)">ดู</button>
        </form>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-(--ink-soft)">จ่ายจริงเดือนนี้</p>
          <p className="text-xl font-bold tabular-nums text-(--ink)" data-testid="real-total">{baht(data.realTotal)}</p>
          <p className="text-xs text-(--ink-soft)">ใบหลายบ้านนับครั้งเดียว</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-(--ink-soft)">รวมตามบ้าน (ตรงกับรายงานค่าใช้จ่าย)</p>
          <p className="text-xl font-bold tabular-nums text-(--ink)" data-testid="house-total">{baht(data.houseTotal)}</p>
          <p className="text-xs text-(--ink-soft)">ใบหลายบ้านลงเต็มยอดทุกบ้าน</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-(--ink-soft)">ใบเสร็จ</p>
          <p className="text-xl font-bold tabular-nums text-(--ink)">{data.withReceipt} <span className="text-sm font-normal text-(--ink-soft)">ใบ · ไม่มีใบเสร็จ {data.without}</span></p>
        </Card>
      </div>

      {!house && data.byHouse.length > 0 && (
        <Card className="mb-4 p-4">
          <h2 className="mb-2 text-sm font-bold text-(--ink)">สรุปรายบ้าน</h2>
          <div className="flex flex-col divide-y divide-(--line)">
            {data.byHouse.map((h) => (
              <Link key={h.id} href={h.id ? q(year, month, h.id) : "#"} className="flex items-center justify-between gap-3 py-1.5 text-sm hover:underline">
                <span className="text-(--ink)">{h.name} <span className="text-xs text-(--ink-soft)">{h.count} รายการ</span></span>
                <span className="font-semibold tabular-nums text-(--ink)">{baht(h.total)}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {data.items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-(--ink-soft)">ไม่มีรายการในเดือนนี้</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((i) => (
            <Card key={i.id} className="flex gap-3 p-3" data-testid="receipt-item">
              {i.receiptUrl && !i.fromRequest ? (
                <a href={i.receiptUrl} target="_blank" rel="noreferrer" className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={i.receiptUrl} alt={`ใบเสร็จ ${i.description ?? ""}`} loading="lazy" className="h-20 w-16 rounded-md border border-(--line) object-cover" />
                </a>
              ) : (
                <span className="flex h-20 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-(--line) p-1 text-center text-[10px] text-(--ink-soft)">
                  {i.fromRequest ? "รูปอยู่ในใบเบิก" : i.noReceipt ? "ไม่มีใบเสร็จ" : "ไม่ได้แนบ"}
                </span>
              )}
              <div className="min-w-0 text-sm">
                <p className="font-bold tabular-nums text-(--ink)">{baht(i.amount)}</p>
                <p className="truncate text-(--ink)">{i.description ?? "-"}</p>
                <p className="truncate text-xs text-(--ink-soft)">{i.houseNames.join(", ")}</p>
                <p className="truncate text-xs text-(--ink-soft)">
                  {[i.paidAt ? fmtThaiDateTime(i.paidAt) : fmtThaiDate(i.date), i.payee, paymentMethodLabel(i.paymentMethod), i.receiptNo ? `เลขที่ ${i.receiptNo}` : null].filter(Boolean).join(" · ")}
                </p>
                {i.workOrder && (
                  <Link href={`/maintenance/work-orders/${i.workOrder.id}`} className="text-xs text-[#0F766E] hover:underline">
                    {i.workOrder.code}
                  </Link>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </AppScaffold>
  );
}
