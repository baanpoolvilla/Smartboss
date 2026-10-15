"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { addHolidayPersonGrantAction } from "../../actions";

/**
 * "+ เพิ่มวัน" ในตารางยอด Holiday รายคน — HR เพิ่มวันให้คนหนึ่ง (เช่นวันหยุดก่อนเริ่มนับที่ยังไม่ได้ใช้)
 * นับเป็นสิทธิ์ของเดือนที่เลือก ใช้ได้ 3 เดือนรวมเดือนนั้น · ต้องใส่เหตุผล (เก็บในประวัติการแก้ของระบบบุคคล)
 */
export function AddHolidayDays({ leaveTypeId, employmentId, name, month }: { leaveTypeId: string; employmentId: string; name: string; month: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(1);
  const [forMonth, setForMonth] = useState(month);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-full border border-(--line) px-2.5 py-0.5 text-xs hover:bg-(--bg-soft)">
        + เพิ่มวัน
      </button>
    );
  }
  return (
    <div className="flex min-w-64 flex-col gap-2 rounded-xl border border-(--line) bg-(--bg-soft) p-2.5 text-xs">
      <b className="text-sm">เพิ่มวัน Holiday ให้ {name}</b>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1">
          จำนวนวัน
          <input id={`hg-days-${employmentId}`} type="number" min={1} max={31} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-16 rounded-md border border-(--line) bg-(--bg) px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          นับเป็นสิทธิ์ของเดือน
          <input id={`hg-month-${employmentId}`} type="month" value={forMonth} onChange={(e) => setForMonth(e.target.value)} className="rounded-md border border-(--line) bg-(--bg) px-2 py-1" />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        เหตุผล (ต้องใส่)
        <input
          id={`hg-reason-${employmentId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="เช่น ชดเชยวันแม่ ส.ค. ที่ยังไม่ได้ใช้"
          className="rounded-md border border-(--line) bg-(--bg) px-2 py-1"
        />
      </label>
      <p className="text-(--ink-soft)">ใช้ได้ 3 เดือนนับรวมเดือนที่เลือก (เหมือนสิทธิ์ของบริษัท)</p>
      {error && <p className="text-(--tone-danger)">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !reason.trim() || days < 1}
          onClick={() =>
            startTransition(async () => {
              const form = new FormData();
              form.set("leave_type_id", leaveTypeId);
              form.set("employment_id", employmentId);
              form.set("days", String(days));
              form.set("month", forMonth);
              form.set("reason", reason);
              const r = await addHolidayPersonGrantAction(form);
              if (r.error) setError(r.error);
              else {
                setOpen(false);
                router.refresh();
              }
            })
          }
          className="rounded-full bg-(--ink) px-3 py-1 font-semibold text-(--bg) disabled:opacity-40"
        >
          บันทึก
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-(--line) px-3 py-1">
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
