"use client";

import { excludeAction } from "../actions";
import { useRun } from "./use-run";

/** กลับมาจ่ายงวดนี้ (คนที่เลือก "ไม่จ่ายงวดนี้" ไว้) */
export function IncludeButton({ runId, employmentId }: { runId: string; employmentId: string }) {
  const { busy, error, run } = useRun();
  return (
    <span className="flex items-center gap-2">
      <button type="button" disabled={busy} onClick={() => run(() => excludeAction({ runId, employmentId, exclude: false, reason: "" }))} className="text-xs font-semibold text-(--app-strong) underline disabled:opacity-50">
        {busy ? "กำลังทำ…" : "กลับมาจ่ายงวดนี้"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
