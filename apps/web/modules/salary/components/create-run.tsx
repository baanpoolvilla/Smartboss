"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";

import { createRunAction } from "../actions";
import { Notice } from "@/modules/requests/components/ui";
import { field, hint, label, labelText, navy, outline } from "./ui";
import { useRun } from "./use-run";

/** "สร้างใหม่" — เติมช่วงวันที่/วันจ่ายตามตั้งค่าให้ แก้ได้ก่อนกด (FlowAccount: วันที่ทำรายการ / ช่วงวันที่ / วันที่ชำระ) */
export function CreateRun({ defaults, blocked }: { defaults: { period: string; periodLabel: string; startsOn: string; endsOn: string; payDate: string }; blocked: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(defaults);
  const { busy, error, run } = useRun();
  if (!open) {
    return (
      <button type="button" className={navy} onClick={() => setOpen(true)} disabled={!!blocked} title={blocked ?? undefined}>
        <Plus className="h-4 w-4" aria-hidden="true" /> สร้างใหม่
      </button>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="สร้างรอบเงินเดือน">
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-t-(--radius-lg) bg-(--bg) p-5 sm:rounded-(--radius-lg)">
        <div>
          <h2 className="text-lg font-bold text-(--ink)">สร้างรายการเงินเดือน {defaults.periodLabel}</h2>
          <p className={hint}>ระบบเติมรายชื่อพนักงานรายเดือนทุกคน พร้อมเงินเดือน OT เบิกล่วงหน้า ลา และรายการประจำให้เอง</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            <span className={labelText}>ช่วงวันที่ (ตั้งแต่)</span>
            <input type="date" className={field} value={v.startsOn} onChange={(e) => setV({ ...v, startsOn: e.target.value })} />
          </label>
          <label className={label}>
            <span className={labelText}>ถึงวันที่ (ตัดงวด)</span>
            <input type="date" className={field} value={v.endsOn} onChange={(e) => setV({ ...v, endsOn: e.target.value, period: e.target.value.slice(0, 7) || v.period })} />
          </label>
          <label className={`${label} col-span-2 sm:col-span-1`}>
            <span className={labelText}>วันที่ชำระ (วันจ่าย)</span>
            <input type="date" className={field} value={v.payDate} onChange={(e) => setV({ ...v, payDate: e.target.value })} />
          </label>
        </div>
        <p className={hint}>งวดนับตามเดือนของวันตัดงวด · แก้วันจ่ายได้เฉพาะงวดนี้ (ค่าเริ่มต้นตั้งที่ ตั้งค่า)</p>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" className={outline} onClick={() => setOpen(false)} disabled={busy}>
            ยกเลิก
          </button>
          <button
            type="button"
            className={navy}
            disabled={busy || !v.startsOn || !v.endsOn || !v.payDate}
            onClick={() =>
              run(
                async () => {
                  const res = await createRunAction(v);
                  if (res.ok) router.push(`/salary/runs/${res.id}`);
                  return res;
                },
              )
            }
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} สร้างและคำนวณ
          </button>
        </div>
      </div>
    </div>
  );
}
