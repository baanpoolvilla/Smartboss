"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveDwSettingsAction, savePayRateAction } from "../actions";
import { baht } from "../lib/types";

interface Row {
  employmentId: string;
  name: string;
  employeeCode: string | null;
  dailyWage: number | null;
  otPercent: number | null;
}

/**
 * ตั้งค่าแรงคนงาน (ผู้ใช้ขอ 19/10/2569 — "ตั้งค่าเงินเดือน และค่า OT ได้ เฉพาะของคนงาน")
 *   - % OT กลางของบริษัท (ค่าเริ่มต้น 150)
 *   - ค่าแรงต่อวัน + % OT เฉพาะคน (เว้นว่าง = ใช้ % กลาง) — เลือกหลายคนตั้งพร้อมกันได้ · มีผลตั้งแต่วันที่เลือก
 * OT ต่อชั่วโมง = ค่าแรงวัน ÷ 8 × % · หักสาย/กลับก่อน นาทีละ ค่าแรงวัน ÷ 480
 */
export function PaySettings({ rows, otPercent, today }: { rows: Row[]; otPercent: number; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [wage, setWage] = useState("");
  const [ot, setOt] = useState("");
  const [from, setFrom] = useState(today);
  const [companyOt, setCompanyOt] = useState(String(otPercent));
  const [status, setStatus] = useState<string | null>(null);

  const run = (task: () => Promise<{ error?: string; done?: number }>, ok: string) =>
    startTransition(async () => {
      const r = await task();
      if (r.error) setStatus(`⚠ ${r.error}`);
      else {
        setStatus(ok);
        setSel(new Set());
        router.refresh();
      }
    });

  const toggle = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSel(next);
  };
  const allOn = rows.length > 0 && rows.every((r) => sel.has(r.employmentId));
  const wageNum = Number(wage);

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-(--line) bg-(--bg) p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">ค่าแรงคนงาน</h2>
          <p className="text-xs text-(--ink-soft)">
            ค่าแรงต่อวัน · หักสาย/กลับก่อน นาทีละ ค่าแรง÷480 · OT ชั่วโมงละ ค่าแรง÷8 × %
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          % OT ค่ากลาง
          <input
            id="dw-company-ot"
            type="number"
            min={1}
            max={1000}
            value={companyOt}
            onChange={(e) => setCompanyOt(e.target.value)}
            className="w-20 rounded-lg border border-(--line) bg-(--bg) px-2 py-1 text-right tabular-nums"
          />
          %
        </label>
        <button
          type="button"
          disabled={pending || Number(companyOt) === otPercent || !(Number(companyOt) > 0)}
          onClick={() => run(() => saveDwSettingsAction({ otPercent: Number(companyOt) }), `ตั้ง % OT ค่ากลางเป็น ${companyOt}% แล้ว`)}
          className="rounded-full border border-(--line) px-3 py-1.5 text-sm hover:bg-(--bg-soft) disabled:opacity-40"
        >
          บันทึก % กลาง
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-xs text-(--ink-soft)">
            <tr>
              <th className="w-8 py-1.5 text-left">
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={() => setSel(allOn ? new Set() : new Set(rows.map((r) => r.employmentId)))}
                  aria-label="เลือกทุกคน"
                />
              </th>
              <th className="py-1.5 text-left font-semibold">ชื่อ</th>
              <th className="py-1.5 text-right font-semibold">ค่าแรง/วัน</th>
              <th className="py-1.5 text-right font-semibold">OT/ชม.</th>
              <th className="py-1.5 text-right font-semibold">% OT</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pct = r.otPercent ?? otPercent;
              return (
                <tr key={r.employmentId} className="border-t border-(--line)">
                  <td className="py-1.5">
                    <input type="checkbox" checked={sel.has(r.employmentId)} onChange={() => toggle(r.employmentId)} aria-label={`เลือก ${r.name}`} />
                  </td>
                  <td className="py-1.5">
                    <button type="button" onClick={() => toggle(r.employmentId)} className="text-left font-medium">
                      {r.name}
                    </button>
                    {r.employeeCode && <span className="ml-1 text-xs text-(--ink-soft)">{r.employeeCode}</span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {r.dailyWage === null ? <span className="text-(--tone-warn)">ยังไม่ตั้ง</span> : `${baht(r.dailyWage)} บาท`}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-(--ink-soft)">
                    {r.dailyWage === null ? "—" : `${baht(Math.round(((r.dailyWage / 8) * pct) / 100 * 100) / 100)} บาท`}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {pct}%{r.otPercent === null && <span className="text-xs text-(--ink-soft)"> (กลาง)</span>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-(--ink-soft)">
                  ยังไม่มีคนงานที่ผูกทะเบียนแล้ว
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-(--bg-soft) p-3 text-sm">
        <span className="pb-1.5 font-semibold">{sel.size === 0 ? "เลือกคนงานก่อน" : `ตั้งให้ ${sel.size} คน`}</span>
        <label className="flex flex-col gap-1 text-xs text-(--ink-soft)">
          ค่าแรงต่อวัน (บาท)
          <input id="dw-wage" type="number" min={1} value={wage} onChange={(e) => setWage(e.target.value)} placeholder="เช่น 400" className="w-28 rounded-lg border border-(--line) bg-(--bg) px-2 py-1 text-sm text-(--ink) tabular-nums" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-(--ink-soft)">
          % OT (เว้นว่าง = ค่ากลาง {otPercent}%)
          <input id="dw-ot-pct" type="number" min={1} max={1000} value={ot} onChange={(e) => setOt(e.target.value)} placeholder={String(otPercent)} className="w-28 rounded-lg border border-(--line) bg-(--bg) px-2 py-1 text-sm text-(--ink) tabular-nums" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-(--ink-soft)">
          มีผลตั้งแต่วันที่
          <input id="dw-wage-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-(--line) bg-(--bg) px-2 py-1 text-sm text-(--ink)" />
        </label>
        <button
          type="button"
          disabled={pending || sel.size === 0 || !(wageNum > 0) || !from}
          onClick={() =>
            run(
              () => savePayRateAction({ employmentIds: [...sel], dailyWage: wageNum, otPercent: ot.trim() ? Number(ot) : null, from }),
              `ตั้งค่าแรง ${baht(wageNum)} บาท/วัน ให้ ${sel.size} คน (มีผลตั้งแต่ ${from}) แล้ว`,
            )
          }
          className="rounded-full bg-(--ink) px-4 py-1.5 font-semibold text-(--bg) disabled:opacity-40"
        >
          บันทึกค่าแรง
        </button>
        {wageNum > 0 && (
          <span className="pb-1.5 text-xs text-(--ink-soft)">
            สาย 1 นาที หัก {baht(Math.round((wageNum / 480) * 100) / 100)} บาท · OT ชม.ละ {baht(Math.round(((wageNum / 8) * (ot.trim() ? Number(ot) : otPercent)) / 100 * 100) / 100)} บาท
          </span>
        )}
      </div>
      <p className="text-xs text-(--ink-soft)">ตั้งค่าแรงใหม่ วันก่อนวันที่มีผลยังคิดเรทเดิม · ยังไม่ได้ตั้งในหน้านี้ ระบบจะใช้เงินเดือนแบบรายวันในระบบบุคคล (ถ้ามี)</p>
      {status && <p role="status" className="text-sm">{status}</p>}
    </section>
  );
}
