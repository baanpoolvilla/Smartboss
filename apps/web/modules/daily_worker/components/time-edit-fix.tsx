"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { removeOverrideAction, removeTimeEditAction, setTimeEditAction } from "../actions";
import type { DayCell } from "../lib/types";

const REASONS = ["ไปหน้างานมา สแกนไม่ทัน", "ลืมสแกนออก", "เครื่องสแกนมีปัญหา", "หัวหน้าอนุญาต"];

/**
 * ผู้ดูแลบ้านแก้เวลาเข้า/ออกของคนงาน (ผู้ใช้ขอ 19/10/2569: "ไปหน้างานมาและมาสแกนไม่ทัน ให้ผู้ดูแลบ้านมาแก้เวลาให้ได้")
 * เวลาที่แก้ใช้คิดสาย/ขาด/ค่าแรงแทนเวลาที่สแกน · เวลาที่สแกนจริงยังเก็บไว้ · ต้องใส่เหตุผลทุกครั้ง
 */
export function TimeEditFix({
  employmentId,
  date,
  inAt,
  outAt,
  shiftStart,
  shiftEnd,
  cell,
}: {
  employmentId: string;
  date: string;
  inAt: string | null;
  outAt: string | null;
  /** "08:00" — ปุ่มลัด "เข้าตรงเวลา/ออกตามกะ" */
  shiftStart: string | null;
  shiftEnd: string | null;
  cell: DayCell | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [vin, setVin] = useState(inAt ?? "");
  const [vout, setVout] = useState(outAt ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (task: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      const r = await task();
      if (r.error) setError(r.error);
      else {
        setError(null);
        setOpen(false);
        router.refresh();
      }
    });

  return (
    <div className="flex w-full flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {cell?.edit && (
          <button type="button" disabled={pending} onClick={() => run(() => removeTimeEditAction({ employmentId, date }))} className="text-xs text-(--ink-soft) underline disabled:opacity-40">
            ยกเลิกการแก้เวลา
          </button>
        )}
        {cell?.override && (
          <button type="button" disabled={pending} onClick={() => run(() => removeOverrideAction({ employmentId, date }))} className="text-xs text-(--ink-soft) underline disabled:opacity-40">
            ยกเลิก &quot;แก้เป็นมา&quot; แบบเดิม
          </button>
        )}
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="rounded-full border border-(--line) px-2.5 py-1 text-xs font-semibold hover:bg-(--bg-soft)">
            แก้เวลา
          </button>
        )}
      </div>
      {open && (
        <div className="flex w-full flex-col gap-2 rounded-xl border border-(--line) bg-(--bg-soft) p-2.5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-(--ink-soft)">
              เวลาเข้า
              <input id={`dw-in-${employmentId}`} type="time" value={vin} onChange={(e) => setVin(e.target.value)} className="rounded-lg border border-(--line) bg-(--bg) px-2 py-1 text-sm text-(--ink)" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-(--ink-soft)">
              เวลาออก
              <input id={`dw-out-${employmentId}`} type="time" value={vout} onChange={(e) => setVout(e.target.value)} className="rounded-lg border border-(--line) bg-(--bg) px-2 py-1 text-sm text-(--ink)" />
            </label>
            {shiftStart && shiftEnd && (
              <button type="button" onClick={() => { setVin(shiftStart); setVout(shiftEnd); }} className="rounded-full border border-(--line) bg-(--bg) px-2 py-1 text-xs hover:bg-(--bg-soft)">
                เต็มกะ {shiftStart}–{shiftEnd}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className="rounded-full border border-(--line) bg-(--bg) px-2 py-0.5 text-xs hover:bg-(--bg-soft)">
                {r}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              id={`dw-edit-reason-${employmentId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เหตุผลที่แก้ (ต้องใส่)"
              className="min-w-0 flex-1 rounded-lg border border-(--line) bg-(--bg) px-2.5 py-1.5 text-sm"
              aria-label="เหตุผลที่แก้เวลา"
            />
            <button
              type="button"
              disabled={pending || !reason.trim() || (!vin && !vout)}
              onClick={() => run(() => setTimeEditAction({ employmentId, date, inAt: vin, outAt: vout, reason }))}
              className="rounded-full bg-(--ink) px-3 py-1.5 text-xs font-semibold text-(--bg) disabled:opacity-40"
            >
              บันทึก
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-(--line) px-3 py-1.5 text-xs">
              ยกเลิก
            </button>
          </div>
          <p className="text-[11px] text-(--ink-soft)">เวลาที่แก้ใช้คิดสาย/ขาด/ค่าแรงแทนเวลาที่สแกน · เวลาที่สแกนจริงยังเก็บไว้ให้ดูย้อนหลัง</p>
        </div>
      )}
      {error && <p className="text-xs text-(--tone-danger)">{error}</p>}
    </div>
  );
}
