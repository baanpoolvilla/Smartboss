import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";

import { AppScaffold } from "@/components/module/app-scaffold";
import { DW_PERMS } from "@/modules/daily_worker/permissions";
import { bangkokToday, loadMoney } from "@/modules/daily_worker/lib/data";
import { baht, owedOn, shiftMonth } from "@/modules/daily_worker/lib/types";
import { MoneySource } from "@/modules/daily_worker/components/money-source";
import { PayForm, VoidPayment } from "@/modules/daily_worker/components/pay-form";
import { PayTabs } from "@/modules/daily_worker/components/pay-tabs";

export const dynamic = "force-dynamic";

const WD = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];
const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function shiftDate(date: string, delta: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
const monthTitle = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${Number(m.slice(0, 4)) + 543}`;

/**
 * จ่ายเงินคนงาน (บัญชีค้างจ่าย — ผู้ใช้ตกลง 19/10/2569)
 *   วัน: ทุกคนในวันนั้น ยกมา / ได้วันนี้ / ค้างรวม / จ่ายวันนี้ / คงเหลือ + ที่มาของตัวเลขทุกตัว
 *   เดือน: ยกมา / ได้ทั้งเดือน / จ่ายทั้งเดือน / คงเหลือสิ้นเดือน
 * เงินอยู่หน้านี้กับหน้ารายคนเท่านั้น (หน้าลงเวลาวันนี้ไม่มีตัวเงิน — "ไม่งั้นจะซ้ำซ้อน")
 */
export default async function DailyWorkerPayPage({ searchParams }: { searchParams: Promise<{ date?: string; month?: string }> }) {
  const session = await requireOrg();
  if (![DW_PERMS.view, DW_PERMS.manage, DW_PERMS.override, DW_PERMS.pay].some((p) => hasPermission(session, p))) redirect("/");
  const canPay = hasPermission(session, DW_PERMS.manage) || hasPermission(session, DW_PERMS.pay);
  const canAdvance = hasPermission(session, DW_PERMS.pay);

  const sp = await searchParams;
  const today = bangkokToday();
  const monthView = !!sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month);
  const date = !monthView && sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today ? sp.date : today;
  const month = monthView ? sp.month! : date.slice(0, 7);

  const res = await loadMoney(session.orgId, month).catch((error: unknown) => {
    console.error("[daily-workers/pay] load failed", error);
    return null;
  });

  const rows = res ? [...res.money.values()] : [];
  const d = new Date(`${date}T12:00:00+07:00`);
  const dayTitle = `${WD[d.getUTCDay()]} ${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(0, 4)) + 543}`;
  const dayOf = (r: (typeof rows)[number]) => r.days.find((x) => x.date === date);
  const sum = (f: (r: (typeof rows)[number]) => number) => Math.round(rows.reduce((s, r) => s + f(r), 0) * 100) / 100;


  return (
    <AppScaffold title="จ่ายเงินคนงาน" width="max-w-5xl">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <PayTabs active={monthView ? "month" : "day"} month={month} date={monthView ? undefined : date} canSetPay={canAdvance} />
          <span className="flex-1" />
          <Link
            href={monthView ? `/daily-workers/pay-report?month=${month}` : `/daily-workers/pay-report?date=${date}`}
            className="inline-flex items-center gap-1 rounded-full border border-(--line) px-3 py-1.5 text-sm hover:bg-(--bg-soft)"
          >
            <FileText className="h-4 w-4" /> PDF {monthView ? "ทั้งเดือน" : "วันนี้"}
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={monthView ? `?month=${shiftMonth(month, -1)}` : `?date=${shiftDate(date, -1)}`}
            className="rounded-full border border-(--line) bg-(--bg) p-2 hover:bg-(--bg-soft)"
            aria-label="ก่อนหน้า"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div className="flex flex-1 items-center justify-center rounded-full border border-(--line) bg-(--bg) py-2 text-sm font-semibold">
            {monthView ? monthTitle(month) : dayTitle}
          </div>
          {(monthView ? month < today.slice(0, 7) : date < today) ? (
            <Link
              href={monthView ? `?month=${shiftMonth(month, 1)}` : `?date=${shiftDate(date, 1)}`}
              className="rounded-full border border-(--line) bg-(--bg) p-2 hover:bg-(--bg-soft)"
              aria-label="ถัดไป"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <span className="rounded-full border border-(--line) p-2 opacity-30" aria-hidden>
              <ChevronRight className="h-4 w-4" />
            </span>
          )}
        </div>

        {!res ? (
          <div className="rounded-2xl border border-(--line) bg-(--bg) p-6 text-sm text-(--ink-soft)">อ่านข้อมูลไม่ได้ ลองรีเฟรชอีกครั้ง</div>
        ) : monthView ? (
          <MonthTable rows={rows} month={month} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label={`ได้วันนี้ (${rows.length} คน)`} value={baht(sum((r) => dayOf(r)?.earned ?? 0))} />
              <Stat label="ค้างรวม (ก่อนจ่าย)" value={baht(sum((r) => Math.max(0, (dayOf(r)?.carried ?? r.opening) + (dayOf(r)?.earned ?? 0))))} tone="warn" />
              <Stat label="จ่ายวันนี้" value={baht(sum((r) => dayOf(r)?.paid ?? 0))} tone="ok" />
              <Stat label="ยังค้างหลังจ่าย" value={baht(sum((r) => Math.max(0, dayOf(r)?.balance ?? r.opening)))} />
              <Stat label="เบิกเกินรวม" value={baht(sum((r) => Math.max(0, -(dayOf(r)?.balance ?? r.opening))))} tone="bad" />
            </div>

            <ul className="flex flex-col gap-2">
              {rows.map((r) => {
                const day = dayOf(r);
                const w = r.worker;
                const cell = w.cells[Number(date.slice(8))];
                const owed = day ? owedOn(r.days, date) : 0;
                const allPay = res.payments.filter((p) => p.employmentId === w.employmentId);
                return (
                  <li key={w.employmentId} className="rounded-2xl border border-(--line) bg-(--bg)">
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <Link href={`/daily-workers/w/${w.employmentId}?month=${month}`} className="min-w-0 flex-1 basis-40">
                        <b className="block truncate text-sm hover:underline">{w.name}</b>
                        <span className="block text-xs text-(--ink-soft)">
                          {w.employeeCode ?? ""} · {w.dailyWage === null ? <span className="text-(--tone-warn)">ยังไม่ตั้งค่าแรง{canAdvance && " (ตั้งที่แท็บ ตั้งค่าแรง)"}</span> : `ค่าแรง ${baht(w.dailyWage)}/วัน`}
                        </span>
                      </Link>
                      <dl className="grid grid-cols-4 gap-x-3 text-right text-xs tabular-nums sm:gap-x-5">
                        <Cell k="ยกมา" v={baht(day?.carried ?? r.opening)} />
                        <Cell k="ได้วันนี้" v={day?.earned ? `+${baht(day.earned)}` : "0"} />
                        <Cell k="จ่าย" v={day?.paid ? `−${baht(day.paid)}` : "—"} />
                        <Cell k="คงเหลือ" v={baht(day?.balance ?? r.opening)} tone={(day?.balance ?? 0) < 0 ? "bad" : (day?.balance ?? 0) > 0 ? "warn" : "ok"} />
                      </dl>
                      {canPay && day && (
                        <PayForm employmentId={w.employmentId!} name={w.name} date={date} owed={owed} earnedToday={day.earned} canAdvance={canAdvance} />
                      )}
                    </div>
                    {day && (
                      <details className="border-t border-(--line) px-4 py-2">
                        <summary className="cursor-pointer text-xs font-semibold text-sky-700 dark:text-sky-300">ที่มาของตัวเลข</summary>
                        <div className="mt-2">
                          <MoneySource day={day} cell={cell} employmentId={w.employmentId!} allPayments={allPay} />
                          {day.payments.length > 0 && (canAdvance || canPay) && (
                            <div className="mt-2 flex flex-wrap gap-3">
                              {day.payments.map((p) => (
                                <span key={p.id} className="text-xs text-(--ink-soft)">
                                  จ่าย {baht(p.amount)} · <VoidPayment id={p.id} />
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </details>
                    )}
                  </li>
                );
              })}
              {rows.length === 0 && <li className="rounded-2xl border border-(--line) bg-(--bg) p-6 text-center text-sm text-(--ink-soft)">ยังไม่มีคนงาน</li>}
            </ul>
            <p className="text-xs text-(--ink-soft)">
              คงเหลือ บวก = บริษัทค้างจ่าย (ยกไปวันถัดไป) · ลบ = เบิกเกิน หักจากค่าแรงวันถัดไปเอง · ผู้ดูแลบ้านจ่ายได้ไม่เกินยอดค้าง · ให้เบิกล่วงหน้าได้เฉพาะ HR
            </p>
          </>
        )}
      </div>
    </AppScaffold>
  );
}

function MonthTable({
  rows,
  month,
}: {
  rows: { worker: { employmentId: string | null; name: string; employeeCode: string | null }; opening: number; earned: number; paid: number; closing: number }[];
  month: string;
}) {
  const s = (f: (r: (typeof rows)[number]) => number) => Math.round(rows.reduce((t, r) => t + f(r), 0) * 100) / 100;
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="ยกมาต้นเดือน" value={baht(s((r) => r.opening))} />
        <Stat label="ได้ทั้งเดือน" value={baht(s((r) => r.earned))} />
        <Stat label="จ่ายทั้งเดือน" value={baht(s((r) => r.paid))} tone="ok" />
        <Stat label="คงเหลือสิ้นเดือน" value={baht(s((r) => r.closing))} tone="warn" />
      </div>
      <div className="overflow-x-auto rounded-2xl border border-(--line) bg-(--bg)">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-(--bg-soft) text-xs text-(--ink-soft)">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">คนงาน</th>
              <th className="px-3 py-2 text-right font-semibold">ยกมา</th>
              <th className="px-3 py-2 text-right font-semibold">ได้ทั้งเดือน</th>
              <th className="px-3 py-2 text-right font-semibold">จ่ายทั้งเดือน</th>
              <th className="px-3 py-2 text-right font-semibold">คงเหลือ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.worker.employmentId} className="border-t border-(--line) tabular-nums">
                <td className="px-3 py-2">
                  <Link href={`/daily-workers/w/${r.worker.employmentId}?month=${month}`} className="font-medium hover:underline">
                    {r.worker.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right">{baht(r.opening)}</td>
                <td className="px-3 py-2 text-right">+{baht(r.earned)}</td>
                <td className="px-3 py-2 text-right text-(--tone-ok)">−{baht(r.paid)}</td>
                <td className={`px-3 py-2 text-right font-semibold ${r.closing < 0 ? "text-(--tone-danger)" : ""}`}>{baht(r.closing)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-(--ink-soft)">คงเหลือ = ยกมา + ได้ − จ่าย · กดชื่อเพื่อดูทุกรายการและที่มาของตัวเลข</p>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "text-(--tone-ok)" : tone === "warn" ? "text-(--tone-warn)" : tone === "bad" ? "text-(--tone-danger)" : "";
  return (
    <div className="rounded-2xl border border-(--line) bg-(--bg) p-3 text-center">
      <p className="text-xs text-(--ink-soft)">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function Cell({ k, v, tone }: { k: string; v: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-(--tone-danger)" : tone === "warn" ? "text-(--tone-warn)" : "";
  return (
    <div>
      <dt className="text-[11px] text-(--ink-soft)">{k}</dt>
      <dd className={`m-0 font-semibold ${color}`}>{v}</dd>
    </div>
  );
}
