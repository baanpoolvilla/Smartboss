"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { setWorkerOtAmountAction } from "../actions";
import { baht, parseMoney, round2 } from "../lib/types";
import { Notice } from "./ui";

const field = "h-11 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) focus-visible:border-(--app) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--app)/25";

/**
 * ค่า OT ของคนงานที่มีในระบบ — HR เลือก "คิดจากค่าแรงในระบบ (ปกติ)" หรือ "กรอกยอดเอง (เหมาจ่าย)" (ผู้ใช้ 6/11/2569)
 * ไม่แตะอะไร = คิดจากค่าแรงเหมือนเดิม · กรอกเอง = อนุมัติแล้วบัญชีค่าแรงใช้ยอดนี้แทนสูตรชั่วโมง
 */
export function WorkerOtAmountPanel({
  id,
  system,
  current,
}: {
  id: string;
  /** ยอดที่ระบบคิดจากค่าแรง (null = ยังไม่ตั้งค่าแรง) */
  system: { amount: number; how: string } | null;
  current: { manual: boolean; amount: number };
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"system" | "manual">(current.manual ? "manual" : "system");
  const [amount, setAmount] = useState(current.manual ? String(current.amount) : "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const a = parseMoney(amount);
  const result = mode === "system" ? (system?.amount ?? null) : Number.isFinite(a) && a > 0 ? round2(a) : null;
  // ต้องกดบันทึกเมื่อเปลี่ยนจากที่บันทึกไว้
  const dirty = mode === "manual" ? !current.manual || round2(a) !== current.amount : current.manual;

  return (
    <section className="flex flex-col gap-3 rounded-(--radius-lg) border-2 border-(--app) bg-blue-50 p-4">
      <h2 className="text-base font-bold text-(--ink)">ค่า OT</h2>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold text-(--ink)">คิดยังไง</span>
        <select className={`${field} w-full font-semibold`} value={mode} onChange={(e) => setMode(e.target.value as "system" | "manual")}>
          <option value="system">คิดจากค่าแรงในระบบ (ปกติ)</option>
          <option value="manual">กรอกยอดเอง (เหมาจ่าย / ตกลงกัน)</option>
        </select>
      </label>
      {mode === "manual" && (
        <>
          <label className="flex flex-wrap items-center gap-2 text-sm text-(--ink)">
            <span>จ่าย OT ครั้งนี้</span>
            <input inputMode="decimal" className={`${field} w-32 text-right text-base`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus />
            <span>บาท</span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-semibold text-(--ink)">
              หมายเหตุ <span className="font-normal text-(--ink-soft)">(ไม่บังคับ)</span>
            </span>
            <input className={`${field} w-full`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น หัวหน้าตกลงเหมา" maxLength={200} />
          </label>
        </>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-(--radius) bg-emerald-50 px-3 py-2.5">
        <span className="text-sm text-(--ink)">ค่า OT ที่จะได้</span>
        <span className="text-2xl font-bold tabular-nums text-emerald-700">{result !== null ? baht(result) : "—"}</span>
        <span className="basis-full text-xs text-(--ink-soft)">
          {mode === "system"
            ? (system?.how ?? "ยังไม่ได้ตั้งค่าแรงของคนงานคนนี้ — ตั้งที่หน้าคนงานรายวัน หรือเลือกกรอกยอดเอง")
            : `กรอกเอง${system ? ` · ถ้าคิดจากค่าแรงจะได้ ${baht(system.amount)}` : ""}`}
        </span>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {dirty && (
        <button
          type="button"
          disabled={busy || (mode === "manual" && result === null)}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-(--radius) bg-(--app) px-4 text-sm font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await setWorkerOtAmountAction({ id, mode, value: mode === "manual" ? round2(a) : undefined, note });
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
      )}
    </section>
  );
}
