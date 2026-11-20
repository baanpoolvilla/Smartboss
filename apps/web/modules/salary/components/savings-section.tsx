"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Notice } from "@/modules/requests/components/ui";
import { savingsPayoutAction, setSavingsOpeningAction } from "../actions";
import type { SavingsBook } from "../lib/savings";
import { fmtBaht, thaiDate } from "../lib/types";
import { card, field, hint, label, labelText, navy, outline } from "./ui";
import { useRun } from "./use-run";

/** 6. เงินสะสม — สมุดรายคน: ยอดยกมา (ก่อนมีระบบ) + ยอดจากรอบที่จ่ายแล้ว − จ่ายคืน */
export function SavingsSection({ employmentId, books, today }: { employmentId: string; books: SavingsBook[]; today: string }) {
  if (books.length === 0) return null;
  return (
    <>
      {books.map((b) => (
        <Book key={b.itemId} employmentId={employmentId} b={b} today={today} />
      ))}
    </>
  );
}

const num = (s: string) => Number(s.replace(/,/g, "").trim() || 0);

function Book({ employmentId, b, today }: { employmentId: string; b: SavingsBook; today: string }) {
  const [mode, setMode] = useState<"" | "opening" | "payout">("");
  const [emp, setEmp] = useState(b.opening ? String(b.opening.employee) : "");
  const [com, setCom] = useState(b.opening ? String(b.opening.employer) : "");
  const [note, setNote] = useState(b.opening?.note ?? "");
  const [onDate, setOnDate] = useState(today);
  const [payNote, setPayNote] = useState("");
  const { busy, error, run } = useRun();
  const cell = "px-2 py-2 text-right tabular-nums";
  return (
    <section className={`${card} flex flex-col gap-3 p-4 sm:p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-(--ink)">6. เงินสะสม — {b.name}</h2>
        <div className="flex gap-3 text-sm font-semibold">
          {mode !== "opening" && <button type="button" className="text-(--app-strong) underline" onClick={() => setMode("opening")}>{b.opening ? "แก้ยอดยกมา" : "+ ยอดยกมา (ก่อนมีระบบ)"}</button>}
          {b.total > 0 && mode !== "payout" && <button type="button" className="text-(--app-strong) underline" onClick={() => setMode("payout")}>จ่ายคืนแล้ว</button>}
        </div>
      </div>
      <p className={hint}>ยอดจากรอบเงินเดือนเข้าเองเมื่อรอบ &quot;จ่ายแล้ว&quot; · พนักงานเห็นแค่ยอดรวมในสลิปของฉัน</p>

      {b.rows.length === 0 ? (
        <p className="text-sm text-(--ink-soft)">ยังไม่มียอด — คนที่จ่ายไว้ก่อนมีระบบ กด &quot;+ ยอดยกมา&quot;</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-xs text-(--ink-soft)">
                <th className="px-2 py-1.5 text-left font-semibold">รายการ</th>
                <th className="px-2 py-1.5 text-right font-semibold">พนักงาน</th>
                <th className="px-2 py-1.5 text-right font-semibold">บริษัท</th>
                <th className="px-2 py-1.5 text-right font-semibold">รวม</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) => {
                const sign = r.kind === "payout" ? "−" : "";
                return (
                  <tr key={r.key} className={`border-t border-(--line) ${r.kind === "opening" ? "bg-amber-50" : r.kind === "payout" ? "bg-(--bg-soft)" : ""}`}>
                    <td className="px-2 py-2">
                      <div className={r.kind === "payroll" ? "" : "font-semibold"}>{r.label}</div>
                      {(r.note || r.by || r.kind !== "payroll") && (
                        <div className="text-xs text-(--ink-soft)">{[r.kind !== "payroll" ? thaiDate(r.date) : "", r.note, r.by ? `โดย ${r.by}` : ""].filter(Boolean).join(" · ")}</div>
                      )}
                    </td>
                    <td className={cell}>{sign}{fmtBaht(r.employee)}</td>
                    <td className={cell}>{sign}{fmtBaht(r.employer)}</td>
                    <td className={cell}>{sign}{fmtBaht(r.employee + r.employer)}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-(--brand-navy,#1b2537) font-bold">
                <td className="px-2 py-2">คงเหลือสะสม</td>
                <td className={cell}>{fmtBaht(b.employee)}</td>
                <td className={cell}>{fmtBaht(b.employer)}</td>
                <td className={`${cell} text-base`}>{fmtBaht(b.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {mode === "opening" && (
        <div className="grid grid-cols-1 gap-3 rounded-(--radius) border border-dashed border-(--line) bg-(--bg-soft) p-3 sm:grid-cols-2">
          <p className={`${hint} sm:col-span-2`}>ยอดที่จ่ายไว้แล้วก่อนเริ่มหักในระบบ · ใส่ 0 ทั้งคู่ = ลบยอดยกมา · แก้แล้วเก็บประวัติว่าใครแก้</p>
          <label className={label}>
            <span className={labelText}>ส่วนพนักงาน (บาท)</span>
            <input inputMode="decimal" className={field} value={emp} onChange={(e) => setEmp(e.target.value)} placeholder="0.00" />
          </label>
          <label className={label}>
            <span className={labelText}>ส่วนบริษัท (บาท)</span>
            <input inputMode="decimal" className={field} value={com} onChange={(e) => setCom(e.target.value)} placeholder="0.00" />
          </label>
          <label className={`${label} sm:col-span-2`}>
            <span className={labelText}>หมายเหตุ</span>
            <input className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น จ่ายครบถึง ธ.ค. 2569" />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" className={outline} onClick={() => setMode("")} disabled={busy}>ยกเลิก</button>
            <button type="button" className={navy} disabled={busy} onClick={() => run(() => setSavingsOpeningAction({ employmentId, itemId: b.itemId, employee: num(emp), employer: num(com), note }), () => setMode(""))}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} บันทึกยอดยกมา
            </button>
          </div>
        </div>
      )}

      {mode === "payout" && (
        <div className="grid grid-cols-1 gap-3 rounded-(--radius) border border-dashed border-(--line) bg-(--bg-soft) p-3 sm:grid-cols-2">
          <p className={`${hint} sm:col-span-2`}>บันทึกว่าจ่ายคืนแล้วทั้งก้อน {fmtBaht(b.total)} (พนักงาน {fmtBaht(b.employee)} + บริษัท {fmtBaht(b.employer)}) · ยอดคงเหลือกลับเป็น 0 ประวัติยังอยู่</p>
          <label className={label}>
            <span className={labelText}>วันที่จ่ายคืน</span>
            <input type="date" className={field} value={onDate} onChange={(e) => setOnDate(e.target.value)} />
          </label>
          <label className={label}>
            <span className={labelText}>หมายเหตุ</span>
            <input className={field} value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="เช่น ลาออก โอนคืนแล้ว" />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" className={outline} onClick={() => setMode("")} disabled={busy}>ยกเลิก</button>
            <button type="button" className={navy} disabled={busy || !onDate} onClick={() => run(() => savingsPayoutAction({ employmentId, itemId: b.itemId, onDate, note: payNote }), () => setMode(""))}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} ยืนยันจ่ายคืน
            </button>
          </div>
        </div>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </section>
  );
}
