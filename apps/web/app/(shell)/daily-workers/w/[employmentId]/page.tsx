import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";

import { AppScaffold } from "@/components/module/app-scaffold";
import { DW_PERMS } from "@/modules/daily_worker/permissions";
import { bangkokToday, loadMoney, summarize } from "@/modules/daily_worker/lib/data";
import { baht, changedAfterPay, owedOn, shiftLabel, shiftMonth } from "@/modules/daily_worker/lib/types";
import { MoneySource } from "@/modules/daily_worker/components/money-source";
import { PayForm, VoidPayment } from "@/modules/daily_worker/components/pay-form";
import { AuditList } from "@/modules/daily_worker/components/audit-list";
import { readAudit } from "@/modules/daily_worker/lib/db";

export const dynamic = "force-dynamic";

const WD = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const STATUS: Record<string, string> = { m: "มา", s: "สาย", x: "ขาด", n: "ไม่มา", o: "หยุด", l: "ลา", r: "หยุดกะ" };

/**
 * บัญชีของคนงานคนเดียวทั้งเดือน (ผู้ใช้ขอ 19/10/2569 — เรื่องเงินต้องตรวจย้อนได้ทุกบาท)
 * วันละแถว: ลงเวลา · ได้ · จ่าย · คงเหลือ · กดแถวดู "ที่มาของตัวเลข" · ยกมา/คงเหลือ ต่อจากเดือนก่อน
 */
export default async function WorkerLedgerPage({ params, searchParams }: { params: Promise<{ employmentId: string }>; searchParams: Promise<{ month?: string }> }) {
  const session = await requireOrg();
  if (![DW_PERMS.view, DW_PERMS.manage, DW_PERMS.override, DW_PERMS.pay].some((p) => hasPermission(session, p))) redirect("/");
  const canPay = hasPermission(session, DW_PERMS.manage) || hasPermission(session, DW_PERMS.pay);
  const canAdvance = hasPermission(session, DW_PERMS.pay);

  const { employmentId } = await params;
  const { month: raw } = await searchParams;
  const today = bangkokToday();
  const month = raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : today.slice(0, 7);
  const res = await loadMoney(session.orgId, month);
  const m = res.money.get(employmentId);
  if (!m) notFound();
  const w = m.worker;
  const s = summarize(w);
  const allPay = res.payments.filter((p) => p.employmentId === employmentId);
  const voided = allPay.filter((p) => p.voided);
  const changedDays = m.days.filter((d) => {
    const c = w.cells[Number(d.date.slice(8))];
    return c?.pay && changedAfterPay(d.date, c.pay.total, allPay);
  });
  const lastDay = m.days[m.days.length - 1];
  const audit = await readAudit(session.orgId, {
    from: new Date(`${month}-01T00:00:00+07:00`),
    to: new Date(`${shiftMonth(month, 1)}-01T00:00:00+07:00`),
    employmentId,
    limit: 300,
  }).catch(() => []);
  const [y, mo] = month.split("-").map(Number) as [number, number];

  return (
    <AppScaffold title={w.name} width="max-w-none" backHref={`/daily-workers/pay?month=${month}`}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-(--line) bg-(--bg) p-4">
          <div className="min-w-0 flex-1 basis-56">
            <b className="text-base">{w.name}</b>
            <p className="text-xs text-(--ink-soft)">
              {w.employeeCode ?? ""} · กะ {shiftLabel(w) ?? "ยังไม่ผูก"} ·{" "}
              {w.dailyWage === null ? <span className="text-(--tone-warn)">ยังไม่ตั้งค่าแรง</span> : `ค่าแรง ${baht(w.dailyWage)}/วัน`} · OT {w.otPercent ?? res.data.otPercent}%
              {w.otPercent === null && " (กลาง)"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Link href={`?month=${shiftMonth(month, -1)}`} className="rounded-full p-1.5 hover:bg-(--bg-soft)" aria-label="เดือนก่อน">
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <b className="min-w-28 text-center text-sm">
              {MONTHS[mo - 1]} {y + 543}
            </b>
            <Link href={`?month=${shiftMonth(month, 1)}`} className="rounded-full p-1.5 hover:bg-(--bg-soft)" aria-label="เดือนถัดไป">
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <Link href={`/daily-workers/pay-report?month=${month}&employment=${employmentId}`} className="inline-flex items-center gap-1 rounded-full border border-(--line) px-3 py-1.5 text-sm hover:bg-(--bg-soft)">
            <FileText className="h-4 w-4" /> PDF ของคนนี้
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          <Stat label="มา" value={`${s.present} วัน`} />
          <Stat label="สาย / กลับก่อน" value={`${s.lateMin + s.earlyMin} นาที`} tone="warn" />
          <Stat label="ขาด" value={`${s.absent} วัน`} tone="bad" />
          <Stat label="ได้ทั้งเดือน" value={baht(m.earned)} />
          <Stat label="จ่ายทั้งเดือน" value={baht(m.paid)} tone="ok" />
          <Stat label={m.closing < 0 ? "เบิกเกิน" : "คงเหลือ (ค้างจ่าย)"} value={baht(Math.abs(m.closing))} tone={m.closing < 0 ? "bad" : "warn"} />
        </div>
        <p className="-mt-2 text-xs text-(--ink-soft)">
          ยกมาจากเดือนก่อน {baht(m.opening)} + ได้ {baht(m.earned)} − จ่าย {baht(m.paid)} = คงเหลือ {baht(m.closing)}
        </p>

        {changedDays.length > 0 && (
          <div className="rounded-xl border border-(--tone-warn)/40 bg-(--tone-warn)/10 px-3 py-2 text-sm">
            ⚠ {changedDays.length} วันยอดเปลี่ยนหลังจ่ายไปแล้ว (มีคนแก้เวลาภายหลัง) — กดดูที่วันที่มีป้ายเหลือง · ส่วนต่างรวมอยู่ในคงเหลือแล้ว
          </div>
        )}

        {canPay && lastDay && lastDay.date === today && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-(--line) bg-(--bg) p-3">
            <span className="text-sm">
              วันนี้ค้างจ่าย <b>{baht(owedOn(m.days, today))}</b> บาท
            </span>
            <PayForm employmentId={employmentId} name={w.name} date={today} owed={owedOn(m.days, today)} earnedToday={lastDay.earned} canAdvance={canAdvance} />
          </div>
        )}

        <ul className="flex flex-col gap-1.5">
          {[...m.days].reverse().map((d) => {
            const c = w.cells[Number(d.date.slice(8))];
            const wd = WD[new Date(`${d.date}T12:00:00Z`).getUTCDay()];
            const changed = c?.pay ? changedAfterPay(d.date, c.pay.total, allPay) : null;
            return (
              <li key={d.date} className={`rounded-xl border border-(--line) ${changed ? "bg-(--tone-warn)/10" : "bg-(--bg)"}`}>
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <b className="w-14 tabular-nums">
                      {wd} {Number(d.date.slice(8))}
                    </b>
                    <span className="min-w-0 flex-1 basis-40 text-xs text-(--ink-soft)">
                      {c?.s ? STATUS[c.s] : "—"}
                      {c?.inAt && ` · ${c.inAt}–${c.outAt ?? "ไม่ลงออก"}`}
                      {c?.lateMin ? ` · สาย ${c.lateMin}` : ""}
                      {c?.earlyMin ? ` · กลับก่อน ${c.earlyMin}` : ""}
                      {c?.ot ? ` · OT ${c.ot.start}–${c.ot.end}` : ""}
                      {c?.edit ? " · แก้เวลา" : ""}
                      {changed ? " · ยอดเปลี่ยนหลังจ่าย" : ""}
                    </span>
                    <span className="grid grid-cols-3 gap-x-4 text-right text-xs tabular-nums">
                      <span>{d.earned ? `+${baht(d.earned)}` : "0"}</span>
                      <span className="text-(--tone-ok)">{d.paid ? `−${baht(d.paid)}` : "—"}</span>
                      <b className={d.balance < 0 ? "text-(--tone-danger)" : ""}>{baht(d.balance)}</b>
                    </span>
                  </summary>
                  <div className="border-t border-(--line) px-3 py-2">
                    <MoneySource day={d} cell={c} employmentId={employmentId} allPayments={allPay} showLinks={false} />
                    {d.payments.length > 0 && (canPay || canAdvance) && (
                      <div className="mt-2 flex flex-wrap gap-3">
                        {d.payments.map((p) => (
                          <span key={p.id} className="text-xs text-(--ink-soft)">
                            จ่าย {baht(p.amount)} · <VoidPayment id={p.id} />
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
          <li className="px-3 py-1 text-xs text-(--ink-soft)">ยกมาจากเดือนก่อน {baht(m.opening)}</li>
        </ul>
        <p className="text-xs text-(--ink-soft)">คอลัมน์: ได้ · จ่าย · คงเหลือสิ้นวัน · กดวันไหนเพื่อดูที่มาของตัวเลข</p>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">ประวัติการแก้ไขของคนนี้ (เดือนนี้)</h2>
          <AuditList events={audit} names={{ [employmentId]: w.name }} showWho={false} />
        </section>

        {voided.length > 0 && (
          <section className="rounded-2xl border border-(--line) bg-(--bg) p-3 text-xs text-(--ink-soft)">
            <b className="text-(--ink)">รายการจ่ายที่ถูกยกเลิก (ไม่นับในยอด)</b>
            <ul className="mt-1 flex flex-col gap-0.5">
              {voided.map((p) => (
                <li key={p.id}>
                  {p.date} · {baht(p.amount)} โดย {p.byName} · ยกเลิกโดย {p.voided!.byName}: {p.voided!.reason}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AppScaffold>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "text-(--tone-ok)" : tone === "warn" ? "text-(--tone-warn)" : tone === "bad" ? "text-(--tone-danger)" : "";
  return (
    <div className="rounded-2xl border border-(--line) bg-(--bg) p-3 text-center">
      <p className="text-xs text-(--ink-soft)">{label}</p>
      <p className={`text-base font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
