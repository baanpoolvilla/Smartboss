"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Notice } from "@/modules/requests/components/ui";
import { addRecurringAction, endRecurringAction, saveProfileAction, setSalaryAction, type ProfileInput } from "../actions";
import { ALLOWANCE_FIELDS, fmtBaht, normalizeAllowances, periodLabel, thaiDate, type AllowanceEntry } from "../lib/types";
import { card, field, hint, label, labelText, navy, outline } from "./ui";
import { useRun } from "./use-run";

const BANKS = ["กสิกรไทย", "ไทยพาณิชย์", "กรุงเทพ", "กรุงไทย", "กรุงศรีอยุธยา", "ทหารไทยธนชาต (ttb)", "ออมสิน", "ธ.ก.ส.", "ยูโอบี", "ซีไอเอ็มบี", "เกียรตินาคินภัทร", "แลนด์ แอนด์ เฮ้าส์", "อื่นๆ"];

/** 1. เงินเดือน — ตั้ง/ขึ้นเงินเดือน (มีวันมีผล เก็บประวัติ) */
export function SalarySection({ employmentId, salary, history, hiredOn, today }: { employmentId: string; salary: number | null; history: { amount: number; from: string; to: string | null; note: string }[]; hiredOn: string; today: string }) {
  const [amount, setAmount] = useState(salary !== null ? String(salary) : "");
  const [from, setFrom] = useState(salary === null ? hiredOn : today);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(salary === null);
  const { busy, error, run } = useRun();
  return (
    <section className={`${card} flex flex-col gap-3 p-4 sm:p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-(--ink)">1. เงินเดือน</h2>
        {salary !== null && !open && <button type="button" className="text-sm font-semibold text-(--app-strong) underline" onClick={() => setOpen(true)}>ปรับ/ขึ้นเงินเดือน</button>}
      </div>
      {salary !== null && <div className="text-2xl font-bold tabular-nums text-(--ink)">{fmtBaht(salary)} <span className="text-sm font-normal text-(--ink-soft)">/ เดือน</span></div>}
      {open && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className={label}>
            <span className={labelText}>เงินเดือนใหม่ (บาท)</span>
            <input inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className={label}>
            <span className={labelText}>มีผลตั้งแต่</span>
            <input type="date" className={field} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className={label}>
            <span className={labelText}>เหตุผล</span>
            <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ปรับประจำปี / ผ่านโปร" />
          </label>
          <div className="flex gap-2 sm:col-span-3">
            {salary !== null && <button type="button" className={outline} onClick={() => setOpen(false)} disabled={busy}>ยกเลิก</button>}
            <button type="button" className={navy} disabled={busy || !amount || !from} onClick={() => run(() => setSalaryAction({ employmentId, amount: Number(amount.replace(/,/g, "")), effectiveFrom: from, reason }), () => setOpen(false))}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} บันทึกเงินเดือน
            </button>
          </div>
          <p className={`${hint} sm:col-span-3`}>มีผลกลางงวด = งวดนั้นคิดถัวตามจำนวนวันของแต่ละอัตรา · ประวัติเดิมเก็บไว้ ไม่ทับ</p>
        </div>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-(--ink-soft)">ประวัติเงินเดือน ({history.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {history.map((h, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>{thaiDate(h.from)} – {h.to ? thaiDate(h.to) : "ปัจจุบัน"}{h.note ? ` · ${h.note}` : ""}</span>
                <span className="tabular-nums">{fmtBaht(h.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** 2–4. การรับเงิน · ประกันสังคม · ภาษี (ติ๊กแบบอื่นแล้วมีช่องให้กรอก) */
export function ProfileSection({ employmentId, initial, year }: { employmentId: string; initial: Omit<ProfileInput, "employmentId">; year: number }) {
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useRun();
  const set = (patch: Partial<typeof v>) => {
    setSaved(false);
    setV({ ...v, ...patch });
  };
  // ช่องนับคน/ติ๊ก เก็บเป็น count · ช่องเงินเก็บ amount — ยอดจริงคิดด้วย normalizeAllowances ตัวเดียวกับ server
  const entry = (key: string) => v.allowances.find((a) => a.key === key);
  const setAllowance = (key: string, labelText: string, patch: Partial<AllowanceEntry>) => {
    const rest = v.allowances.filter((a) => a.key !== key);
    const next = { key, label: labelText, amount: 0, ...entry(key), ...patch };
    set({ allowances: (next.count ?? 0) > 0 || next.amount > 0 ? [...rest, next] : rest });
  };
  const others = v.allowances.filter((a) => !ALLOWANCE_FIELDS.some((f) => f.key === a.key));
  const normalized = normalizeAllowances(v.allowances);
  const total = normalized.list.reduce((s, a) => s + a.amount, 0);
  const countOf = (key: string) => normalized.list.find((a) => a.key === key)?.count ?? 0;
  const bankIsOther = v.bankName !== "" && !BANKS.slice(0, -1).includes(v.bankName);
  const chip = (on: boolean) => `h-10 rounded-full border px-4 text-sm ${on ? "border-(--brand-navy,#1b2537) bg-(--brand-navy,#1b2537)/10 font-semibold text-(--ink)" : "border-(--line) text-(--ink-soft)"}`;

  return (
    <div className="flex flex-col gap-4">
      <section className={`${card} flex flex-col gap-3 p-4 sm:p-5`}>
        <h2 className="text-base font-bold text-(--ink)">2. การรับเงิน</h2>
        <div role="radiogroup" aria-label="ช่องทางรับเงิน" className="flex gap-2">
          <button type="button" role="radio" aria-checked={v.payChannel === "transfer"} className={chip(v.payChannel === "transfer")} onClick={() => set({ payChannel: "transfer" })}>โอนเข้าบัญชี</button>
          <button type="button" role="radio" aria-checked={v.payChannel === "cash"} className={chip(v.payChannel === "cash")} onClick={() => set({ payChannel: "cash" })}>เงินสด</button>
        </div>
        {v.payChannel === "transfer" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className={label}>
              <span className={labelText}>ธนาคาร</span>
              <select className={field} value={bankIsOther ? "อื่นๆ" : v.bankName} onChange={(e) => set({ bankName: e.target.value })}>
                <option value="">— เลือก —</option>
                {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              {bankIsOther && (
                <input aria-label="ชื่อธนาคาร" className={field} value={v.bankName === "อื่นๆ" ? "" : v.bankName} onChange={(e) => set({ bankName: e.target.value || "อื่นๆ" })} placeholder="พิมพ์ชื่อธนาคาร" />
              )}
            </label>
            <label className={label}>
              <span className={labelText}>เลขบัญชี</span>
              <input inputMode="numeric" className={field} value={v.bankAccount} onChange={(e) => set({ bankAccount: e.target.value.replace(/[^\d-]/g, "") })} placeholder="10–12 หลัก" />
            </label>
            <label className={label}>
              <span className={labelText}>ชื่อบัญชี</span>
              <input className={field} value={v.accountName} onChange={(e) => set({ accountName: e.target.value })} />
            </label>
          </div>
        ) : (
          <p className="rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-sm">จ่ายเงินสด — ไม่อยู่ในไฟล์โอน · สลิปออกตามปกติ · พนักงานกด &quot;ได้รับเงินสดแล้ว&quot; ในสลิปได้</p>
        )}
      </section>

      <section className={`${card} flex flex-col gap-3 p-4 sm:p-5`}>
        <h2 className="text-base font-bold text-(--ink)">3. ประกันสังคม</h2>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={!v.ssoExempt} onChange={(e) => set({ ssoExempt: !e.target.checked })} />
          หักประกันสังคม (มาตรา 33) — ระบบคิดให้ตามอัตราในตั้งค่า
        </label>
        {v.ssoExempt && (
          <label className={label}>
            <span className={labelText}>เหตุผลที่ไม่หัก (จำเป็น)</span>
            <select className={field} value={["อายุเกิน 60 ปีตอนเริ่มงาน", "กรรมการ/เจ้าของ (ไม่ใช่ลูกจ้าง)", "แรงงานต่างด้าวที่ได้รับยกเว้น"].includes(v.ssoExemptReason) ? v.ssoExemptReason : v.ssoExemptReason ? "อื่น" : ""} onChange={(e) => set({ ssoExemptReason: e.target.value === "อื่น" ? " " : e.target.value })}>
              <option value="">— เลือก —</option>
              <option>อายุเกิน 60 ปีตอนเริ่มงาน</option>
              <option>กรรมการ/เจ้าของ (ไม่ใช่ลูกจ้าง)</option>
              <option>แรงงานต่างด้าวที่ได้รับยกเว้น</option>
              <option value="อื่น">อื่นๆ (พิมพ์เอง)</option>
            </select>
            {!["", "อายุเกิน 60 ปีตอนเริ่มงาน", "กรรมการ/เจ้าของ (ไม่ใช่ลูกจ้าง)", "แรงงานต่างด้าวที่ได้รับยกเว้น"].includes(v.ssoExemptReason) && (
              <input className={field} value={v.ssoExemptReason.trim()} onChange={(e) => set({ ssoExemptReason: e.target.value || " " })} placeholder="พิมพ์เหตุผล" />
            )}
          </label>
        )}
      </section>

      <section className={`${card} flex flex-col gap-3 p-4 sm:p-5`}>
        <h2 className="text-base font-bold text-(--ink)">4. ภาษีหัก ณ ที่จ่าย</h2>
        <div role="radiogroup" aria-label="วิธีหักภาษี" className="flex flex-wrap gap-2">
          <button type="button" role="radio" aria-checked={v.taxMode === "auto"} className={chip(v.taxMode === "auto")} onClick={() => set({ taxMode: "auto" })}>ระบบคิดให้ (แนะนำ)</button>
          <button type="button" role="radio" aria-checked={v.taxMode === "fixed"} className={chip(v.taxMode === "fixed")} onClick={() => set({ taxMode: "fixed" })}>หักเท่ากันทุกเดือน</button>
          <button type="button" role="radio" aria-checked={v.taxMode === "none"} className={chip(v.taxMode === "none")} onClick={() => set({ taxMode: "none" })}>ไม่หักภาษี</button>
        </div>
        {v.taxMode === "fixed" && (
          <label className={`${label} max-w-xs`}>
            <span className={labelText}>หักเดือนละ (บาท)</span>
            <input inputMode="decimal" className={field} value={String(v.taxFixedAmount)} onChange={(e) => set({ taxFixedAmount: Number(e.target.value.replace(/,/g, "")) || 0 })} />
            <span className={hint}>ระบบยังคิดยอดที่ควรหักไว้เทียบ ถ้าต่างมากจะเตือนในรอบเงินเดือน</span>
          </label>
        )}
        {v.taxMode === "none" && (
          <label className={label}>
            <span className={labelText}>เหตุผล (จำเป็น)</span>
            <input className={field} value={v.taxNoneReason} onChange={(e) => set({ taxNoneReason: e.target.value })} placeholder="เช่น ยื่นภาษีเอง" />
          </label>
        )}
        {v.taxMode !== "none" && (
          <>
            <div className="text-sm font-semibold text-(--ink)">ค่าลดหย่อนตาม ล.ย.01 ที่พนักงานยื่น (ต่อปี)</div>
            <p className={hint}>ลดหย่อนส่วนตัวและประกันสังคมที่จ่ายจริง ระบบใส่ให้เอง ไม่ต้องกรอก</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {ALLOWANCE_FIELDS.map((f) =>
                f.kind === "flag" ? (
                  <label key={f.key} className="flex min-h-11 items-center gap-3 self-end text-sm sm:col-span-1">
                    <input type="checkbox" className="h-5 w-5" checked={countOf(f.key) > 0} onChange={(e) => setAllowance(f.key, f.label, { count: e.target.checked ? 1 : 0, amount: 0 })} />
                    <span>{f.label} <span className="text-(--ink-soft)">({f.hint})</span></span>
                  </label>
                ) : f.kind === "count" ? (
                  <label key={f.key} className={label}>
                    <span className={labelText}>{f.label}</span>
                    <div className="flex items-center gap-2">
                      <input inputMode="numeric" className={`${field} w-24`} value={entry(f.key)?.count ? String(entry(f.key)!.count) : ""} onChange={(e) => setAllowance(f.key, f.label, { count: Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0), amount: 0 })} placeholder="0" />
                      <span className="text-sm text-(--ink-soft)">คน{countOf(f.key) > 0 && <> = <strong className="tabular-nums text-(--ink)">{fmtBaht(countOf(f.key) * f.per!)}</strong></>}</span>
                    </div>
                    {f.hint && <span className={hint}>{f.hint}</span>}
                  </label>
                ) : (
                  <label key={f.key} className={label}>
                    <span className={labelText}>{f.label} (บาท)</span>
                    <input inputMode="decimal" className={field} value={entry(f.key)?.amount ? String(entry(f.key)!.amount) : ""} onChange={(e) => setAllowance(f.key, f.label, { amount: Number(e.target.value.replace(/,/g, "")) || 0 })} placeholder="0" />
                    {f.hint && <span className={hint}>{f.hint}</span>}
                  </label>
                ),
              )}
            </div>
            {normalized.notes.length > 0 && <Notice tone="warn">{normalized.notes.map((n) => <div key={n}>{n}</div>)}</Notice>}
            {others.map((o: AllowanceEntry) => (
              <div key={o.key} className="grid grid-cols-[1fr_10rem_auto] gap-2">
                <input aria-label="ชื่อค่าลดหย่อน" className={field} value={o.label} onChange={(e) => set({ allowances: v.allowances.map((a) => (a.key === o.key ? { ...a, label: e.target.value } : a)) })} />
                <input aria-label="จำนวน" inputMode="decimal" className={field} value={String(o.amount)} onChange={(e) => set({ allowances: v.allowances.map((a) => (a.key === o.key ? { ...a, amount: Number(e.target.value.replace(/,/g, "")) || 0 } : a)) })} />
                <button type="button" className={outline} onClick={() => set({ allowances: v.allowances.filter((a) => a.key !== o.key) })}>ลบ</button>
              </div>
            ))}
            <button type="button" className="self-start text-sm font-semibold text-(--app-strong) underline" onClick={() => set({ allowances: [...v.allowances, { key: `other_${Date.now()}`, label: "", amount: 0 }] })}>
              + ค่าลดหย่อนอื่นๆ (พิมพ์ชื่อเอง)
            </button>
            <div className="text-sm">รวมลดหย่อนเพิ่ม <strong className="tabular-nums">{fmtBaht(total)}</strong> ต่อปี</div>
            <div className="grid grid-cols-1 gap-3 border-t border-(--line) pt-3 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <div className="text-sm font-semibold text-(--ink)">ยอดยกมาปี {year + 543} (ที่ไม่ได้จ่ายผ่านระบบนี้)</div>
                <p className={hint}>
                  ใส่ยอดรวมตั้งแต่ ม.ค. ถึงก่อนเริ่มใช้ระบบนี้ — เงินเดือนที่บริษัทนี้จ่ายไปก่อนเริ่มใช้ระบบ และ/หรือจากที่ทำงานเดิม (ตาม 50 ทวิ) รวมกันช่องเดียว
                  · ไม่ใส่ = ระบบประมาณจากเงินเดือนปัจจุบันให้ (ภาษีไม่หักขาด แต่อาจคลาดเล็กน้อย)
                </p>
              </div>
              <label className={label}>
                <span className={labelText}>เงินได้สะสม (บาท)</span>
                <input inputMode="decimal" className={field} value={v.prevYear === year && v.prevIncome ? String(v.prevIncome) : ""} onChange={(e) => set({ prevIncome: Number(e.target.value.replace(/,/g, "")) || 0, prevYear: year })} placeholder="0" />
              </label>
              <label className={label}>
                <span className={labelText}>ภาษีที่หักไปแล้ว (บาท)</span>
                <input inputMode="decimal" className={field} value={v.prevYear === year && v.prevTax ? String(v.prevTax) : ""} onChange={(e) => set({ prevTax: Number(e.target.value.replace(/,/g, "")) || 0, prevYear: year })} placeholder="0" />
              </label>
              <label className={label}>
                <span className={labelText}>ประกันสังคมที่หักไปแล้ว (บาท)</span>
                <input inputMode="decimal" className={field} value={v.prevYear === year && v.prevSso ? String(v.prevSso) : ""} onChange={(e) => set({ prevSso: Number(e.target.value.replace(/,/g, "")) || 0, prevYear: year })} placeholder="0" />
              </label>
            </div>
          </>
        )}
      </section>

      {error && <Notice tone="danger">{error}</Notice>}
      {saved && <Notice tone="ok">บันทึกแล้ว — มีผลกับรอบเงินเดือนที่ยังเป็นร่าง เมื่อกด &quot;ดึงข้อมูลใหม่&quot;</Notice>}
      <div className="sticky bottom-3 flex justify-end">
        <button type="button" className={navy} disabled={busy} onClick={() => run(() => saveProfileAction({ employmentId, ...v, ssoExemptReason: v.ssoExemptReason.trim() }), () => setSaved(true))}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} บันทึกข้อมูลเงินเดือน
        </button>
      </div>
    </div>
  );
}

/** 5. รายการประจำทุกเดือน */
export function RecurringSection({
  employmentId,
  rows,
  items,
  thisPeriod,
}: {
  employmentId: string;
  rows: { id: string; name: string; kind: string; amount: number; fromPeriod: string; toPeriod: string | null; note: string }[];
  items: { id: string; name: string; kind: string }[];
  thisPeriod: string;
}) {
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(thisPeriod);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const { busy, error, run } = useRun();
  return (
    <section className={`${card} flex flex-col gap-3 p-4 sm:p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-(--ink)">5. รายการประจำทุกเดือน</h2>
        {!open && <button type="button" className="text-sm font-semibold text-(--app-strong) underline" onClick={() => setOpen(true)}>+ เพิ่ม</button>}
      </div>
      <p className={hint}>ตั้งครั้งเดียว เข้าทุกงวดเอง ไม่ต้องกรอกทุกเดือน · ชื่อรายการเพิ่มได้ที่ ตั้งค่า</p>
      {rows.length === 0 && !open && <p className="text-sm text-(--ink-soft)">ยังไม่มี</p>}
      {rows.map((r) => (
        <RecurringRow key={r.id} r={r} />
      ))}
      {open && (
        <div className="grid grid-cols-1 gap-3 rounded-(--radius) border border-dashed border-(--line) bg-(--bg-soft) p-3 sm:grid-cols-2">
          <label className={label}>
            <span className={labelText}>รายการ</span>
            <select className={field} value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">— เลือกรายการ —</option>
              <optgroup label="เงินได้ (บวกเพิ่ม)">
                {items.filter((i) => i.kind === "earning").map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </optgroup>
              <optgroup label="รายการหัก">
                {items.filter((i) => i.kind !== "earning").map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </optgroup>
            </select>
          </label>
          <label className={label}>
            <span className={labelText}>ต่อเดือน (บาท)</span>
            <input inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className={label}>
            <span className={labelText}>เริ่มงวด</span>
            <input type="month" className={field} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className={label}>
            <span className={labelText}>ถึงงวด (เว้นว่าง = ไม่มีกำหนด)</span>
            <input type="month" className={field} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className={`${label} sm:col-span-2`}>
            <span className={labelText}>หมายเหตุ</span>
            <input className={field} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" className={outline} onClick={() => setOpen(false)} disabled={busy}>ยกเลิก</button>
            <button type="button" className={navy} disabled={busy || !itemId || !amount || !from} onClick={() => run(() => addRecurringAction({ employmentId, itemId, amount: Number(amount.replace(/,/g, "")), fromPeriod: from, toPeriod: to || null, note }), () => { setOpen(false); setAmount(""); setNote(""); setTo(""); })}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} เพิ่มรายการประจำ
            </button>
          </div>
        </div>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </section>
  );
}

function RecurringRow({ r }: { r: { id: string; name: string; kind: string; amount: number; fromPeriod: string; toPeriod: string | null; note: string } }) {
  const { busy, error, run } = useRun();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-sm">
      <div>
        <strong>{r.name}</strong> · {r.kind === "earning" ? "เงินได้" : "รายการหัก"} · ตั้งแต่ {periodLabel(r.fromPeriod)}{r.toPeriod ? ` ถึง ${periodLabel(r.toPeriod)}` : " · ไม่มีกำหนด"}
        {r.note && <div className="text-xs text-(--ink-soft)">{r.note}</div>}
      </div>
      <div className="flex items-center gap-2">
        <span className={`font-bold tabular-nums ${r.kind === "earning" ? "text-emerald-800" : "text-red-800"}`}>{r.kind === "earning" ? "+" : "−"}{fmtBaht(r.amount)}</span>
        {!confirm ? (
          <button type="button" className="text-xs font-semibold text-(--app-strong) underline" onClick={() => setConfirm(true)}>เลิกใช้</button>
        ) : (
          <button type="button" className="text-xs font-semibold text-red-700 underline" disabled={busy} onClick={() => run(() => endRecurringAction({ id: r.id }))}>ยืนยันเลิกใช้</button>
        )}
      </div>
      {error && <span className="w-full text-xs text-red-700">{error}</span>}
    </div>
  );
}
