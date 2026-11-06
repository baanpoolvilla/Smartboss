"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { setUnlinkedOtAmountAction } from "../actions";
import { baht, hoursText, parseMoney, round2 } from "../lib/types";
import { Notice } from "./ui";

const field = "h-11 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) focus-visible:border-(--app) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--app)/25";

/**
 * HR ใส่เงินค่า OT ให้คนงานที่ยังไม่มีในระบบ (ผู้ใช้ 6/11/2569 "ตอนกรอกใส่แค่เวลา ให้ HR ไปใส่ค่าใช้จ่าย เลือกว่าจ่ายตามอะไร")
 * เลือกจาก dropdown บนสุด: คิดจากค่าแรงรายวัน (ค่าแรง ÷ 8 × % OT คนงานของบริษัท × ชม.) หรือกรอกยอดเอง
 */
export function SetOtAmountPanel({
  id,
  name,
  minutes,
  companyPct,
  current,
}: {
  id: string;
  name: string;
  minutes: number;
  companyPct: number;
  /** ยอดเดิม (ใส่ไปแล้ว = แก้ยอด) */
  current: { amount: number; base: number | null; manual: boolean } | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"daily" | "manual">(current?.manual ? "manual" : "daily");
  const [wage, setWage] = useState(current && !current.manual && current.base ? String(current.base) : "");
  const [amount, setAmount] = useState(current?.manual ? String(current.amount) : "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const w = parseMoney(wage);
  const a = parseMoney(amount);
  const result =
    mode === "daily"
      ? Number.isFinite(w) && w > 0
        ? round2((w / 8) * (companyPct / 100) * (minutes / 60))
        : null
      : Number.isFinite(a) && a > 0
        ? round2(a)
        : null;

  return (
    <section className="flex flex-col gap-3 rounded-(--radius-lg) border-2 border-(--app) bg-blue-50 p-4">
      <h2 className="text-base font-bold text-(--ink)">{current ? "แก้เงินค่า OT" : "ใส่เงินค่า OT"}</h2>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold text-(--ink)">คิดค่า OT ยังไง</span>
        <select className={`${field} w-full font-semibold`} value={mode} onChange={(e) => setMode(e.target.value as "daily" | "manual")}>
          <option value="daily">คิดจากค่าแรงรายวัน (ปกติ)</option>
          <option value="manual">กรอกยอดเอง (เหมาจ่าย / ตกลงกัน)</option>
        </select>
      </label>

      {mode === "daily" ? (
        <label className="flex flex-wrap items-center gap-2 text-sm text-(--ink)">
          <span>{name} ได้ค่าแรงวันละ</span>
          <input inputMode="decimal" className={`${field} w-28 text-right`} value={wage} onChange={(e) => setWage(e.target.value)} placeholder="400" autoFocus />
          <span>บาท</span>
        </label>
      ) : (
        <>
          <label className="flex flex-wrap items-center gap-2 text-sm text-(--ink)">
            <span>จ่าย OT ครั้งนี้</span>
            <input inputMode="decimal" className={`${field} w-28 text-right`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus />
            <span>บาท</span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-semibold text-(--ink)">
              หมายเหตุ <span className="font-normal text-(--ink-soft)">(ไม่บังคับ)</span>
            </span>
            <input className={`${field} w-full`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ตกลงเหมาจ่าย" maxLength={200} />
          </label>
        </>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-(--radius) bg-emerald-50 px-3 py-2.5">
        <span className="text-sm text-(--ink)">ค่า OT ที่จะได้</span>
        <span className="text-2xl font-bold tabular-nums text-emerald-700">{result !== null ? baht(result) : "—"}</span>
        <span className="basis-full text-xs text-(--ink-soft)">
          {mode === "daily" ? `คิดจาก ค่าแรง ÷ 8 × ${companyPct}% × ${hoursText(minutes)}` : "กรอกเอง · ไม่ได้คิดจากค่าแรง"}
        </span>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      <button
        type="button"
        disabled={busy || result === null}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-(--radius) bg-(--app) px-4 text-sm font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await setUnlinkedOtAmountAction({ id, mode, value: mode === "daily" ? w : a, note });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            router.refresh();
          })
        }
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        บันทึกยอด
      </button>
    </section>
  );
}
