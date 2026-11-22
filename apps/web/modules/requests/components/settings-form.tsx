"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { saveSettingsAction } from "../actions";
import { KIND_META, KINDS, routeText, type AdvanceCapMode, type ApprovalRoute, type OtRate, type OtRateMode, type RequestKind, type RequestSettings } from "../lib/types";
import { Notice } from "./ui";
import { WorkloadSettings, type WorkloadState } from "./workload-settings";
import { CompanyAccountsSettings, type AccountsState } from "./company-accounts-settings";

import { useCeoTitle } from "@/lib/ceo-title-client";
import { ceoText } from "@/lib/ceo-title-shared";
const field = "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)";
const fieldNoW = field.replace("w-full ", "");

export function SettingsForm({ initial, people = [] }: { initial: RequestSettings; people?: { userId: string; name: string; isWorker: boolean }[] }) {
  const ceo = useCeoTitle();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [rates, setRates] = useState<OtRate[]>(initial.otRates);
  // เกณฑ์ CEO เก็บเป็นข้อความในฟอร์ม — "" = ไม่ต้องผ่าน CEO
  const [routes, setRoutes] = useState<Record<RequestKind, { mode: "hr" | "ceo"; above: string }>>(
    Object.fromEntries(KINDS.map((k) => [k, { mode: initial.approvalRoutes[k].mode, above: initial.approvalRoutes[k].ceoAbove === null ? "" : String(initial.approvalRoutes[k].ceoAbove) }])) as Record<RequestKind, { mode: "hr" | "ceo"; above: string }>,
  );
  const setRoute = (k: RequestKind, patch: Partial<{ mode: "hr" | "ceo"; above: string }>) => setRoutes((r) => ({ ...r, [k]: { ...r[k], ...patch } }));
  const toRoute = (k: RequestKind): ApprovalRoute => ({ mode: routes[k].mode, ceoAbove: routes[k].mode === "ceo" || routes[k].above.trim() === "" ? null : Number(routes[k].above.replace(/,/g, "")) });
  const [capMode, setCapMode] = useState<AdvanceCapMode>(initial.advanceCapMode);
  const [capValue, setCapValue] = useState(String(initial.advanceCapValue || ""));
  const [wht, setWht] = useState(initial.whtRates.join(", "));
  const [vat, setVat] = useState(String(initial.vatPercent));
  const [maxAge, setMaxAge] = useState(String(initial.receiptMaxAgeDays));
  const [pettyReview, setPettyReview] = useState(initial.pettySpendReview);
  const [otRoundBaht, setOtRoundBaht] = useState(initial.otRoundBaht);
  const [otRateMode, setOtRateMode] = useState<OtRateMode>(initial.otRateMode);
  const [clearDays, setClearDays] = useState(String(initial.clearDueDays));
  const [workload, setWorkload] = useState<WorkloadState>({
    spendLimits: initial.spendLimits,
    cashConfirmMode: initial.cashConfirmMode,
    noReceiptOn: initial.noReceiptMax !== null,
    noReceiptMax: initial.noReceiptMax === null ? "" : String(initial.noReceiptMax),
    autoCloseClear: initial.autoCloseClear,
  });
  const [accounts, setAccounts] = useState<AccountsState>({
    companyAccounts: initial.companyAccounts,
    whtCompanyOnly: initial.whtCompanyOnly,
    whtBorneAllowed: initial.whtBorneAllowed,
    payerName: initial.payerName,
    payerTaxId: initial.payerTaxId,
    payerAddress: initial.payerAddress,
  });

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await saveSettingsAction({
        approvalRoutes: Object.fromEntries(KINDS.map((k) => [k, toRoute(k)])) as Record<RequestKind, ApprovalRoute>,
        otRates: rates,
        advanceCapMode: capMode,
        advanceCapValue: Number(capValue) || 0,
        whtRates: wht.split(/[,\s]+/).filter(Boolean).map(Number),
        vatPercent: Number(vat),
        receiptMaxAgeDays: Number(maxAge),
        clearDueDays: Number(clearDays),
        pettySpendReview: pettyReview,
        otRoundBaht,
        otRateMode,
        spendLimits: workload.spendLimits,
        cashConfirmMode: workload.cashConfirmMode,
        noReceiptMax: workload.noReceiptOn ? Number(workload.noReceiptMax.replace(/,/g, "")) : null,
        autoCloseClear: workload.autoCloseClear,
        ...accounts,
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
          <h2 className="text-sm font-bold text-(--ink)">ใครอนุมัติ</h2>
          <p className="text-xs text-(--ink-soft)">ตั้งแยกแต่ละประเภท · ใบที่ HR ยื่นเองหรือเป็นผู้ได้เงินเอง ไป {ceo} เสมอ (อนุมัติใบตัวเองไม่ได้) · มีผลกับใบที่ยื่นใหม่</p>
        </div>
        <ul className="flex flex-col divide-y divide-(--line)">
          {KINDS.map((k) => (
            <li key={k} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 sm:w-44">
                <div className="text-sm font-semibold text-(--ink)">{KIND_META[k].label}</div>
                <div className="text-xs text-(--ink-soft)">{ceoText(routeText(toRoute(k)), ceo)}</div>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={`ผู้อนุมัติ ${KIND_META[k].label}`}>
                {(
                  [
                    ["hr", "HR อนุมัติ"],
                    ["ceo", `${ceo} อนุมัติทุกใบ`],
                  ] as ["hr" | "ceo", string][]
                ).map(([m, label]) => (
                  <button key={m} type="button" aria-pressed={routes[k].mode === m} onClick={() => setRoute(k, { mode: m })} className={`h-9 rounded-full px-3.5 text-sm ${routes[k].mode === m ? "bg-(--brand-navy) font-semibold text-white" : "border border-(--line)"}`}>
                    {label}
                  </button>
                ))}
              </div>
              {routes[k].mode === "hr" && (
                <label className="flex flex-1 items-center gap-2 text-sm">
                  <span className="shrink-0 text-(--ink-soft)">ถ้ายอดเกิน</span>
                  <input inputMode="decimal" className={`${fieldNoW} w-28 text-right`} value={routes[k].above} placeholder="ไม่ต้อง" onChange={(e) => setRoute(k, { above: e.target.value })} aria-label={`เกณฑ์ส่งต่อ ${ceo} ของ ${KIND_META[k].label}`} />
                  <span className="text-(--ink-soft)">บาท ต้องผ่าน {ceo} ด้วย</span>
                </label>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-(--ink-soft)">เว้นช่องว่าง = HR อนุมัติจบเลย ไม่ต้องผ่าน {ceo} · ใส่ 0 = ทุกใบผ่าน HR แล้วต่อ {ceo}</p>
      </section>

      <section className="flex flex-col gap-3 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4">
        <div>
          <h2 className="text-sm font-bold text-(--ink)">วิธีคิดค่า OT ของพนักงานรายเดือน</h2>
          <p className="text-xs text-(--ink-soft)">เลือก 1 แบบ · มีผลกับใบ OT ที่ลงใหม่ ใบเดิมไม่เปลี่ยน · คนงานรายวันใช้ % ในโมดูลคนงาน (ไม่เกี่ยวกับตรงนี้)</p>
        </div>
        <div role="radiogroup" aria-label="วิธีคิดค่า OT" className="flex flex-col gap-2">
          {([
            {
              v: "flat" as const,
              title: "อัตราเดียว — คิดตามชั่วโมงที่ทำ",
              body: "ค่า OT = เงินเดือน ÷ 30 ÷ 8 × ชั่วโมงที่ทำ · ทุกวันคิดเท่ากัน ไม่แยกวันธรรมดา/วันหยุด ไม่คูณ % · คนลง OT ไม่ต้องเลือกอัตรา",
              ex: "เงินเดือน 15,000 ÷ 30 ÷ 8 = 62.50 บาท/ชม. × 3 ชม. = 187.50 บาท",
            },
            {
              v: "standard" as const,
              title: "ตามกฎหมายแรงงาน — แยกอัตราตามประเภท",
              body: "ค่า OT = เงินเดือน ÷ 30 ÷ 8 × % × ชั่วโมง · % ตามประเภทที่ตั้งด้านล่าง (ค่าตั้งต้น: นอกเวลาวันทำงาน 150% · ทำงานในวันหยุด 100% · นอกเวลาในวันหยุด 300%) · คนลง OT เลือกประเภท",
              ex: "เงินเดือน 15,000 ÷ 30 ÷ 8 = 62.50 บาท/ชม. × 150% × 3 ชม. = 281.25 บาท",
            },
          ]).map((o) => (
            <label key={o.v} className={`flex cursor-pointer items-start gap-3 rounded-(--radius) border p-3 text-sm ${otRateMode === o.v ? "border-(--brand-navy,#1b2537) bg-(--bg-soft)" : "border-(--line)"}`}>
              <input type="radio" name="otRateMode" className="mt-1 h-4 w-4" checked={otRateMode === o.v} onChange={() => setOtRateMode(o.v)} />
              <span className="flex flex-col gap-1">
                <span className="font-semibold text-(--ink)">{o.title}</span>
                <span className="text-xs text-(--ink-soft)">{o.body}</span>
                <span className="text-xs text-(--ink)">ตัวอย่าง: {o.ex}</span>
              </span>
            </label>
          ))}
        </div>
        {otRateMode === "standard" && <p className="text-xs font-semibold text-(--ink)">อัตราแต่ละประเภท (แถวแรก = ค่าเริ่มต้นตอนลง OT)</p>}
        {otRateMode === "standard" && rates.map((r, i) => (
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
        {otRateMode === "standard" && (
          <button type="button" className="inline-flex items-center gap-1 self-start text-sm font-medium text-(--app-strong) hover:underline" onClick={() => setRates([...rates, { id: `r${Date.now()}`, label: "", percent: 150 }])}>
            <Plus className="h-4 w-4" aria-hidden="true" /> เพิ่มอัตรา
          </button>
        )}
        <label className="flex items-start gap-3 text-sm text-(--ink)">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={otRoundBaht} onChange={(e) => setOtRoundBaht(e.target.checked)} />
          <span>
            ปัดเศษสตางค์ขึ้นเป็นบาทเต็ม
            <span className="block text-xs text-(--ink-soft)">เช่น 562.50 → 563 บาท · ไม่ติ๊ก = คิดถึงสตางค์ · มีผลกับใบ OT ที่คิดใหม่ ใบเดิมไม่เปลี่ยน</span>
          </span>
        </label>
      </section>

      <section className="flex flex-col gap-3 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4">
        <div>
          <h2 className="text-sm font-bold text-(--ink)">เพดานเบิกล่วงหน้า ต่อคน ต่อเดือน</h2>
          <p className="text-xs text-(--ink-soft)">ใช้กับทั้งคนงานรายวันและพนักงานรายเดือน · เฉพาะใบ &quot;เบิกล่วงหน้า&quot; (ไม่เกี่ยวกับเบิกค่าใช้จ่าย/OT)</p>
        </div>
        <label className="flex items-start gap-3 text-sm text-(--ink)">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={capMode !== "none"}
            onChange={(e) => {
              if (!e.target.checked) {
                setCapMode("none");
                setCapValue("");
              } else setCapMode("baht");
            }}
          />
          <span>
            จำกัดยอดเบิกล่วงหน้า
            <span className="block text-xs text-(--ink-soft)">
              {capMode === "none" ? "ปิดอยู่ — เบิกได้ไม่จำกัด HR/ผู้อนุมัติเป็นคนดูเอง · ติ๊กเมื่ออยากตั้งเพดาน" : "ยื่นเกินเพดานไม่ได้ (นับรวมที่รออนุมัติ/อนุมัติ/จ่ายแล้วในเดือนนั้น)"}
            </span>
          </span>
        </label>
        {capMode !== "none" && <div className="flex flex-wrap gap-2">
          {(
            [
              ["baht", "ไม่เกิน … บาท"],
              ["days", "ไม่เกิน … วันของค่าแรง"],
            ] as [AdvanceCapMode, string][]
          ).map(([m, label]) => (
            <button key={m} type="button" aria-pressed={capMode === m} onClick={() => setCapMode(m)} className={`h-9 rounded-full px-3.5 text-sm ${capMode === m ? "bg-(--brand-navy) font-semibold text-white" : "border border-(--line)"}`}>
              {label}
            </button>
          ))}
        </div>}
        {capMode !== "none" && (
          <label className="flex max-w-xs flex-col gap-1.5 text-sm">
            <span className="font-semibold">{capMode === "baht" ? "เพดาน (บาท)" : "จำนวนวัน"}</span>
            <input inputMode="decimal" className={field} value={capValue} onChange={(e) => setCapValue(e.target.value)} />
            <span className="text-xs text-(--ink-soft)">{capMode === "days" ? "คนงาน = ค่าแรงต่อวัน · พนักงาน = เงินเดือน ÷ 30" : "เท่ากันทุกคน"}</span>
          </label>
        )}
      </section>

      <WorkloadSettings value={workload} onChange={setWorkload} people={people} />

      <CompanyAccountsSettings value={accounts} onChange={setAccounts} />

      <section className="flex flex-col gap-2 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4">
        <h2 className="text-sm font-bold text-(--ink)">เงินสดย่อย</h2>
        <label className="flex items-start gap-2 text-sm text-(--ink)">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={pettyReview} onChange={(e) => setPettyReview(e.target.checked)} />
          <span>
            “ซื้อของเอง” ต้องมีคนตรวจทีหลัง
            <span className="block text-xs text-(--ink-soft)">
              คนถือเงินจ่ายไปก่อนได้ แล้ว HR (หรือ {ceo} ถ้าคนถือเป็น HR) กดผ่าน/ไม่ผ่าน · ไม่ผ่าน = เงินขาดรอคืน ไม่นับเป็นค่าใช้จ่าย · ปิด = ลงแล้วจบ ไม่ต้องตรวจ
            </span>
          </span>
        </label>
      </section>

      <section className="grid grid-cols-1 gap-3 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4 sm:grid-cols-2">
        <h2 className="text-sm font-bold text-(--ink) sm:col-span-2">ภาษี (ช่าง/ร้านภายนอก + เงินสดย่อย)</h2>
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
          <span className="font-semibold">เบิกเงินไปซื้อของ ต้องส่งใบเสร็จภายใน (วัน)</span>
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
