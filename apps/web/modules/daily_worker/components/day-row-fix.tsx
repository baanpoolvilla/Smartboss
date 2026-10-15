"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { removeOverrideAction, setOverrideAction } from "../actions";

/**
 * ปุ่ม "แก้เป็นมา" ในหน้าลงเวลาวันนี้ — ผู้ดูแลแก้คนที่ขาด (เข้าสาย) หรือไม่ได้ลงเวลา ให้เป็น "มา" ได้ทันที
 * ต้องใส่เหตุผลทุกครั้ง (เก็บว่าใครแก้ เมื่อไหร่) · เวลาที่ลงจริงยังเก็บไว้เหมือนเดิม
 */
export function DayRowFix({
  employmentId,
  date,
  status,
  overridden,
}: {
  employmentId: string;
  date: string;
  status: "x" | "n" | "w" | "m";
  overridden: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (overridden) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await removeOverrideAction({ employmentId, date });
            if (r.error) setError(r.error);
            else router.refresh();
          })
        }
        className="text-xs text-(--ink-soft) underline disabled:opacity-40"
      >
        ยกเลิกการแก้
      </button>
    );
  }
  if (status === "m") return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-(--line) px-2.5 py-1 text-xs font-semibold hover:bg-(--bg-soft)"
      >
        แก้เป็นมา
      </button>
    );
  }

  const reasons = status === "x" ? ["หัวหน้าอนุญาตให้เข้าสาย", "ไปทำงานให้บริษัทก่อนเข้างาน", "เครื่องลงเวลามีปัญหา"] : ["ลืมลงเวลา", "ลงเวลาไม่ติด", "ไปทำงานนอกสถานที่"];

  return (
    <div className="flex w-full flex-col gap-2 rounded-xl border border-(--line) bg-(--bg-soft) p-2.5">
      <div className="flex flex-wrap gap-1.5">
        {reasons.map((r) => (
          <button key={r} type="button" onClick={() => setReason(r)} className="rounded-full border border-(--line) bg-(--bg) px-2 py-0.5 text-xs hover:bg-(--bg-soft)">
            {r}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          id={`fix-reason-${employmentId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="เหตุผลที่แก้ (ต้องใส่)"
          className="min-w-0 flex-1 rounded-lg border border-(--line) bg-(--bg) px-2.5 py-1.5 text-sm"
          aria-label="เหตุผลที่แก้เป็นมา"
        />
        <button
          type="button"
          disabled={pending || !reason.trim()}
          onClick={() =>
            startTransition(async () => {
              const r = await setOverrideAction({ employmentId, date, reason });
              if (r.error) setError(r.error);
              else {
                setOpen(false);
                router.refresh();
              }
            })
          }
          className="rounded-full bg-(--ink) px-3 py-1.5 text-xs font-semibold text-(--bg) disabled:opacity-40"
        >
          บันทึก
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-(--line) px-3 py-1.5 text-xs">
          ยกเลิก
        </button>
      </div>
      {error && <p className="text-xs text-(--tone-danger)">{error}</p>}
    </div>
  );
}
