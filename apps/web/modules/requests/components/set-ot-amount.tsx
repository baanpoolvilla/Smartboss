"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { setUnlinkedOtAmountAction } from "../actions";
import { baht, hoursText, parseMoney, round2 } from "../lib/types";
import { Notice } from "./ui";

const field = "h-11 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) focus-visible:border-(--app) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--app)/25";

/**
 * HR ใส่เงินค่า OT ให้คนงานที่ยังไม่มีในระบบ — ช่องเดียว กรอกยอดเอง
 * (ผู้ใช้ 6/11/2569: ไม่มีในระบบ = ไม่มีค่าแรงให้คิด มีตัวเลือกคิดจากค่าแรงให้แล้วงง → กรอกยอดอย่างเดียว)
 */
export function SetOtAmountPanel({
  id,
  minutes,
  current,
}: {
  id: string;
  minutes: number;
  /** ยอดเดิม (ใส่ไปแล้ว = แก้ยอด) */
  current: number | null;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(current ? String(current) : "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const a = parseMoney(amount);
  const ok = Number.isFinite(a) && a > 0;

  return (
    <section className="flex flex-col gap-3 rounded-(--radius-lg) border-2 border-(--app) bg-blue-50 p-4">
      <h2 className="text-base font-bold text-(--ink)">{current ? "แก้เงินค่า OT" : "ใส่เงินค่า OT"}</h2>
      <label className="flex flex-wrap items-center gap-2 text-sm text-(--ink)">
        <span>จ่าย OT ครั้งนี้</span>
        <input inputMode="decimal" className={`${field} w-32 text-right text-base`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus />
        <span>บาท</span>
        <span className="text-xs text-(--ink-soft)">({hoursText(minutes)})</span>
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold text-(--ink)">
          หมายเหตุ <span className="font-normal text-(--ink-soft)">(ไม่บังคับ)</span>
        </span>
        <input className={`${field} w-full`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ตกลงเหมาจ่าย" maxLength={200} />
      </label>
      {error && <Notice tone="danger">{error}</Notice>}
      <button
        type="button"
        disabled={busy || !ok}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-(--radius) bg-(--app) px-4 text-sm font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await setUnlinkedOtAmountAction({ id, mode: "manual", value: round2(a), note });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            router.refresh();
          })
        }
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        บันทึกยอด{ok ? ` ${baht(round2(a))}` : ""}
      </button>
    </section>
  );
}
