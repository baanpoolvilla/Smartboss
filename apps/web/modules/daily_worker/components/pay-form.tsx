"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { recordPaymentAction, voidPaymentAction } from "../actions";
import { baht } from "../lib/types";

/**
 * ปุ่มจ่ายเงินของคนงานหนึ่งคน (บัญชีค้างจ่าย) — ค่าเริ่มต้น = ยอดค้างทั้งหมด
 * ผู้ดูแลบ้านจ่ายได้ไม่เกินยอดค้าง · HR (สิทธิ์ตั้งค่าแรง) จ่ายเกินได้ = เบิกล่วงหน้า ต้องใส่หมายเหตุ · เซิร์ฟเวอร์ตรวจซ้ำ
 */
export function PayForm({
  employmentId,
  name,
  date,
  owed,
  earnedToday,
  canAdvance,
}: {
  employmentId: string;
  name: string;
  date: string;
  owed: number;
  earnedToday: number;
  canAdvance: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(owed > 0 ? String(owed) : "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const n = Number(amount);
  const over = n > owed + 0.005;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={owed > 0 ? "rounded-full bg-(--ink) px-3 py-1 text-xs font-semibold text-(--bg)" : "rounded-full border border-(--line) px-3 py-1 text-xs font-semibold"}
      >
        {owed > 0 ? `จ่าย ${baht(owed)}` : canAdvance ? "ให้เบิก…" : "จ่าย…"}
      </button>
    );
  }

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 rounded-xl border border-(--line) bg-(--bg-soft) p-2.5 text-left text-sm">
      <b className="text-[13px]">จ่ายเงิน · {name}</b>
      <div className="flex flex-wrap gap-1.5">
        {owed > 0 && (
          <button type="button" onClick={() => setAmount(String(owed))} className="rounded-full border border-(--line) bg-(--bg) px-2 py-0.5 text-xs">
            ทั้งหมดที่ค้าง {baht(owed)}
          </button>
        )}
        {earnedToday > 0 && earnedToday !== owed && (
          <button type="button" onClick={() => setAmount(String(earnedToday))} className="rounded-full border border-(--line) bg-(--bg) px-2 py-0.5 text-xs">
            เฉพาะวันนี้ {baht(earnedToday)}
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-(--ink-soft)">
          จำนวน (บาท)
          <input
            id={`dw-pay-${employmentId}`}
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-32 rounded-lg border border-(--line) bg-(--bg) px-2 py-1 text-sm text-(--ink) tabular-nums"
          />
        </label>
        <input
          id={`dw-pay-note-${employmentId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={over ? "หมายเหตุ (ต้องใส่ เช่น ค่าเทอมลูก)" : "หมายเหตุ (ไม่บังคับ)"}
          className="min-w-0 flex-1 rounded-lg border border-(--line) bg-(--bg) px-2 py-1 text-sm"
          aria-label="หมายเหตุการจ่าย"
        />
      </div>
      {over && (
        <p className={`text-xs ${canAdvance ? "text-(--tone-warn)" : "text-(--tone-danger)"}`}>
          {canAdvance
            ? `เกินยอดค้าง ${baht(Math.round((n - owed) * 100) / 100)} บาท = เบิกล่วงหน้า จะหักจากค่าแรงวันถัดไปเอง`
            : `จ่ายได้ไม่เกินยอดค้าง ${baht(owed)} บาท — ถ้าจะให้เบิกล่วงหน้า ให้ HR เป็นคนบันทึก`}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !(n > 0) || (over && (!canAdvance || !note.trim()))}
          onClick={() =>
            startTransition(async () => {
              const r = await recordPaymentAction({ employmentId, date, amount: n, note });
              if (r.error) setError(r.error);
              else {
                setOpen(false);
                setNote("");
                router.refresh();
              }
            })
          }
          className="rounded-full bg-(--ink) px-3 py-1.5 text-xs font-semibold text-(--bg) disabled:opacity-40"
        >
          บันทึกจ่าย
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-(--line) px-3 py-1.5 text-xs">
          ยกเลิก
        </button>
      </div>
      {error && <p className="text-xs text-(--tone-danger)">{error}</p>}
    </div>
  );
}

/** ยกเลิกรายการจ่ายที่กดผิด — ต้องใส่เหตุผล (ไม่ลบทิ้ง เก็บประวัติไว้) */
export function VoidPayment({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-(--ink-soft) underline">
        ยกเลิกรายการนี้
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input
        id={`dw-void-${id}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="เหตุผลที่ยกเลิก"
        className="rounded-lg border border-(--line) bg-(--bg) px-2 py-0.5 text-xs"
        aria-label="เหตุผลที่ยกเลิกรายการจ่าย"
      />
      <button
        type="button"
        disabled={pending || !reason.trim()}
        onClick={() =>
          startTransition(async () => {
            const r = await voidPaymentAction({ id, reason });
            if (r.error) setError(r.error);
            else router.refresh();
          })
        }
        className="rounded-full border border-(--tone-danger) px-2 py-0.5 text-xs text-(--tone-danger) disabled:opacity-40"
      >
        ยืนยันยกเลิก
      </button>
      {error && <span className="text-xs text-(--tone-danger)">{error}</span>}
    </span>
  );
}
