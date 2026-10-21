"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { addPettyEntryAction, voidPettyEntryAction, type UploadedFile } from "../actions";
import { baht, parseMoney } from "../lib/types";
import { FilePicker } from "./file-picker";
import { Notice } from "./ui";

const field = "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)";

export function PettyEntryForm({ holders, defaultHolder, today }: { holders: { userId: string; name: string; balance: number }[]; defaultHolder: string; today: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [holder, setHolder] = useState(defaultHolder);
  const [kind, setKind] = useState<"top_up" | "adjust">("top_up");
  const [amount, setAmount] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const bal = holders.find((h) => h.userId === holder)?.balance ?? 0;
  const c = parseMoney(counted);
  const adjustDelta = Number.isFinite(c) ? Math.round((c - bal) * 100) / 100 : NaN;
  const value = kind === "top_up" ? parseMoney(amount) : adjustDelta;

  function save() {
    setError(null);
    start(async () => {
      const res = await addPettyEntryAction({ holderUserId: holder, kind, amount: value, note, attachments: files });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAmount("");
      setCounted("");
      setNote("");
      setFiles([]);
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4">
      <h2 className="text-sm font-bold text-(--ink)">ลงรายการ</h2>
      <div className="flex flex-wrap gap-2">
        {(["top_up", "adjust"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`h-9 rounded-full px-3.5 text-sm ${kind === k ? "bg-(--brand-navy) font-semibold text-white" : "border border-(--line)"}`}>
            {k === "top_up" ? "เติมเงิน" : "นับเงินจริง / ปรับยอด"}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold text-(--ink)">เงินสดย่อยของ</span>
        <select className={field} value={holder} onChange={(e) => setHolder(e.target.value)}>
          {holders.map((h) => (
            <option key={h.userId} value={h.userId}>{h.name} · ในระบบ {baht(h.balance)}</option>
          ))}
        </select>
      </label>
      {kind === "top_up" ? (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-(--ink)">เติมเข้า (บาท)</span>
          <input inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} />
          {Number.isFinite(value) && value > 0 && <span className="text-xs text-(--ink-soft)">เติมแล้วเหลือ {baht(bal + value)}</span>}
        </label>
      ) : (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-(--ink)">นับเงินจริงได้ (บาท)</span>
          <input inputMode="decimal" className={field} value={counted} onChange={(e) => setCounted(e.target.value)} />
          {Number.isFinite(adjustDelta) && (
            <span className={`text-xs ${Math.abs(adjustDelta) < 0.005 ? "text-emerald-700" : "font-medium text-amber-700"}`}>
              {Math.abs(adjustDelta) < 0.005 ? "ตรงกับในระบบ ไม่ต้องปรับ" : `${adjustDelta > 0 ? "เกิน" : "ขาด"} ${baht(Math.abs(adjustDelta))} จากในระบบ (${baht(bal)})`}
            </span>
          )}
        </label>
      )}
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold text-(--ink)">หมายเหตุ {kind === "adjust" && <span className="font-normal text-red-700">(ต้องใส่)</span>}</span>
        <input className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "top_up" ? "เช่น เบิกจากบัญชีบริษัท" : "เช่น ทอนเงินผิด"} />
      </label>
      {kind === "top_up" && <FilePicker role="slip" files={files} onChange={setFiles} label="หลักฐานการเติม" hint="สลิปโอน / รูปเงินสด" today={today} />}
      {error && <Notice tone="danger">{error}</Notice>}
      <button
        type="button"
        onClick={save}
        disabled={busy || !Number.isFinite(value) || Math.abs(value) < 0.005 || (kind === "top_up" && (value <= 0 || files.length === 0)) || (kind === "adjust" && !note.trim())}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-(--radius) bg-(--app) px-4 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}บันทึก
      </button>
    </section>
  );
}

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
