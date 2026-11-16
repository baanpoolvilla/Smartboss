"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Pencil } from "lucide-react";

import { editStaffOtAmountAction } from "../actions";
import { baht, parseMoney, round2 } from "../lib/types";
import { Notice } from "./ui";

const field = "h-11 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) focus-visible:border-(--app) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--app)/25";

/**
 * ยอดเงินในใบ OT พนักงาน — บอกชัด ๆ ว่าแก้ได้ไหม เพราะอะไร (ผู้ใช้ 16/11/2569 "ให้รู้ว่าอันไหนแก้ได้ไม่ได้")
 * แก้ได้ = ปุ่ม "แก้ยอด" · แก้ไม่ได้ = ไอคอนกุญแจ + เหตุผล + ทางที่ต้องทำแทน
 */
export function EditStaffOtAmountPanel({ id, current, canEdit, reason }: { id: string; current: number; canEdit: boolean; reason: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(current));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const a = parseMoney(amount);
  const ok = Number.isFinite(a) && a >= 0 && Math.abs(a - current) >= 0.005;

  return (
    <section className={`flex flex-col gap-2 rounded-(--radius-lg) border p-4 ${canEdit ? "border-(--line) bg-(--bg)" : "border-(--line) bg-(--bg-soft)"}`}>
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold text-(--ink)">ยอดเงิน OT</h2>
        <b className="ml-auto text-lg tabular-nums text-(--ink)">{baht(current)}</b>
      </div>
      {canEdit ? (
        <p className="flex items-start gap-1.5 text-xs text-(--ink-soft)">
          <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            <b className="text-(--ink)">แก้ยอดได้</b> · {reason}
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-1.5 text-xs text-(--ink-soft)">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            <b className="text-(--ink)">แก้ยอดไม่ได้</b> · {reason}
          </span>
        </p>
      )}
      {canEdit && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-(--radius) border border-(--line) bg-white px-4 text-sm font-medium text-[var(--brand-navy)] hover:border-[var(--brand-navy)]"
        >
          <Pencil className="h-4 w-4" aria-hidden="true" /> แก้ยอด
        </button>
      )}
      {canEdit && open && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-wrap items-center gap-2 text-sm text-(--ink)">
            <span>ยอดใหม่</span>
            <input inputMode="decimal" autoFocus className={`${field} w-36 text-right text-base`} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="ยอดเงิน OT ใหม่ (บาท)" />
            <span>บาท</span>
          </label>
          <input className={`${field} w-full`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เหตุผล เช่น ตกลงเหมาจ่าย (ไม่บังคับ)" maxLength={200} aria-label="เหตุผลที่แก้ยอด" />
          <p className="text-xs text-(--ink-soft)">ระบบบันทึกไว้ในประวัติของใบนี้ว่าใครแก้ เมื่อไหร่ จาก {baht(current)} เป็นเท่าไหร่ และเหตุผล</p>
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !ok}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-(--radius) bg-[var(--brand-navy)] px-4 text-sm font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() =>
                start(async () => {
                  setError(null);
                  const res = await editStaffOtAmountAction({ id, amount: round2(a), note });
                  if (!res.ok) {
                    setError(res.error);
                    return;
                  }
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {ok ? `บันทึก ${baht(round2(a))}` : "บันทึก"}
            </button>
            <button type="button" className="h-10 rounded-(--radius) border border-(--line) px-4 text-sm" onClick={() => { setOpen(false); setAmount(String(current)); setError(null); }}>
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
