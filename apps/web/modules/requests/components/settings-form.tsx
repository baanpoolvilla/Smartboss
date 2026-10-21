"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { saveSettingsAction } from "../actions";
import type { AdvanceCapMode, OtRate, RequestSettings } from "../lib/types";
import { Notice } from "./ui";

const field = "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)";
const fieldNoW = field.replace("w-full ", "");

export function SettingsForm({ initial }: { initial: RequestSettings }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [rates, setRates] = useState<OtRate[]>(initial.otRates);
  const [capMode, setCapMode] = useState<AdvanceCapMode>(initial.advanceCapMode);
  const [capValue, setCapValue] = useState(String(initial.advanceCapValue || ""));
  const [wht, setWht] = useState(initial.whtRates.join(", "));
  const [vat, setVat] = useState(String(initial.vatPercent));
  const [maxAge, setMaxAge] = useState(String(initial.receiptMaxAgeDays));
  const [clearDays, setClearDays] = useState(String(initial.clearDueDays));

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await saveSettingsAction({
        otRates: rates,
        advanceCapMode: capMode,
        advanceCapValue: Number(capValue) || 0,
        whtRates: wht.split(/[,\s]+/).filter(Boolean).map(Number),
        vatPercent: Number(vat),
        receiptMaxAgeDays: Number(maxAge),
        clearDueDays: Number(clearDays),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4">
        <div>
          <h2 className="text-sm font-bold text-(--ink)">อัตรา OT ของพนักงาน</h2>
          <p className="text-xs text-(--ink-soft)">ค่า OT = เงินเดือน ÷ 30 ÷ 8 × % × ชั่วโมง · แอดมินเลือกอัตราตอนลง (แถวแรก = ค่าเริ่มต้น) · คนงานรายวันใช้ % ในโมดูลคนงาน</p>
        </div>
        {rates.map((r, i) => (
          <div key={i} className="flex gap-2">
            <input className={`${fieldNoW} min-w-0 flex-1`} value={r.label} aria-label={`ชื่ออัตราที่ ${i + 1}`} onChange={(e) => setRates(rates.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <div className="relative w-28">
              <input inputMode="decimal" className={`${field} pr-7 text-right`} value={r.percent} aria-label={`เปอร์เซ็นต์อัตราที่ ${i + 1}`} onChange={(e) => setRates(rates.map((x, j) => (j === i ? { ...x, percent: Number(e.target.value) || 0 } : x)))} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-(--ink-soft)">%</span>
            </div>
            {rates.length > 1 && (
              <button type="button" aria-label="ลบอัตรา" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-(--radius) border border-(--line) text-(--ink-soft) hover:bg-(--bg-soft)" onClick={() => setRates(rates.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        <button type="button" className="inline-flex items-center gap-1 self-start text-sm font-medium text-(--app-strong) hover:underline" onClick={() => setRates([...rates, { id: `r${Date.now()}`, label: "", percent: 150 }])}>
          <Plus className="h-4 w-4" aria-hidden="true" /> เพิ่มอัตรา
        </button>
      </section>

      <section className="flex flex-col gap-3 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4">
        <div>
          <h2 className="text-sm font-bold text-(--ink)">เพดานเบิกล่วงหน้า ต่อคน ต่อเดือน</h2>
          <p className="text-xs text-(--ink-soft)">ยื่นเกินเพดานไม่ได้ (นับรวมที่รออนุมัติ/อนุมัติ/จ่ายแล้วในเดือนนั้น)</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["baht", "ไม่เกิน … บาท"],
              ["days", "ไม่เกิน … วันของค่าแรง"],
              ["none", "ไม่จำกัด"],
            ] as [AdvanceCapMode, string][]
          ).map(([m, label]) => (
            <button key={m} type="button" aria-pressed={capMode === m} onClick={() => setCapMode(m)} className={`h-9 rounded-full px-3.5 text-sm ${capMode === m ? "bg-(--brand-navy) font-semibold text-white" : "border border-(--line)"}`}>
              {label}
            </button>
          ))}
        </div>
        {capMode !== "none" && (
          <label className="flex max-w-xs flex-col gap-1.5 text-sm">
            <span className="font-semibold">{capMode === "baht" ? "เพดาน (บาท)" : "จำนวนวัน"}</span>
            <input inputMode="decimal" className={field} value={capValue} onChange={(e) => setCapValue(e.target.value)} />
            <span className="text-xs text-(--ink-soft)">{capMode === "days" ? "คนงาน = ค่าแรงต่อวัน · พนักงาน = เงินเดือน ÷ 30" : "เท่ากันทุกคน"}</span>
          </label>
        )}
      </section>

      <section className="grid grid-cols-1 gap-3 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4 sm:grid-cols-2">
        <h2 className="text-sm font-bold text-(--ink) sm:col-span-2">ภาษี (ช่าง/ร้านภายนอก)</h2>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">VAT (%)</span>
          <input inputMode="decimal" className={field} value={vat} onChange={(e) => setVat(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">% หัก ณ ที่จ่ายให้เลือก</span>
          <input className={field} value={wht} onChange={(e) => setWht(e.target.value)} placeholder="0, 1, 2, 3, 5" />
          <span className="text-xs text-(--ink-soft)">คั่นด้วยจุลภาค · ภาษีเปลี่ยนเมื่อไหร่แก้ที่นี่ได้เลย</span>
        </label>
      </section>

      <section className="grid grid-cols-1 gap-3 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">เตือนใบเสร็จเก่ากว่า (วัน)</span>
          <input inputMode="numeric" className={field} value={maxAge} onChange={(e) => setMaxAge(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">เบิกเงินไปก่อน ต้องเคลียร์ภายใน (วัน)</span>
          <input inputMode="numeric" className={field} value={clearDays} onChange={(e) => setClearDays(e.target.value)} />
        </label>
      </section>

      {error && <Notice tone="danger">{error}</Notice>}
      {saved && <Notice tone="ok">บันทึกแล้ว — มีผลกับใบที่ยื่นใหม่ (ใบเดิมเก็บตัวเลขตอนยื่นไว้)</Notice>}
      <button type="button" onClick={save} disabled={busy} className="inline-flex h-12 items-center justify-center gap-2 rounded-(--radius) bg-(--app) px-4 text-base font-semibold text-white hover:brightness-95 disabled:opacity-50">
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}บันทึกการตั้งค่า
      </button>
    </div>
  );
}
