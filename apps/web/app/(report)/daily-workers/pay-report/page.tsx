import Link from "next/link";
import { redirect } from "next/navigation";
import { hasPermission, requireOrg } from "@smartboss/auth";

import { DW_PERMS } from "@/modules/daily_worker/permissions";
import { bangkokToday, loadMoney, summarize, type WorkerMoney } from "@/modules/daily_worker/lib/data";
import { baht, minutesToHm } from "@/modules/daily_worker/lib/types";
import { PrintButton } from "@/modules/daily_worker/components/print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "เอกสารค่าแรงคนงาน · Smartboss" };

const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const WD = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const STATUS: Record<string, string> = { m: "มา", s: "สาย", x: "ขาด", n: "ไม่มา", o: "หยุด", l: "ลา", r: "หยุดกะ" };
const thDay = (date: string) => `${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(0, 4)) + 543}`;
const thMonth = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${Number(m.slice(0, 4)) + 543}`;

/**
 * เอกสารค่าแรงคนงาน (PDF) — ผู้ใช้ขอ 19/10/2569 "วันนี้ได้เท่าไหร่ เดือนนั้นได้เท่าไหร่ ยอดจ่ายไปเท่าไหร่ทั้งเดือน"
 *   ?date=   ใบจ่ายเงินประจำวัน: ทุกคน ยกมา/ได้วันนี้ (แยกค่าแรง หัก OT)/จ่าย/คงเหลือ + ช่องเซ็นรับเงิน
 *   ?month=  สรุปทั้งเดือนทุกคน + รายวันของแต่ละคนหน้าละคน (&employment= เฉพาะคนเดียว)
 * อยู่นอกกลุ่ม (shell) ให้ไม่มีเมนูแอปติดตอนพิมพ์ · ตัวเลขทั้งหมดมาจาก loadMoney ตัวเดียวกับหน้าจ่ายเงิน
 */
export default async function PayReportPage({ searchParams }: { searchParams: Promise<{ date?: string; month?: string; employment?: string }> }) {
  const session = await requireOrg();
  if (![DW_PERMS.view, DW_PERMS.manage, DW_PERMS.pay].some((p) => hasPermission(session, p))) redirect("/");
  const sp = await searchParams;
  const today = bangkokToday();
  const monthMode = !!sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month);
  const date = !monthMode && sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today ? sp.date : today;
  const month = monthMode ? sp.month! : date.slice(0, 7);
  const res = await loadMoney(session.orgId, month);
  let rows = [...res.money.values()];
  if (sp.employment) rows = rows.filter((r) => r.worker.employmentId === sp.employment);
  const generatedAt = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date());
  const r2 = (n: number) => Math.round(n * 100) / 100;

  return (
    <div className="min-h-screen bg-(--bg-soft) text-(--ink) print:bg-white">
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print { html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        .doc table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
        .doc th, .doc td { border: 1px solid #d4dbd7; padding: 4px 6px; }
        .doc th { background: #eef3f0; font-weight: 600; }
        .doc td.n, .doc th.n { text-align: right; font-variant-numeric: tabular-nums; }
      `}</style>
      <div className="border-b border-(--line) bg-(--bg) print:hidden">
        <div className="mx-auto flex max-w-[210mm] flex-wrap items-center gap-3 px-4 py-3">
          <Link href={monthMode ? `/daily-workers/pay?month=${month}` : `/daily-workers/pay?date=${date}`} className="text-sm text-(--ink-soft) hover:text-(--ink)">
            ← กลับหน้าจ่ายเงิน
          </Link>
          <span className="ml-auto" />
          <PrintButton />
        </div>
      </div>

      <main className="doc mx-auto my-6 max-w-[210mm] bg-white px-6 py-8 text-black shadow print:m-0 print:max-w-none print:p-0 print:shadow-none sm:px-10">
        {monthMode ? (
          <>
            <h1 className="text-lg font-bold">สรุปค่าแรงคนงาน · {thMonth(month)}</h1>
            <p className="mb-4 text-xs text-neutral-600">
              พิมพ์เมื่อ {generatedAt} · ข้อมูลถึง {thDay(res.data.today.startsWith(month) ? res.data.today : `${month}-${String(res.data.days).padStart(2, "0")}`)}
            </p>
            <table>
              <thead>
                <tr>
                  <th>คนงาน</th>
                  <th className="n">มา (วัน)</th>
                  <th className="n">สาย/กลับก่อน (นาที)</th>
                  <th className="n">ขาด</th>
                  <th className="n">ยกมา</th>
                  <th className="n">ได้ทั้งเดือน</th>
                  <th className="n">จ่ายทั้งเดือน</th>
                  <th className="n">คงเหลือ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = summarize(r.worker);
                  return (
                    <tr key={r.worker.employmentId}>
                      <td>{r.worker.name} {r.worker.employeeCode && <span className="text-neutral-500">({r.worker.employeeCode})</span>}</td>
                      <td className="n">{s.present}</td>
                      <td className="n">{s.lateMin + s.earlyMin}</td>
                      <td className="n">{s.absent}</td>
                      <td className="n">{baht(r.opening)}</td>
                      <td className="n">{baht(r.earned)}</td>
                      <td className="n">{baht(r.paid)}</td>
                      <td className="n">{baht(r.closing)}</td>
                    </tr>
                  );
                })}
                <tr>
                  <th>รวม</th>
                  <th className="n" colSpan={3}></th>
                  <th className="n">{baht(r2(rows.reduce((t, r) => t + r.opening, 0)))}</th>
                  <th className="n">{baht(r2(rows.reduce((t, r) => t + r.earned, 0)))}</th>
                  <th className="n">{baht(r2(rows.reduce((t, r) => t + r.paid, 0)))}</th>
                  <th className="n">{baht(r2(rows.reduce((t, r) => t + r.closing, 0)))}</th>
                </tr>
              </tbody>
            </table>
            <p className="mt-1 text-[10.5px] text-neutral-600">คงเหลือ = ยกมา + ได้ − จ่าย · บวก = ค้างจ่าย · ลบ = เบิกเกิน</p>

            {rows.map((r) => (
              <WorkerDays key={r.worker.employmentId} r={r} month={month} />
            ))}
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold">ใบจ่ายค่าแรงคนงาน · {thDay(date)}</h1>
            <p className="mb-4 text-xs text-neutral-600">พิมพ์เมื่อ {generatedAt}</p>
            <table>
              <thead>
                <tr>
                  <th>คนงาน</th>
                  <th>ลงเวลา</th>
                  <th className="n">ยกมา</th>
                  <th className="n">ค่าแรง</th>
                  <th className="n">หัก</th>
                  <th className="n">OT</th>
                  <th className="n">ได้วันนี้</th>
                  <th className="n">จ่าย</th>
                  <th className="n">คงเหลือ</th>
                  <th style={{ width: "22%" }}>เซ็นรับเงิน</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = r.days.find((x) => x.date === date);
                  const c = r.worker.cells[Number(date.slice(8))];
                  return (
                    <tr key={r.worker.employmentId}>
                      <td>{r.worker.name}</td>
                      <td>
                        {c?.s ? STATUS[c.s] : "—"}
                        {c?.inAt && ` ${c.inAt}–${c.outAt ?? "?"}`}
                        {c?.lateMin ? ` สาย ${c.lateMin}น.` : ""}
                        {c?.earlyMin ? ` กลับก่อน ${c.earlyMin}น.` : ""}
                        {c?.edit ? ` (แก้เวลาโดย ${c.edit.byName})` : ""}
                      </td>
                      <td className="n">{baht(d?.carried ?? r.opening)}</td>
                      <td className="n">{c?.pay ? baht(c.pay.wage) : "—"}</td>
                      <td className="n">{c?.pay?.deduct ? `−${baht(c.pay.deduct)}` : ""}</td>
                      <td className="n">{c?.pay?.ot ? `+${baht(c.pay.ot)}` : ""}</td>
                      <td className="n">{baht(d?.earned ?? 0)}</td>
                      <td className="n">{d?.paid ? baht(d.paid) : ""}</td>
                      <td className="n">{baht(d?.balance ?? r.opening)}</td>
                      <td></td>
                    </tr>
                  );
                })}
                <tr>
                  <th colSpan={6}>รวม</th>
                  <th className="n">{baht(r2(rows.reduce((t, r) => t + (r.days.find((x) => x.date === date)?.earned ?? 0), 0)))}</th>
                  <th className="n">{baht(r2(rows.reduce((t, r) => t + (r.days.find((x) => x.date === date)?.paid ?? 0), 0)))}</th>
                  <th className="n">{baht(r2(rows.reduce((t, r) => t + (r.days.find((x) => x.date === date)?.balance ?? r.opening), 0)))}</th>
                  <th></th>
                </tr>
              </tbody>
            </table>
            <p className="mt-1 text-[10.5px] text-neutral-600">
              หักสาย/กลับก่อน นาทีละ ค่าแรง÷480 · OT = ชั่วโมง × ค่าแรง÷8 × % · คงเหลือ = ยกมา + ได้วันนี้ − จ่าย (บวก = ค้างจ่าย ลบ = เบิกเกิน)
            </p>
            {rows.some((r) => r.days.find((x) => x.date === date)?.payments.some((p) => p.kind === "advance")) && (
              <p className="mt-2 text-[11px]">
                <b>เบิกล่วงหน้าวันนี้:</b>{" "}
                {rows
                  .flatMap((r) => (r.days.find((x) => x.date === date)?.payments ?? []).filter((p) => p.kind === "advance").map((p) => `${r.worker.name} ${baht(p.amount)} (${p.note}) บันทึกโดย ${p.byName}`))
                  .join(" · ")}
              </p>
            )}
            <div className="mt-10 grid grid-cols-2 gap-10 text-xs">
              <div className="border-t border-neutral-400 pt-1 text-center">ผู้จ่ายเงิน</div>
              <div className="border-t border-neutral-400 pt-1 text-center">ผู้ตรวจ (HR)</div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function WorkerDays({ r, month }: { r: WorkerMoney; month: string }) {
  const w = r.worker;
  return (
    <section className="mt-8 print:break-before-page">
      <h2 className="text-base font-bold">
        {w.name} {w.employeeCode && <span className="font-normal text-neutral-500">({w.employeeCode})</span>} · {thMonth(month)}
      </h2>
      <p className="mb-2 text-xs text-neutral-600">
        กะ {w.shiftId ? `${minutesToHm(w.shiftStart)}–${minutesToHm(w.shiftEnd)}` : "-"} · ค่าแรง {w.dailyWage === null ? "ยังไม่ตั้ง" : `${baht(w.dailyWage)} บาท/วัน`} · ยกมา {baht(r.opening)}
      </p>
      <table>
        <thead>
          <tr>
            <th>วันที่</th>
            <th>สถานะ</th>
            <th>เข้า–ออก</th>
            <th className="n">สาย/กลับก่อน</th>
            <th className="n">ค่าแรง</th>
            <th className="n">หัก</th>
            <th className="n">OT</th>
            <th className="n">ได้</th>
            <th className="n">จ่าย</th>
            <th className="n">คงเหลือ</th>
          </tr>
        </thead>
        <tbody>
          {r.days.map((d) => {
            const c = w.cells[Number(d.date.slice(8))];
            return (
              <tr key={d.date}>
                <td>
                  {WD[new Date(`${d.date}T12:00:00Z`).getUTCDay()]} {Number(d.date.slice(8))}
                </td>
                <td>
                  {c?.s ? STATUS[c.s] : "—"}
                  {c?.edit ? " *" : ""}
                </td>
                <td>{c?.inAt ? `${c.inAt}–${c.outAt ?? "?"}` : ""}</td>
                <td className="n">{(c?.lateMin ?? 0) + (c?.earlyMin ?? 0) || ""}</td>
                <td className="n">{c?.pay ? baht(c.pay.wage) : ""}</td>
                <td className="n">{c?.pay?.deduct ? `−${baht(c.pay.deduct)}` : ""}</td>
                <td className="n">{c?.pay?.ot ? `+${baht(c.pay.ot)}` : ""}</td>
                <td className="n">{d.earned ? baht(d.earned) : ""}</td>
                <td className="n">
                  {d.paid ? baht(d.paid) : ""}
                  {d.payments.some((p) => p.kind === "advance") ? " (เบิก)" : ""}
                </td>
                <td className="n">{baht(d.balance)}</td>
              </tr>
            );
          })}
          <tr>
            <th colSpan={7}>รวมเดือน</th>
            <th className="n">{baht(r.earned)}</th>
            <th className="n">{baht(r.paid)}</th>
            <th className="n">{baht(r.closing)}</th>
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-[10.5px] text-neutral-600">* = ผู้ดูแลแก้เวลา (ดูเหตุผลในระบบ) · สาย/กลับก่อนเป็นนาที</p>
    </section>
  );
}
