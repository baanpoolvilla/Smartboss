"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Plus } from "lucide-react";

import { Modal } from "@/components/module/dialog";
import { InfoTip } from "@/modules/salary/components/help";
import {
  addPettyEntryAction,
  addPettySpendAction,
  cancelPettyTopupAction,
  decidePettyTopupAction,
  recordPaymentAction,
  requestPettyTopupAction,
  reviewPettySpendAction,
  setPettyHolderAction,
  writeOffPettyShortageAction,
  voidPettyEntryAction,
  type UploadedFile,
} from "../actions";
import { PETTY_CATEGORIES, SIMILAR_SLIP_PREFIX, baht, parseMoney, pettyTax, thaiDateTime } from "../lib/types";
import { FilePicker } from "./file-picker";
import { Notice } from "./ui";

import { useCeoTitle } from "@/lib/ceo-title-client";
/*
 * เงินสดย่อย (ผู้ใช้ 30/10/2569: "ใช้ยาก งง" → ปุ่มอยู่บนการ์ดของแต่ละคน + ปุ่ม ⓘ บอกว่าทำอะไร)
 *   ผู้ถือ:   − จ่ายเงิน = หน้าต่างเดียวสองแบบ (ผู้ใช้ 31/10/2569 "ทำทีเดียวกันเลย")
 *             · ให้คนที่ขอมา — เลือกใบเบิกที่ HR อนุมัติแล้ว แนบรูปตอนให้เงิน กดจ่าย (recordPaymentAction แบบเงินสดย่อย)
 *             · ซื้อของเอง — ค่าอะไร + หมวด + ใบเสร็จ (addPettySpendAction) ไม่ต้องมีใบเบิก
 *           + ขอเติมเงิน (รอ HR/CEO อนุมัติ)
 *   HR/CEO:  + เติมเงิน ให้คนอื่น (สลิปบังคับ) · อนุมัติคำขอเติม (แนบสลิปโอน/รูปเงินสด) · ของตัวเองอนุมัติไม่ได้
 *   นับเงินไม่ตรง: ผู้ถือเอง หรือ HR — ใส่ยอดที่นับได้จริง ระบบปรับให้ตรง
 */

const field = "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)";
const primary = "inline-flex h-11 items-center justify-center gap-2 rounded-(--radius) bg-(--brand-navy,#1b2537) px-4 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50";
const ghost = "inline-flex h-11 items-center justify-center rounded-(--radius) border border-(--line) px-4 text-sm text-(--ink) hover:bg-(--bg-soft)";

export interface PettyHolderView {
  userId: string;
  name: string;
  balance: number;
}

/** ใบเบิกที่อนุมัติแล้วรอจ่าย — คนถือเงินกดเข้าไปจ่ายในใบได้ */
export interface PettyPayableItem {
  id: string;
  code: string;
  title: string;
  beneficiaryName: string;
  outstanding: number;
}

export interface PettyTopupItem {
  id: string;
  holderUserId: string;
  holderName: string;
  amount: number;
  note: string;
  requestedByUserId: string;
  needsCeo: boolean;
  at: string;
}

/** แถบบอกขั้นตอนในหน้าต่าง — อ่านจบรู้ว่ากดแล้วเกิดอะไร ไม่ต้องเดา */
function Explain({ children }: { children: React.ReactNode }) {
  return <p className="rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-xs leading-relaxed text-(--ink-soft)">{children}</p>;
}

function Field({ label, required, tip, children }: { label: string; required?: boolean; tip?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="flex items-center font-semibold text-(--ink)">
        {label}
        {required && <span className="ml-1 font-normal text-red-700">*</span>}
        {tip && <InfoTip label={label}>{tip}</InfoTip>}
      </span>
      {children}
    </label>
  );
}

/** หน้าต่างกรอก + ปุ่มบันทึก — ทุกฟอร์มในหน้านี้ใช้ร่วมกัน */
function useSave(onDone: () => void) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) return setError(res.error);
      onDone();
      router.refresh();
    });
  };
  return { busy, error, run };
}

function SaveButtons({ busy, disabled, label, onSave, onClose }: { busy: boolean; disabled: boolean; label: string; onSave: () => void; onClose: () => void }) {
  return (
    <>
      <button type="button" className={ghost} onClick={onClose}>ยกเลิก</button>
      <button type="button" className={primary} disabled={busy || disabled} onClick={onSave}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {label}
      </button>
    </>
  );
}

/* ───────────── ตั้งคนถือเงิน (HR/CEO) ───────────── */

/**
 * ติ๊กรายคน = ถือเงินสดย่อย (ผู้ใช้ 31/10/2569 "ติ๊กอันนี้แบบจบ") — ได้การ์ด + เมนูเงินสดย่อย + ทะเบียนช่าง/ร้านภายนอก
 * กดแล้วบันทึกทันทีทีละคน · เอาออกไม่ได้ถ้ายังมีเงินในมือหรือมีคำขอเติมค้าง (เซิร์ฟเวอร์บอกเหตุผล)
 */
export function PettyHoldersButton({ people, holderIds }: { people: PettyHolderView[]; holderIds: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [, start] = useTransition();
  const holds = new Set(holderIds);
  const shown = people
    .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(holds.has(b.userId)) - Number(holds.has(a.userId)));
  const toggle = (p: PettyHolderView) => {
    setError(null);
    setBusyId(p.userId);
    start(async () => {
      const res = await setPettyHolderAction({ userId: p.userId, holds: !holds.has(p.userId) });
      setBusyId(null);
      if ("error" in res) return setError(res.error);
      router.refresh();
    });
  };
  return (
    <>
      <button type="button" className={ghost} onClick={() => setOpen(true)}>
        ตั้งคนถือเงิน ({holderIds.length})
      </button>
      {open && (
        <Modal title="ใครถือเงินสดย่อย" onClose={() => setOpen(false)} actions={<button type="button" className={primary} onClick={() => setOpen(false)}>เสร็จ</button>}>
          <div className="flex flex-col gap-3">
            <Explain>
              ติ๊ก = คนนี้ถือเงินสดย่อย ได้การ์ดของตัวเอง เมนูเงินสดย่อย และทะเบียนช่าง/ร้านภายนอก · เอาติ๊กออกได้เมื่อเงินในมือเป็น ฿0 และไม่มีคำขอเติมค้าง
            </Explain>
            <input className={field} placeholder="ค้นหาชื่อ" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="ค้นหาชื่อ" />
            {error && <Notice tone="danger">{error}</Notice>}
            <ul className="max-h-[50vh] divide-y divide-(--line) overflow-y-auto rounded-(--radius) border border-(--line)">
              {shown.map((p) => {
                const on = holds.has(p.userId);
                return (
                  <li key={p.userId}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-(--bg-soft)">
                      <input type="checkbox" className="h-4 w-4 accent-(--brand-navy,#1b2537)" checked={on} disabled={busyId !== null} onChange={() => toggle(p)} />
                      <span className="min-w-0 flex-1 truncate text-(--ink)">{p.name}</span>
                      {busyId === p.userId ? (
                        <Loader2 className="h-4 w-4 animate-spin text-(--ink-soft)" aria-hidden="true" />
                      ) : on ? (
                        <span className="text-xs tabular-nums text-(--ink-soft)">ในมือ {baht(p.balance)}</span>
                      ) : null}
                    </label>
                  </li>
                );
              })}
              {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-(--ink-soft)">ไม่พบชื่อ</li>}
            </ul>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ───────────── การ์ดของแต่ละคน ───────────── */

export function PettyHolderCard({
  holder,
  isMe,
  canTopUp,
  canAdjust,
  pendingMine,
  today,
  selected,
  href,
  payable = [],
  tax = { vatPercent: 7, whtRates: [1, 2, 3, 5] },
}: {
  /** VAT % + อัตราหัก ณ ที่จ่าย จากหน้าตั้งค่าเบิกจ่าย (ที่เดียวกับใบค่าช่าง) */
  tax?: PettyTaxSettings;
  holder: PettyHolderView;
  isMe: boolean;
  /** HR/CEO — เติมเงินให้คนอื่นได้ */
  canTopUp: boolean;
  canAdjust: boolean;
  /** มีคำขอเติมของคนนี้รออยู่ */
  pendingMine: boolean;
  today: string;
  selected: boolean;
  href: string;
  /** ใบเบิกที่รอคนนี้จ่ายจากเงินสดย่อย (เฉพาะการ์ดของตัวเอง) */
  payable?: PettyPayableItem[];
}) {
  const ceo = useCeoTitle();
  const [open, setOpen] = useState<"spend" | "request" | "topup" | "adjust" | null>(null);
  const close = () => setOpen(null);
  return (
    <section className={`flex flex-col gap-3 rounded-(--radius-lg) border bg-(--bg) p-4 ${selected ? "border-2 border-(--brand-navy)" : "border-(--line)"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <a href={href} className="block truncate text-sm font-semibold text-(--ink) hover:underline">
            {holder.name}
            {isMe && <span className="ml-1.5 rounded-full bg-(--bg-soft) px-2 py-0.5 text-xs font-normal text-(--ink-soft)">ของฉัน</span>}
          </a>
          <div className="mt-1 flex items-center text-xs text-(--ink-soft)">
            เงินในมือ (ตามระบบ)
            <InfoTip label="เงินในมือ">
              ยอดที่ควรมีอยู่ในมือของ {holder.name} ตอนนี้ = เงินที่ได้รับเติม − ที่จ่ายค่าของไป + เงินทอนที่รับคืน
              <br />
              ถ้านับเงินจริงแล้วไม่ตรง กด “นับเงินไม่ตรง?” ด้านล่าง
            </InfoTip>
          </div>
          <div className={`text-2xl font-bold tabular-nums ${holder.balance < 0 ? "text-(--danger)" : "text-(--ink)"}`}>{baht(holder.balance)}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {isMe && (
          <>
            <button type="button" onClick={() => setOpen("spend")} className="inline-flex h-10 items-center gap-1.5 rounded-(--radius) bg-(--app) px-3.5 text-sm font-semibold text-white hover:brightness-95">
              <Minus className="h-4 w-4" aria-hidden="true" />
              จ่ายเงิน
              {payable.length > 0 && <span className="rounded-full bg-white/25 px-1.5 text-xs">{payable.length}</span>}
            </button>
            <button
              type="button"
              disabled={pendingMine}
              onClick={() => setOpen("request")}
              className="inline-flex h-10 items-center gap-1.5 rounded-(--radius) border border-(--line) px-3.5 text-sm font-semibold text-(--ink) hover:bg-(--bg-soft) disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {pendingMine ? "รออนุมัติเติมเงิน" : "ขอเติมเงิน"}
            </button>
          </>
        )}
        {!isMe && canTopUp && (
          <button type="button" onClick={() => setOpen("topup")} className="inline-flex h-10 items-center gap-1.5 rounded-(--radius) border border-(--line) px-3.5 text-sm font-semibold text-(--ink) hover:bg-(--bg-soft)">
            <Plus className="h-4 w-4" aria-hidden="true" />
            เติมเงินให้
          </button>
        )}
        {(isMe || canTopUp) && (
          <InfoTip label="ปุ่มเหล่านี้ทำอะไร" title="ปุ่มบนการ์ดนี้ทำอะไร">
            {isMe && (
              <>
                <b>− จ่ายเงิน</b> — ทุกครั้งที่เงินออกจากมือ กดที่นี่ เลือกว่า <b>ให้คนที่ขอมา</b> (ใบเบิกที่ HR อนุมัติแล้ว — ตัวเลขบนปุ่มคือจำนวนใบที่รอ) หรือ <b>ซื้อของเอง</b> (บอกว่าค่าอะไร เลือกหมวด แนบใบเสร็จ ไม่ต้องทำใบเบิก) ยอดในมือลดลงทันทีทั้งสองแบบ
                <br />
                <br />
                <b>+ ขอเติมเงิน</b> — เงินใกล้หมด กดขอ ระบบแจ้ง HR หรือ {ceo} ให้อนุมัติ (HR ขอเอง = {ceo} อนุมัติ) คนอนุมัติโอน/ให้เงินสดแล้วแนบหลักฐาน ยอดถึงจะเพิ่ม
                <br />
                <br />
              </>
            )}
            {!isMe && canTopUp && (
              <>
                <b>+ เติมเงินให้</b> — HR/{ceo} ให้เงินสดย่อยกับคนนี้ (โอนหรือเงินสด) แล้วแนบสลิป/รูปเงินสด ยอดเพิ่มทันที · เติมให้ตัวเองไม่ได้ ต้องกด “ขอเติมเงิน” ให้อีกคนอนุมัติ
                <br />
                <br />
              </>
            )}
            <b>นับเงินไม่ตรง?</b> — นับเงินจริงแล้วไม่เท่ากับยอดในระบบ (เช่น ทอนผิด) ใส่ยอดที่นับได้ ระบบปรับให้ตรง ต้องบอกเหตุผล
          </InfoTip>
        )}
      </div>

      {canAdjust && (
        <button type="button" onClick={() => setOpen("adjust")} className="self-start text-xs text-(--ink-soft) underline hover:text-(--ink)">
          นับเงินไม่ตรง?
        </button>
      )}

      {open === "spend" && <PayModal holder={holder} today={today} payable={payable} tax={tax} onClose={close} />}
      {open === "request" && <RequestTopupModal holder={holder} onClose={close} />}
      {open === "topup" && <TopUpModal holder={holder} today={today} onClose={close} />}
      {open === "adjust" && <AdjustModal holder={holder} onClose={close} />}
    </section>
  );
}

/* ───────────── − จ่ายเงิน: ให้คนที่ขอมา / ซื้อของเอง ───────────── */

export interface PettyTaxSettings {
  /** บริษัทเปิด "ซื้อของเองต้องมีคนตรวจ" */
  review?: boolean;
  vatPercent: number;
  /** % หัก ณ ที่จ่ายที่ให้กดเลือก (ไม่รวม 0) */
  whtRates: number[];
}

function PayModal({ holder, today, payable, tax, onClose }: { holder: PettyHolderView; today: string; payable: PettyPayableItem[]; tax: PettyTaxSettings; onClose: () => void }) {
  const [mode, setMode] = useState<"request" | "self">(payable.length > 0 ? "request" : "self");
  const tab = (on: boolean) => `h-10 rounded-(--radius) text-sm ${on ? "bg-(--brand-navy,#1b2537) font-semibold text-white" : "text-(--ink) hover:bg-white"}`;
  return (
    <Modal title="จ่ายเงินจากเงินสดย่อย" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-1 rounded-(--radius) bg-(--bg-soft) p-1" role="tablist" aria-label="จ่ายให้ใคร">
          <button type="button" role="tab" aria-selected={mode === "request"} className={tab(mode === "request")} onClick={() => setMode("request")}>
            ให้คนที่ขอมา ({payable.length})
          </button>
          <button type="button" role="tab" aria-selected={mode === "self"} className={tab(mode === "self")} onClick={() => setMode("self")}>
            ซื้อของเอง
          </button>
        </div>
        {mode === "request" ? (
          <RequestPayForm holder={holder} today={today} payable={payable} onClose={onClose} />
        ) : (
          <SpendForm balance={holder.balance} today={today} taxSettings={tax} onClose={onClose} />
        )}
      </div>
    </Modal>
  );
}

/** จ่ายใบเบิกที่ HR อนุมัติแล้ว จากเงินในมือของตัวเอง — จ่ายเต็มยอดที่ค้าง (จ่ายบางส่วน: เปิดใบ) */
function RequestPayForm({ holder, today, payable, onClose }: { holder: PettyHolderView; today: string; payable: PettyPayableItem[]; onClose: () => void }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<string | null>(null);
  const [picked, setPicked] = useState(payable[0]?.id ?? "");
  const [paidOn, setPaidOn] = useState(today);
  const [slips, setSlips] = useState<UploadedFile[]>([]);
  const item = payable.find((p) => p.id === picked);
  const over = !!item && item.outstanding > holder.balance + 0.005;
  const ready = !!item && !over && !!paidOn && slips.length > 0;

  if (payable.length === 0) {
    return <Explain>ยังไม่มีใบเบิกที่ HR อนุมัติแล้วรอจ่าย — ใครอยากได้เงินคืนต้องยื่นใบเบิกก่อน แล้วรอ HR อนุมัติ ใบจะขึ้นที่นี่</Explain>;
  }
  const pay = (confirmSimilar: boolean) => {
    if (!item) return;
    setError(null);
    setSimilar(null);
    start(async () => {
      const res = await recordPaymentAction({ id: item.id, amount: item.outstanding, method: "petty_cash", paidOn, pettyHolderId: holder.userId, payrollPeriod: null, note: "", slips, confirmSimilar });
      if ("error" in res) {
        if (res.error.startsWith(SIMILAR_SLIP_PREFIX)) return setSimilar(res.error.split("|").slice(2).join("|"));
        return setError(res.error);
      }
      onClose();
      router.refresh();
    });
  };
  return (
    <div className="flex flex-col gap-3">
      <Explain>เลือกใบที่ HR อนุมัติแล้ว ให้เงินกับคนนั้น แล้วแนบรูปตอนให้เงิน — กดจ่ายแล้วใบเป็น “จ่ายแล้ว” และหักจากเงินในมือ ({baht(holder.balance)}) ให้เอง</Explain>
      <fieldset className="flex max-h-64 flex-col gap-2 overflow-y-auto">
        <legend className="sr-only">เลือกใบที่จะจ่าย</legend>
        {payable.map((p) => (
          <label key={p.id} className={`flex cursor-pointer items-center gap-3 rounded-(--radius) border p-3 text-sm ${picked === p.id ? "border-2 border-(--brand-navy,#1b2537)" : "border-(--line)"}`}>
            <input type="radio" name="petty-pay-request" className="h-4 w-4 accent-(--brand-navy,#1b2537)" checked={picked === p.id} onChange={() => setPicked(p.id)} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-(--ink)">
                {p.beneficiaryName} · {p.title}
              </span>
              <a href={`/requests/${p.id}`} target="_blank" rel="noreferrer" className="text-xs text-(--app-strong) hover:underline">
                {p.code} · ดูใบ/ใบเสร็จ
              </a>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-(--ink)">{baht(p.outstanding)}</span>
          </label>
        ))}
      </fieldset>
      <Field label="วันที่ให้เงิน" required>
        <input type="date" max={today} className={field} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      </Field>
      {over && <Notice tone="warn">เงินในมือไม่พอ (เหลือ {baht(holder.balance)}) — กด “ขอเติมเงิน” ก่อน</Notice>}
      <FilePicker role="slip" files={slips} onChange={setSlips} label="รูปตอนให้เงิน / สลิป *" hint="รูปผู้รับเซ็นรับเงิน หรือรูปตอนส่งเงิน" today={today} />
      {error && <Notice tone="danger">{error}</Notice>}
      {similar && (
        <div className="flex flex-col gap-2 rounded-(--radius) border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span>{similar}</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={ghost} onClick={() => setSimilar(null)}>เปลี่ยนรูป</button>
            <button type="button" className={primary} disabled={busy} onClick={() => pay(true)}>ยืนยันว่าเป็นคนละรายการ แล้วจ่าย</button>
          </div>
        </div>
      )}
      <div className="flex justify-end gap-2 border-t border-(--line) pt-3">
        <SaveButtons busy={busy} disabled={!ready} label={item ? `จ่าย ${baht(item.outstanding)}` : "จ่าย"} onClose={onClose} onSave={() => pay(false)} />
      </div>
    </div>
  );
}

/** คำอธิบายใต้ปุ่มหัก ณ ที่จ่ายที่เลือก — ให้คนถือเงินรู้ว่าเลือกถูกไหมโดยไม่ต้องมีรายการยาว */
const WHT_HINT: Record<string, string> = {
  "0": "ซื้อของ หรือค่าบริการต่ำกว่า 1,000 บาท ไม่ต้องหัก",
  "1": "ค่าขนส่ง",
  "2": "ค่าโฆษณา",
  "3": "ค่าจ้าง ค่าบริการ ค่าซ่อม ทำของ",
  "5": "ค่าเช่า",
  other: "อัตราอื่นที่ฝ่ายบัญชีบอก",
};

/** ซื้อของเองด้วยเงินในมือ — ไม่มีใบเบิก */
function SpendForm({ balance, today, taxSettings, onClose }: { balance: number; today: string; taxSettings: PettyTaxSettings; onClose: () => void }) {
  const ceo = useCeoTitle();
  const vatRate = taxSettings.vatPercent;
  const { busy, error, run } = useSave(onClose);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [spentOn, setSpentOn] = useState(today);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  // ภาษี (ถ้ามี) — ผู้ใช้ 8/11/2569: ใส่ยอดเต็มตามบิล ไม่มีภาษีก็ข้าม มีก็เลือก ระบบหักลบให้เอง
  const [taxOpen, setTaxOpen] = useState(false);
  const [vatIncluded, setVatIncluded] = useState(false);
  // หัก ณ ที่จ่าย: เลือกจากรายการ หรือ "อื่น ๆ" พิมพ์ % เอง (ผู้ใช้ 8/11/2569)
  const [whtChoice, setWhtChoice] = useState("0");
  const [whtCustom, setWhtCustom] = useState("");
  const customPct = parseMoney(whtCustom);
  const whtPercent = whtChoice === "other" ? (Number.isFinite(customPct) && customPct > 0 && customPct <= 15 ? Math.round(customPct * 100) / 100 : 0) : Number(whtChoice);
  const customBad = whtChoice === "other" && whtPercent === 0;
  // ปิดกล่องภาษี = ไม่มีภาษี ล้างค่าที่เลือกไว้
  const closeTax = () => {
    setTaxOpen(false);
    setVatIncluded(false);
    setWhtChoice("0");
    setWhtCustom("");
  };
  const [payeeName, setPayeeName] = useState("");
  const [payeeKind, setPayeeKind] = useState<"person" | "company" | null>(null);
  const value = parseMoney(amount);
  const tax = Number.isFinite(value) && value > 0 ? pettyTax(value, vatIncluded, whtPercent, vatRate) : null;
  const paid = tax ? tax.paid : value;
  const over = Number.isFinite(paid) && paid > balance + 0.005;
  const payeeOk = whtPercent === 0 || (payeeName.trim() && payeeKind);
  const ready = title.trim() && category && Number.isFinite(value) && value > 0 && !over && spentOn && files.length > 0 && payeeOk && !customBad;
  return (
      <div className="flex flex-col gap-3">
        <Explain>ใช้เงินในมือซื้อของ/จ่ายค่าบริการเอง ไม่ต้องทำใบเบิก — กรอกครบทุกช่องที่มี * และแนบรูปใบเสร็จ บันทึกแล้วยอดในมือลดลงทันที{taxSettings.review ? ` แล้ว HR (หรือ ${ceo} ถ้าคุณเป็น HR) จะตรวจใบเสร็จทีหลัง — ไม่ผ่านต้องคืนเงินเข้ากอง` : ""} · เงินในมือตอนนี้ {baht(balance)}</Explain>
        <Field label="จ่ายค่าอะไร" required>
          <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น น้ำแข็ง 2 ถุง บ้าน A3" />
        </Field>
        <Field label="หมวด" required tip="ใช้แยกดูทีหลังว่าเงินสดย่อยหมดไปกับอะไรบ้าง เลือกที่ใกล้ที่สุด ไม่มีให้เลือก “อื่น ๆ”">
          <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">— เลือกหมวด —</option>
            {PETTY_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ยอดตามบิล (บาท)" required>
            <input inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="วันที่จ่าย" required>
            <input type="date" max={today} className={field} value={spentOn} onChange={(e) => setSpentOn(e.target.value)} />
          </Field>
        </div>
        {!taxOpen ? (
          <button type="button" onClick={() => setTaxOpen(true)} className="self-start text-sm font-semibold text-(--app-strong) hover:underline">
            + บิลนี้มีภาษี (VAT / หัก ณ ที่จ่าย)
          </button>
        ) : (
          <fieldset className="flex flex-col gap-2.5 rounded-(--radius) border border-(--line) p-3">
            <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-(--ink)">
              ภาษี
              <button type="button" onClick={closeTax} className="text-xs font-normal text-(--ink-soft) hover:underline">ไม่มีภาษี ปิด</button>
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={vatIncluded} onChange={(e) => setVatIncluded(e.target.checked)} />
              มี VAT {vatRate}% รวมในยอดแล้ว (ใบกำกับภาษีเต็มรูป)
            </label>
            <div className="flex flex-col gap-1.5 text-sm">
              <span>หัก ณ ที่จ่าย</span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="หัก ณ ที่จ่าย">
                {[{ v: "0", t: "ไม่หัก" }, ...taxSettings.whtRates.map((r) => ({ v: String(r), t: `${r}%` })), { v: "other", t: "อื่น ๆ" }].map((o) => (
                  <label key={o.v} className={`inline-flex h-9 min-w-12 cursor-pointer items-center justify-center rounded-full border px-3 text-sm ${whtChoice === o.v ? "border-(--brand-navy,#1b2537) bg-(--brand-navy,#1b2537) font-semibold text-white" : "border-(--line)"}`}>
                    <input type="radio" className="sr-only" name="wht-choice" checked={whtChoice === o.v} onChange={() => setWhtChoice(o.v)} />
                    {o.t}
                  </label>
                ))}
              </div>
              {WHT_HINT[whtChoice] && <span className="text-xs text-(--ink-soft)">{WHT_HINT[whtChoice]}</span>}
            </div>
            {whtChoice === "other" && (
              <label className="flex items-center gap-2 text-sm">
                <span>หัก</span>
                <input inputMode="decimal" className={`${field} w-24 text-right`} value={whtCustom} onChange={(e) => setWhtCustom(e.target.value)} placeholder="เช่น 1.5" aria-label="% หัก ณ ที่จ่าย" autoFocus />
                <span>%</span>
                {customBad && whtCustom.trim() !== "" && <span className="text-xs text-red-700">ใส่ได้ 0.01–15%</span>}
              </label>
            )}
            {whtPercent > 0 && (
              <div className="flex flex-col gap-2">
                <input className={field} value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="ชื่อผู้รับเงิน (ช่าง/ร้าน) — ใช้ออก 50 ทวิ *" aria-label="ชื่อผู้รับเงิน" maxLength={120} />
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="ผู้รับเงินเป็น">
                  {([["person", "บุคคล"], ["company", "บริษัท / ห้างร้าน"]] as const).map(([k, label]) => (
                    <label key={k} className={`inline-flex h-9 cursor-pointer items-center rounded-full border px-3 text-sm ${payeeKind === k ? "border-(--brand-navy,#1b2537) bg-(--brand-navy,#1b2537) font-semibold text-white" : "border-(--line)"}`}>
                      <input type="radio" className="sr-only" name="payee-kind" checked={payeeKind === k} onChange={() => setPayeeKind(k)} />
                      {label}
                    </label>
                  ))}
                </div>
                {tax && tax.base < 1000 && <span className="text-xs text-amber-700">ยอดก่อน VAT ต่ำกว่า 1,000 บาท ปกติไม่ต้องหัก — ตรวจอีกครั้ง</span>}
              </div>
            )}
            {tax && (vatIncluded || whtPercent > 0) && (
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-sm tabular-nums">
                {vatIncluded && (<><dt className="text-(--ink-soft)">ก่อน VAT</dt><dd className="text-right">{baht(tax.base)}</dd><dt className="text-(--ink-soft)">VAT {vatRate}%</dt><dd className="text-right">{baht(tax.vat)}</dd></>)}
                {whtPercent > 0 && (<><dt className="text-(--ink-soft)">หัก ณ ที่จ่าย {whtPercent}%</dt><dd className="text-right">−{baht(tax.wht)}</dd></>)}
                <dt className="font-semibold text-(--ink)">จ่ายจริง</dt><dd className="text-right font-bold text-(--ink)">{baht(tax.paid)}</dd>
              </dl>
            )}
          </fieldset>
        )}
        {over && <Notice tone="warn">เงินในมือไม่พอ (เหลือ {baht(balance)}) — กด “ขอเติมเงิน” ก่อน</Notice>}
        <FilePicker
          role="receipt"
          files={files}
          onChange={setFiles}
          label="รูปใบเสร็จ / บิล *"
          hint="ถ่ายให้เห็นยอดเงินและวันที่ชัด ๆ"
          today={today}
          claimDate={spentOn}
          onAiRead={(f) => {
            if (!amount && f.ai?.amount) setAmount(String(f.ai.amount));
            // บิลแสดง VAT แยก → ติ๊กให้ (ผู้ถือเอาออกเองได้ถ้าไม่ใช่ใบกำกับเต็มรูป)
            if (f.ai?.vat) {
              setTaxOpen(true);
              setVatIncluded(true);
            }
          }}
        />
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2 border-t border-(--line) pt-3">
          <SaveButtons busy={busy} disabled={!ready} label="บันทึกการจ่าย" onClose={onClose} onSave={() => run(() => addPettySpendAction({ title, category, amount: value, spentOn, attachments: files, vatIncluded, whtPercent, payeeName, payeeKind }))} />
        </div>
      </div>
  );
}

/* ───────────── + ขอเติมเงิน (ผู้ถือ) ───────────── */

function RequestTopupModal({ holder, onClose }: { holder: PettyHolderView; onClose: () => void }) {
  const ceo = useCeoTitle();
  const { busy, error, run } = useSave(onClose);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const value = parseMoney(amount);
  return (
    <Modal
      title="ขอเติมเงินสดย่อย"
      onClose={onClose}
      actions={<SaveButtons busy={busy} disabled={!(Number.isFinite(value) && value > 0 && note.trim())} label="ส่งคำขอ" onClose={onClose} onSave={() => run(() => requestPettyTopupAction({ amount: value, note }))} />}
    >
      <div className="flex flex-col gap-3">
        <Explain>
          ส่งแล้วระบบแจ้ง HR หรือ {ceo} ให้อนุมัติ (ถ้าคุณเป็น HR ต้องให้ {ceo} อนุมัติ — อนุมัติของตัวเองไม่ได้) · คนอนุมัติโอน/ให้เงินสด แล้วแนบสลิปหรือรูปเงินสด ยอดในมือถึงจะเพิ่ม · เงินในมือตอนนี้ {baht(holder.balance)}
        </Explain>
        <Field label="ขอเติม (บาท)" required>
          <input inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="เหตุผล" required>
          <input className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น เงินในมือใกล้หมด ต้องซื้อของเข้าบ้านสัปดาห์นี้" />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}

/* ───────────── + เติมเงินให้ (HR/CEO → คนอื่น) ───────────── */

function TopUpModal({ holder, today, onClose }: { holder: PettyHolderView; today: string; onClose: () => void }) {
  const { busy, error, run } = useSave(onClose);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const value = parseMoney(amount);
  return (
    <Modal
      title={`เติมเงินสดย่อยให้ ${holder.name}`}
      onClose={onClose}
      actions={
        <SaveButtons
          busy={busy}
          disabled={!(Number.isFinite(value) && value > 0 && files.length > 0)}
          label="บันทึกการเติม"
          onClose={onClose}
          onSave={() => run(() => addPettyEntryAction({ holderUserId: holder.userId, kind: "top_up", amount: value, note, attachments: files }))}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <Explain>โอนหรือให้เงินสดกับ {holder.name} ก่อน แล้วแนบสลิปโอน หรือรูปเงินสดที่เห็นจำนวนชัด · บันทึกแล้วยอดในมือเพิ่มทันที · ตอนนี้มี {baht(holder.balance)}</Explain>
        <Field label="เติมเข้า (บาท)" required>
          <input inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {Number.isFinite(value) && value > 0 && <span className="-mt-1 text-xs text-(--ink-soft)">เติมแล้วจะมี {baht(holder.balance + value)}</span>}
        <Field label="หมายเหตุ">
          <input className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น โอนจากบัญชีบริษัท" />
        </Field>
        <FilePicker role="slip" files={files} onChange={setFiles} label="สลิปโอน / รูปเงินสด *" hint="ต้องเห็นจำนวนเงินชัด" today={today} />
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}

/* ───────────── นับเงินไม่ตรง ───────────── */

function AdjustModal({ holder, onClose }: { holder: PettyHolderView; onClose: () => void }) {
  const { busy, error, run } = useSave(onClose);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const c = parseMoney(counted);
  const delta = Number.isFinite(c) ? Math.round((c - holder.balance) * 100) / 100 : NaN;
  const same = Number.isFinite(delta) && Math.abs(delta) < 0.005;
  return (
    <Modal
      title={`นับเงินจริง · ${holder.name}`}
      onClose={onClose}
      actions={
        <SaveButtons
          busy={busy}
          disabled={!Number.isFinite(delta) || same || !note.trim()}
          label="ปรับยอดให้ตรง"
          onClose={onClose}
          onSave={() => run(() => addPettyEntryAction({ holderUserId: holder.userId, kind: "adjust", amount: delta, note, attachments: [] }))}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <Explain>นับเงินสดที่อยู่ในมือจริง ๆ แล้วใส่ยอดที่นับได้ ระบบจะปรับยอดให้ตรงกับเงินจริง และเก็บประวัติไว้ว่าขาด/เกินเท่าไร · ในระบบตอนนี้ {baht(holder.balance)}</Explain>
        <Field label="นับได้จริง (บาท)" required>
          <input inputMode="decimal" className={field} value={counted} onChange={(e) => setCounted(e.target.value)} />
        </Field>
        {Number.isFinite(delta) && (
          <span className={`-mt-1 text-xs ${same ? "text-(--ink-soft)" : "font-medium text-amber-700"}`}>
            {same ? "ตรงกับในระบบแล้ว ไม่ต้องปรับ" : `${delta > 0 ? "เกิน" : "ขาด"} ${baht(Math.abs(delta))} จากในระบบ`}
          </span>
        )}
        <Field label="เหตุผล" required>
          <input className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ทอนเงินผิด / ลืมจดค่าน้ำแข็ง" />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}

/* ───────────── คำขอเติมเงินที่รออยู่ ───────────── */

export function PendingTopupRow({ item, canDecide, isMine, waitingFor, today }: { item: PettyTopupItem; canDecide: boolean; isMine: boolean; waitingFor: string; today: string }) {
  const [open, setOpen] = useState<"approve" | "reject" | null>(null);
  const { busy, error, run } = useSave(() => setOpen(null));
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 text-sm">
        <div>
          <span className="font-semibold text-(--ink)">{item.holderName}</span> ขอเติม <span className="font-bold tabular-nums">{baht(item.amount)}</span>
        </div>
        <div className="text-xs text-(--ink-soft)">
          {thaiDateTime(item.at)} · {item.note} · <span className="font-medium">รอ {waitingFor} อนุมัติ</span>
        </div>
        {error && !open && <div className="mt-1 text-xs text-red-700">{error}</div>}
      </div>
      <div className="flex gap-2">
        {canDecide && (
          <>
            <button type="button" className="h-9 rounded-(--radius) border border-(--line) px-3 text-sm text-(--ink) hover:bg-(--bg-soft)" onClick={() => setOpen("reject")}>ไม่อนุมัติ</button>
            <button type="button" className="h-9 rounded-(--radius) bg-(--app) px-3 text-sm font-semibold text-white hover:brightness-95" onClick={() => setOpen("approve")}>อนุมัติ + แนบสลิป</button>
          </>
        )}
        {isMine && (
          <button type="button" disabled={busy} className="h-9 rounded-(--radius) border border-(--line) px-3 text-sm text-red-700 hover:bg-(--bg-soft) disabled:opacity-50" onClick={() => run(() => cancelPettyTopupAction({ id: item.id }))}>
            ยกเลิกคำขอ
          </button>
        )}
      </div>
      {open === "approve" && <ApproveTopupModal item={item} today={today} onClose={() => setOpen(null)} />}
      {open === "reject" && <RejectTopupModal item={item} onClose={() => setOpen(null)} />}
    </li>
  );
}

function ApproveTopupModal({ item, today, onClose }: { item: PettyTopupItem; today: string; onClose: () => void }) {
  const { busy, error, run } = useSave(onClose);
  const [method, setMethod] = useState<"transfer" | "cash">("transfer");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  return (
    <Modal
      title={`อนุมัติเติมเงิน ${baht(item.amount)} ให้ ${item.holderName}`}
      onClose={onClose}
      actions={<SaveButtons busy={busy} disabled={files.length === 0} label="อนุมัติ" onClose={onClose} onSave={() => run(() => decidePettyTopupAction({ id: item.id, outcome: "approve", method, note, attachments: files }))} />}
    >
      <div className="flex flex-col gap-3">
        <Explain>ให้เงินก่อน แล้วแนบหลักฐาน — โอน: แนบสลิป · เงินสด: ถ่ายรูปเงินที่ให้ให้เห็นจำนวนชัด · กดอนุมัติแล้วยอดในมือของ {item.holderName} เพิ่ม {baht(item.amount)} และเขาได้แจ้งเตือน</Explain>
        <div className="text-sm">
          <span className="text-(--ink-soft)">เหตุผลที่ขอ:</span> {item.note}
        </div>
        <div role="group" aria-labelledby="topup-method" className="flex flex-col gap-1.5 text-sm">
          <span id="topup-method" className="font-semibold text-(--ink)">
            ให้เงินแบบ <span className="font-normal text-red-700">*</span>
          </span>
          <div className="flex gap-2">
            {(["transfer", "cash"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={method === m}
                onClick={() => setMethod(m)}
                className={`h-10 flex-1 rounded-(--radius) text-sm ${method === m ? "bg-(--brand-navy) font-semibold text-white" : "border border-(--line) text-(--ink)"}`}
              >
                {m === "transfer" ? "โอนเงิน" : "ให้เงินสด"}
              </button>
            ))}
          </div>
        </div>
        <FilePicker role="slip" files={files} onChange={setFiles} label={method === "transfer" ? "สลิปโอน *" : "รูปเงินสดที่ให้ *"} hint="ต้องเห็นจำนวนเงินชัด" today={today} />
        <Field label="หมายเหตุ">
          <input className={field} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}

function RejectTopupModal({ item, onClose }: { item: PettyTopupItem; onClose: () => void }) {
  const { busy, error, run } = useSave(onClose);
  const [note, setNote] = useState("");
  return (
    <Modal
      title={`ไม่อนุมัติคำขอเติมเงินของ ${item.holderName}`}
      onClose={onClose}
      actions={<SaveButtons busy={busy} disabled={!note.trim()} label="ไม่อนุมัติ" onClose={onClose} onSave={() => run(() => decidePettyTopupAction({ id: item.id, outcome: "reject", method: "transfer", note, attachments: [] }))} />}
    >
      <div className="flex flex-col gap-3">
        <Explain>{item.holderName} จะได้แจ้งเตือนพร้อมเหตุผลนี้ และขอใหม่ได้</Explain>
        <Field label="เหตุผล" required>
          <input className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ยอดเยอะเกิน ขอแค่ 2,000 ก่อน" />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}

/* ───────────── ยกเลิกรายการในประวัติ ───────────── */

export function VoidPettyButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!open) return <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => setOpen(true)}>ยกเลิก</button>;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <input className="h-9 flex-1 rounded-(--radius) border border-(--line) px-2 text-sm" placeholder="เหตุผล" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="เหตุผลที่ยกเลิก" autoFocus />
      <button
        type="button"
        disabled={busy || !reason.trim()}
        className="h-9 rounded-(--radius) border border-red-200 px-3 text-sm font-semibold text-red-800 disabled:opacity-50"
        onClick={() =>
          start(async () => {
            const res = await voidPettyEntryAction({ id, reason });
            if (!res.ok) setError(res.error);
            else router.refresh();
          })
        }
      >
        ยืนยัน
      </button>
      {error && <span className="w-full text-xs text-red-700">{error}</span>}
    </div>
  );
}

/**
 * ตรวจ "ซื้อของเอง" ที่จ่ายจากเงินสดย่อยไปก่อน (ผู้ใช้ 8/11/2569) — ผ่าน / ไม่ผ่าน (ต้องมีเหตุผล)
 * ไม่ผ่าน = เงินขาด ค้างคืน · HR กด "ได้เงินคืนแล้ว" เมื่อผู้ถือคืนเงินเข้ากองแล้ว
 */
export function ReviewSpendButtons({ id }: { id: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const go = (outcome: "approve" | "reject") =>
    start(async () => {
      setError(null);
      const res = await reviewPettySpendAction({ id, outcome, note });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  return (
    <div className="mt-2 flex flex-col gap-2">
      {!rejecting ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => go("approve")} className="inline-flex h-9 items-center gap-1.5 rounded-(--radius) bg-(--brand-navy,#1b2537) px-4 text-sm font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} ผ่าน
          </button>
          <button type="button" disabled={busy} onClick={() => setRejecting(true)} className="h-9 rounded-(--radius) border border-red-200 px-4 text-sm font-semibold text-red-800 disabled:opacity-50">
            ไม่ผ่าน
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input className="h-9 min-w-48 flex-1 rounded-(--radius) border border-(--line) px-2 text-sm" placeholder="เหตุผลที่ไม่ผ่าน (ผู้ถือต้องคืนเงิน)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="เหตุผลที่ไม่ผ่าน" autoFocus />
          <button type="button" disabled={busy || !note.trim()} onClick={() => go("reject")} className="h-9 rounded-(--radius) border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-800 disabled:opacity-50">
            ยืนยันไม่ผ่าน
          </button>
          <button type="button" disabled={busy} onClick={() => setRejecting(false)} className="h-9 px-2 text-sm text-(--ink-soft)">ยกเลิก</button>
        </div>
      )}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

/** เงินขาดจากรายการที่ไม่ผ่าน — ผู้ถือคืนเงินเข้ากองแล้ว HR กดปิด (ยกเลิกรายการ = ยอดในมือกลับมา) */
export function MoneyBackButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 h-9 rounded-(--radius) border border-(--line) px-3 text-sm font-semibold text-(--ink) hover:bg-(--bg-soft)">
        ได้เงินคืนแล้ว
      </button>
    );
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input className="h-9 min-w-48 flex-1 rounded-(--radius) border border-(--line) px-2 text-sm" placeholder="หมายเหตุ (ไม่บังคับ) เช่น คืนเงินสดวันที่…" value={note} onChange={(e) => setNote(e.target.value)} aria-label="หมายเหตุ" autoFocus />
      <button
        type="button"
        disabled={busy}
        className="h-9 rounded-(--radius) bg-(--brand-navy,#1b2537) px-3 text-sm font-semibold text-white disabled:opacity-50"
        onClick={() =>
          start(async () => {
            const res = await voidPettyEntryAction({ id, reason: `ได้เงินคืนแล้ว${note.trim() ? ` · ${note.trim()}` : ""}` });
            if (!res.ok) setError(res.error);
            else router.refresh();
          })
        }
      >
        ยืนยัน ได้เงินคืนครบแล้ว
      </button>
      <button type="button" disabled={busy} onClick={() => setOpen(false)} className="h-9 px-2 text-sm text-(--ink-soft)">ยกเลิก</button>
      {error && <span className="w-full text-xs text-red-700">{error}</span>}
    </div>
  );
}

/** เงินขาดที่เรียกคืนไม่ได้ — CEO กดให้บริษัทรับเป็นค่าใช้จ่าย (ต้องมีเหตุผล) */
export function WriteOffButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 h-9 rounded-(--radius) border border-(--line) px-3 text-sm text-(--ink-soft) hover:bg-(--bg-soft)">
        บริษัทรับเป็นค่าใช้จ่าย
      </button>
    );
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input className="h-9 min-w-48 flex-1 rounded-(--radius) border border-(--line) px-2 text-sm" placeholder="เหตุผล เช่น เงินหาย เรียกคืนไม่ได้" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="เหตุผลที่บริษัทรับเป็นค่าใช้จ่าย" autoFocus />
      <button
        type="button"
        disabled={busy || !reason.trim()}
        className="h-9 rounded-(--radius) border border-(--line) bg-(--bg-soft) px-3 text-sm font-semibold text-(--ink) disabled:opacity-50"
        onClick={() =>
          start(async () => {
            const res = await writeOffPettyShortageAction({ id, reason });
            if (!res.ok) setError(res.error);
            else router.refresh();
          })
        }
      >
        ยืนยัน บริษัทรับเป็นค่าใช้จ่าย
      </button>
      <button type="button" disabled={busy} onClick={() => setOpen(false)} className="h-9 px-2 text-sm text-(--ink-soft)">ยกเลิก</button>
      {error && <span className="w-full text-xs text-red-700">{error}</span>}
    </div>
  );
}
