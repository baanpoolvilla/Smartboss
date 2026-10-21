"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import {
  cancelRequestAction,
  confirmClearingAction,
  confirmReceivedAction,
  decideRequestAction,
  recordPaymentAction,
  submitClearingAction,
  voidPaymentAction,
  type UploadedFile,
} from "../actions";
import { METHOD_LABEL, SIMILAR_SLIP_PREFIX, baht, parseMoney, round2, type PaymentMethod } from "../lib/types";
import { FilePicker } from "./file-picker";
import { MoneyRow, Notice } from "./ui";

const field = "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) focus-visible:border-(--app) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--app)/25";
const primary = "inline-flex h-11 items-center justify-center gap-2 rounded-(--radius) bg-(--app) px-4 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50";
const outline = "inline-flex h-11 items-center justify-center gap-2 rounded-(--radius) border border-(--line) bg-(--bg) px-4 text-sm font-medium text-(--ink) hover:bg-(--bg-soft) disabled:opacity-50";
const dangerOutline = "inline-flex h-11 items-center justify-center gap-2 rounded-(--radius) border border-red-200 bg-(--bg) px-4 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50";

function useRun() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(fn: () => Promise<{ ok?: boolean; error?: string } | { ok: true }>, after?: () => void) {
    setError(null);
    start(async () => {
      const res = (await fn()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(res.error ?? "ทำไม่สำเร็จ");
        return;
      }
      after?.();
      router.refresh();
    });
  }
  return { busy, error, run };
}

/* ───────── อนุมัติ ───────── */

export function DecidePanel({ id, version, level, isOt, forwardsToCeo = false, firstBy = null }: { id: string; version: string; level: "hr" | "ceo"; isOt: boolean; forwardsToCeo?: boolean; firstBy?: string | null }) {
  const { busy, error, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <section className="flex flex-col gap-3 rounded-(--radius-lg) border-2 border-(--app) bg-(--bg) p-4">
      <div>
        <h2 className="text-base font-bold text-(--ink)">รอคุณ{level === "ceo" ? " (CEO)" : ""}อนุมัติ</h2>
        <p className="text-xs text-(--ink-soft)">{isOt ? "ดูเวลาสแกนและหลักฐานในใบว่าทำงานจริง" : "ดูรายการและหลักฐานในใบก่อนตัดสิน"}</p>
        {forwardsToCeo && <p className="mt-1 text-xs font-medium text-amber-700">ยอดเกินเกณฑ์ — คุณอนุมัติแล้วจะส่งต่อให้ CEO อนุมัติอีกขั้น</p>}
        {firstBy && <p className="mt-1 text-xs font-medium text-emerald-700">{firstBy} (HR) ผ่านแล้ว — เหลือ CEO</p>}
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold text-(--ink)">หมายเหตุ <span className="font-normal text-(--ink-soft)">(ไม่อนุมัติต้องใส่)</span></span>
        <textarea rows={2} className={`${field} h-auto py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={primary} disabled={busy} onClick={() => run(() => decideRequestAction({ id, outcome: "approve", note, version }))}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {forwardsToCeo ? "อนุมัติ → ส่ง CEO" : "อนุมัติ"}
        </button>
        <button type="button" className={dangerOutline} disabled={busy || !note.trim()} onClick={() => run(() => decideRequestAction({ id, outcome: "reject", note, version }))}>
          ไม่อนุมัติ
        </button>
      </div>
    </section>
  );
}

/* ───────── จ่ายเงิน ───────── */

export interface PettyHolder {
  userId: string;
  name: string;
  balance: number;
}

export function PayPanel({
  id,
  outstanding,
  methods,
  holders,
  myUserId,
  today,
  payrollPeriod,
  title = "บันทึกการจ่ายเงิน",
}: {
  id: string;
  outstanding: number;
  methods: PaymentMethod[];
  holders: PettyHolder[];
  myUserId: string;
  today: string;
  payrollPeriod: string;
  title?: string;
}) {
  const { busy, error, run } = useRun();
  const [amount, setAmount] = useState(String(outstanding));
  const [method, setMethod] = useState<PaymentMethod>(methods[0] ?? "transfer");
  const [paidOn, setPaidOn] = useState(today);
  const [holder, setHolder] = useState(holders.find((h) => h.userId === myUserId)?.userId ?? holders[0]?.userId ?? "");
  const [note, setNote] = useState("");
  const [closeShort, setCloseShort] = useState(false);
  const [slips, setSlips] = useState<UploadedFile[]>([]);
  // สลิปคล้ายของใบก่อน — แสดงคำถามยืนยันแทน error ธรรมดา
  const [similar, setSimilar] = useState<string | null>(null);
  const amt = parseMoney(amount);
  const short = Number.isFinite(amt) && amt < outstanding - 0.005;
  const holderBal = holders.find((h) => h.userId === holder)?.balance ?? 0;
  const pettyShort = method === "petty_cash" && Number.isFinite(amt) && amt > holderBal + 0.005;
  // ยอดที่ระบบอ่านได้จากสลิป เทียบกับยอดที่จะบันทึก (เตือน ไม่บังคับ — สลิปเดียวอาจโอนรวมหลายใบ)
  const slipRead = slips.map((x) => x.ai?.amount).filter((x): x is number => typeof x === "number" && x > 0);
  const slipTotal = slipRead.length === slips.length && slipRead.length > 0 ? round2(slipRead.reduce((s, x) => s + x, 0)) : null;
  const slipMismatch = slipTotal !== null && Number.isFinite(amt) && Math.abs(slipTotal - amt) > 1;

  function pay(confirmSimilar: boolean) {
    setSimilar(null);
    run(async () => {
      const res = await recordPaymentAction({ id, amount: amt, method, paidOn, pettyHolderId: method === "petty_cash" ? holder : null, payrollPeriod: method === "payroll" ? payrollPeriod : null, note, slips, closeShort, confirmSimilar });
      if (!res.ok && res.error.startsWith(SIMILAR_SLIP_PREFIX)) {
        setSimilar(res.error.split("|").slice(2).join("|"));
        return { error: "" };
      }
      return res;
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-(--radius-lg) border-2 border-(--app) bg-(--bg) p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-(--ink)">{title}</h2>
        <span className="text-sm text-(--ink-soft)">ค้างจ่าย <strong className="text-(--ink)">{baht(outstanding)}</strong></span>
      </div>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">วิธีจ่าย</legend>
        {methods.map((m) => (
          <label key={m} className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-(--radius) border px-3 text-sm ${method === m ? "border-(--brand-navy) bg-slate-100 font-semibold" : "border-(--line)"}`}>
            <input type="radio" name={`method-${id}`} className="sr-only" checked={method === m} onChange={() => setMethod(m)} />
            {METHOD_LABEL[m]}
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-(--ink)">จ่ายจริง (บาท)</span>
          <input inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-(--ink)">{method === "payroll" ? "งวดเงินเดือน" : "วันที่จ่าย"}</span>
          {method === "payroll" ? <input className={field} value={payrollPeriod} readOnly /> : <input type="date" className={field} value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} />}
        </label>
      </div>
      {method === "petty_cash" && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-(--ink)">จ่ายจากเงินสดย่อยของ</span>
          <select className={field} value={holder} onChange={(e) => setHolder(e.target.value)}>
            {holders.map((h) => (
              <option key={h.userId} value={h.userId}>{h.name} · เหลือ {baht(h.balance)}</option>
            ))}
          </select>
          {pettyShort && <span className="text-xs font-medium text-red-700">เงินสดย่อยไม่พอ — เติมเงินที่หน้าเงินสดย่อยก่อน</span>}
        </label>
      )}
      {method !== "payroll" && (
        <FilePicker role="slip" files={slips} onChange={setSlips} label={method === "transfer" ? "สลิปโอน" : "หลักฐานรับเงิน"} hint={method === "transfer" ? "แคปหน้าจอสลิปจากแอปธนาคาร" : "รูปผู้รับเซ็นรับเงิน หรือรูปตอนส่งเงิน"} today={today} />
      )}
      {slipMismatch && <Notice tone="warn">ยอดในสลิป {baht(slipTotal!)} ไม่ตรงกับยอดที่จะบันทึก {baht(amt)} — ตรวจสลิปอีกครั้ง</Notice>}
      {short && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={closeShort} onChange={(e) => setCloseShort(e.target.checked)} />
          <span>
            จ่ายแค่ {baht(amt)} แล้วจบใบนี้ (ไม่จ่ายอีก {baht(round2(outstanding - amt))})
            <span className="block text-xs text-(--ink-soft)">ไม่ติ๊ก = จ่ายก่อนบางส่วน ส่วนที่เหลือจ่ายทีหลังได้</span>
          </span>
        </label>
      )}
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold text-(--ink)">หมายเหตุ {short && <span className="font-normal text-red-700">(จ่ายไม่ครบต้องใส่เหตุผล)</span>}</span>
        <input className={field} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <Notice tone="danger">{error}</Notice>}
      {similar && (
        <div className="flex flex-col gap-2 rounded-(--radius) border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span>{similar}</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={outline} onClick={() => setSimilar(null)}>เปลี่ยนสลิป</button>
            <button type="button" className={primary} disabled={busy} onClick={() => pay(true)}>ยืนยันว่าเป็นคนละรายการ แล้วบันทึก</button>
          </div>
        </div>
      )}
      <button
        type="button"
        className={primary}
        disabled={busy || !Number.isFinite(amt) || amt <= 0 || pettyShort || (method !== "payroll" && slips.length === 0) || (short && !note.trim())}
        onClick={() => pay(false)}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        บันทึกว่าจ่ายแล้ว {Number.isFinite(amt) && amt > 0 ? baht(amt) : ""}
      </button>
    </section>
  );
}

/* ───────── ยกเลิก / ยกเลิกการจ่าย / ได้รับเงินแล้ว ───────── */

export function CancelButton({ id, label = "ยกเลิกคำขอ" }: { id: string; label?: string }) {
  const { busy, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <button type="button" className={`${dangerOutline} w-full`} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-(--radius-lg) border border-red-200 bg-red-50/50 p-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold text-(--ink)">เหตุผลที่ยกเลิก</span>
        <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </label>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={outline} onClick={() => setOpen(false)}>ไม่ยกเลิก</button>
        <button type="button" className={dangerOutline} disabled={busy || !reason.trim()} onClick={() => run(() => cancelRequestAction({ id, reason }))}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}ยืนยันยกเลิก
        </button>
      </div>
    </div>
  );
}

export function VoidPaymentButton({ paymentId }: { paymentId: string }) {
  const { busy, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <button type="button" className="text-xs font-medium text-red-700 hover:underline" onClick={() => setOpen(true)}>
        ยกเลิกการจ่ายนี้
      </button>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-2">
      <input className={field} placeholder="เหตุผล (เช่น โอนผิดบัญชี)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="เหตุผลที่ยกเลิกการจ่าย" autoFocus />
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex gap-2">
        <button type="button" className={`${outline} h-9`} onClick={() => setOpen(false)}>ไม่ยกเลิก</button>
        <button type="button" className={`${dangerOutline} h-9`} disabled={busy || !reason.trim()} onClick={() => run(() => voidPaymentAction({ paymentId, reason }))}>
          ยืนยัน
        </button>
      </div>
    </div>
  );
}

export function ConfirmReceivedButton({ id, amount }: { id: string; amount: number }) {
  const { busy, error, run } = useRun();
  return (
    <section className="flex flex-col gap-2 rounded-(--radius-lg) border-2 border-(--app) bg-(--bg) p-4">
      <h2 className="text-base font-bold text-(--ink)">ได้รับเงิน {baht(amount)} แล้วหรือยัง</h2>
      <p className="text-xs text-(--ink-soft)">ดูสลิปในใบ ถ้าได้รับแล้วกดยืนยัน — เป็นหลักฐานฝั่งผู้รับ</p>
      {error && <Notice tone="danger">{error}</Notice>}
      <button type="button" className={primary} disabled={busy} onClick={() => run(() => confirmReceivedAction({ id }))}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}ได้รับเงินแล้ว
      </button>
    </section>
  );
}

/* ───────── เคลียร์เงินที่เบิกไปก่อน ───────── */

export function ClearingSubmit({ id, paid, dueDate, today, maxAgeDays }: { id: string; paid: number; dueDate: string | null; today: string; maxAgeDays: number }) {
  const { busy, error, run } = useRun();
  const [spent, setSpent] = useState("");
  const [returned, setReturned] = useState("");
  const [note, setNote] = useState("");
  const [receipts, setReceipts] = useState<UploadedFile[]>([]);
  const s = parseMoney(spent);
  const r = parseMoney(returned || "0");
  const diff = Number.isFinite(s) && Number.isFinite(r) ? round2(paid - s - r) : null;
  const overdue = dueDate !== null && dueDate < today;
  return (
    <section className="flex flex-col gap-3 rounded-(--radius-lg) border-2 border-(--app) bg-(--bg) p-4">
      <div>
        <h2 className="text-base font-bold text-(--ink)">ส่งใบเสร็จ + เงินทอน <span className="font-normal text-(--ink-soft)">(เบิกไป {baht(paid)})</span></h2>
        {dueDate && <p className={`text-xs ${overdue ? "font-semibold text-red-700" : "text-(--ink-soft)"}`}>{overdue ? "เลยกำหนดส่งแล้ว" : "ส่งภายใน"} {dueDate}</p>}
      </div>
      <FilePicker
        role="clearing"
        files={receipts}
        onChange={setReceipts}
        label="ใบเสร็จของที่ซื้อ"
        today={today}
        claimDate={today}
        maxAgeDays={maxAgeDays}
        onAiRead={(f) => {
          if (!spent && f.ai?.amount) setSpent(String(f.ai.amount));
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-(--ink)">ใช้จริง (บาท)</span>
          <input inputMode="decimal" className={field} value={spent} onChange={(e) => setSpent(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-(--ink)">คืนเงินทอน (บาท)</span>
          <input inputMode="decimal" className={field} value={returned} onChange={(e) => setReturned(e.target.value)} placeholder="0" />
        </label>
      </div>
      {diff !== null && (
        <div className="rounded-(--radius) bg-(--bg-soft) p-3">
          <MoneyRow label="เบิกไป" value={paid} />
          <MoneyRow label="ใช้จริง" value={s} minus />
          <MoneyRow label="คืนเงินทอน" value={r} minus />
          <MoneyRow strong label={diff > 0.005 ? "ยังขาดคืน" : diff < -0.005 ? "บริษัทต้องจ่ายเพิ่ม" : "พอดี"} value={Math.abs(diff)} />
          {diff > 0.005 && <p className="mt-1 text-xs text-amber-700">ส่วนที่ขาดจะถูกหักคืน (เงินเดือน/ค่าแรง) ถ้าไม่คืน</p>}
        </div>
      )}
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold text-(--ink)">หมายเหตุ</span>
        <input className={field} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <Notice tone="danger">{error}</Notice>}
      <button type="button" className={primary} disabled={busy || !Number.isFinite(s) || s < 0 || (s > 0 && receipts.length === 0)} onClick={() => run(() => submitClearingAction({ id, spent: s, returned: Number.isFinite(r) ? r : 0, note, receipts }))}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}ส่งให้ HR ตรวจ
      </button>
    </section>
  );
}

export function ClearingConfirm({ id, paid, spent, returned, holders, worker }: { id: string; paid: number; spent: number; returned: number; holders: PettyHolder[]; worker: boolean }) {
  const { busy, error, run } = useRun();
  const [returnedTo, setReturnedTo] = useState(holders[0]?.userId ?? "");
  const [note, setNote] = useState("");
  const diff = round2(paid - spent - returned);
  return (
    <section className="flex flex-col gap-3 rounded-(--radius-lg) border-2 border-(--app) bg-(--bg) p-4">
      <h2 className="text-base font-bold text-(--ink)">ตรวจใบเสร็จ + เงินทอน</h2>
      <div className="rounded-(--radius) bg-(--bg-soft) p-3">
        <MoneyRow label="เบิกไป" value={paid} />
        <MoneyRow label="ใช้จริง (ตามใบเสร็จ)" value={spent} minus />
        <MoneyRow label="คืนเงินทอน" value={returned} minus />
        <MoneyRow strong label={diff > 0.005 ? "ขาดคืน → หักคืน" : diff < -0.005 ? "บริษัทจ่ายเพิ่ม" : "พอดี"} value={Math.abs(diff)} />
        {diff > 0.005 && <p className="mt-1 text-xs text-(--ink-soft)">{worker ? "ลงเป็นเบิกล่วงหน้าในบัญชีค่าแรง หักจากค่าแรงวันถัดไป" : "เข้ารายการรอหักเงินเดือน"}</p>}
        {diff < -0.005 && <p className="mt-1 text-xs text-(--ink-soft)">ใบจะกลับไปรอจ่ายส่วนต่าง</p>}
      </div>
      {returned > 0 && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-(--ink)">เงินทอน {baht(returned)} เข้าเงินสดย่อยของ</span>
          <select className={field} value={returnedTo} onChange={(e) => setReturnedTo(e.target.value)}>
            <option value="">— ไม่เข้าเงินสดย่อย (โอนคืนบริษัท) —</option>
            {holders.map((h) => (
              <option key={h.userId} value={h.userId}>{h.name}</option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold text-(--ink)">หมายเหตุ</span>
        <input className={field} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <Notice tone="danger">{error}</Notice>}
      <button type="button" className={primary} disabled={busy} onClick={() => run(() => confirmClearingAction({ id, returnedTo: returnedTo || null, note }))}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}ยืนยันว่าถูกต้อง
      </button>
    </section>
  );
}
