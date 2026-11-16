"use client";

import { useState, useTransition } from "react";
import { retryOtSlipAction } from "./actions";

/** OT ที่อนุมัติแล้วแต่ยังไม่มีใบใน เบิกจ่าย & OT — กดสร้างใหม่ และบอกผลบนจอ (ไม่เงียบ) */
export function RetryOtSlipButton({ overtimeRequestId, workDate }: { overtimeRequestId: string; workDate: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  if (result?.ok) return <span className="text-xs font-medium text-(--ink)">{result.message}</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-(--danger)">{result ? result.message : "ยังไม่มีใบ OT ใน เบิกจ่าย & OT"}</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResult(await retryOtSlipAction(overtimeRequestId, workDate)))}
        className="h-8 rounded-lg border border-(--line) bg-white px-3 text-xs font-medium text-[var(--brand-navy)] hover:border-[var(--brand-navy)] disabled:opacity-50"
      >
        {pending ? "กำลังสร้าง…" : "สร้างใบ OT อีกครั้ง"}
      </button>
    </span>
  );
}
