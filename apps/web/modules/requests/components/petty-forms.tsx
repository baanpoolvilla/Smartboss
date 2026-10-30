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
  requestPettyTopupAction,
  voidPettyEntryAction,
  type UploadedFile,
} from "../actions";
import { PETTY_CATEGORIES, baht, parseMoney, thaiDateTime } from "../lib/types";
import { FilePicker } from "./file-picker";
import { Notice } from "./ui";

/*
 * เงินสดย่อย (ผู้ใช้ 30/10/2569: "ใช้ยาก งง" → ปุ่มอยู่บนการ์ดของแต่ละคน + ปุ่ม ⓘ บอกว่าทำอะไร)
 *   ผู้ถือ:   − จ่ายค่าของ (หมวด + ใบเสร็จบังคับ) · + ขอเติมเงิน (รอ HR/CEO อนุมัติ)
 *   HR/CEO:  + เติมเงิน ให้คนอื่น (สลิปบังคับ) · อนุมัติคำขอเติม (แนบสลิปโอน/รูปเงินสด) · ของตัวเองอนุมัติไม่ได้
 *   นับเงินไม่ตรง: ผู้ถือเอง หรือ HR — ใส่ยอดที่นับได้จริง ระบบปรับให้ตรง
 */

const field = "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)";
const primary = "inline-flex h-11 items-center justify-center gap-2 rounded-(--radius) bg-(--app) px-4 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50";
const ghost = "inline-flex h-11 items-center justify-center rounded-(--radius) border border-(--line) px-4 text-sm text-(--ink) hover:bg-(--bg-soft)";

export interface PettyHolderView {
  userId: string;
  name: string;
  balance: number;
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
}: {
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
}) {
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
              จ่ายค่าของ
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
                <b>− จ่ายค่าของ</b> — ใช้เงินในมือซื้อของ/จ่ายค่าบริการ จดตรงนี้เลย ไม่ต้องทำใบเบิก ต้องบอกว่าค่าอะไร เลือกหมวด และแนบรูปใบเสร็จทุกครั้ง ยอดในมือลดลงทันที
                <br />
                <br />
                <b>+ ขอเติมเงิน</b> — เงินใกล้หมด กดขอ ระบบแจ้ง HR หรือ CEO ให้อนุมัติ (HR ขอเอง = CEO อนุมัติ) คนอนุมัติโอน/ให้เงินสดแล้วแนบหลักฐาน ยอดถึงจะเพิ่ม
                <br />
                <br />
              </>
            )}
            {!isMe && canTopUp && (
              <>
                <b>+ เติมเงินให้</b> — HR/CEO ให้เงินสดย่อยกับคนนี้ (โอนหรือเงินสด) แล้วแนบสลิป/รูปเงินสด ยอดเพิ่มทันที · เติมให้ตัวเองไม่ได้ ต้องกด “ขอเติมเงิน” ให้อีกคนอนุมัติ
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

      {open === "spend" && <SpendModal balance={holder.balance} today={today} onClose={close} />}
      {open === "request" && <RequestTopupModal holder={holder} onClose={close} />}
      {open === "topup" && <TopUpModal holder={holder} today={today} onClose={close} />}
      {open === "adjust" && <AdjustModal holder={holder} onClose={close} />}
    </section>
  );
}

/* ───────────── − จ่ายค่าของ ───────────── */

function SpendModal({ balance, today, onClose }: { balance: number; today: string; onClose: () => void }) {
  const { busy, error, run } = useSave(onClose);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [spentOn, setSpentOn] = useState(today);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const value = parseMoney(amount);
  const over = Number.isFinite(value) && value > balance + 0.005;
  const ready = title.trim() && category && Number.isFinite(value) && value > 0 && !over && spentOn && files.length > 0;
  return (
    <Modal
      title="จ่ายค่าของจากเงินสดย่อย"
      onClose={onClose}
      actions={<SaveButtons busy={busy} disabled={!ready} label="บันทึกการจ่าย" onClose={onClose} onSave={() => run(() => addPettySpendAction({ title, category, amount: value, spentOn, attachments: files }))} />}
    >
      <div className="flex flex-col gap-3">
        <Explain>จดทุกครั้งที่ใช้เงินในมือจ่ายค่าอะไร — กรอกครบทุกช่องที่มี * และแนบรูปใบเสร็จ บันทึกแล้วยอดในมือลดลงทันที · เงินในมือตอนนี้ {baht(balance)}</Explain>
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
          <Field label="จำนวนเงิน (บาท)" required>
            <input inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="วันที่จ่าย" required>
            <input type="date" max={today} className={field} value={spentOn} onChange={(e) => setSpentOn(e.target.value)} />
          </Field>
        </div>
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
          }}
        />
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}

/* ───────────── + ขอเติมเงิน (ผู้ถือ) ───────────── */

function RequestTopupModal({ holder, onClose }: { holder: PettyHolderView; onClose: () => void }) {
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
          ส่งแล้วระบบแจ้ง HR หรือ CEO ให้อนุมัติ (ถ้าคุณเป็น HR ต้องให้ CEO อนุมัติ — อนุมัติของตัวเองไม่ได้) · คนอนุมัติโอน/ให้เงินสด แล้วแนบสลิปหรือรูปเงินสด ยอดในมือถึงจะเพิ่ม · เงินในมือตอนนี้ {baht(holder.balance)}
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
        <Field label="ให้เงินแบบ" required>
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
        </Field>
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
