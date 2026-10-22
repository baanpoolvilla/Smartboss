"use client";

import { useState } from "react";

import { confirmCashAction } from "../actions";
import { outline } from "./ui";
import { useRun } from "./use-run";

/** รับเป็นเงินสด: พนักงานกดยืนยันว่าได้รับแล้ว (เป็นหลักฐานแทนสลิปโอน) */
export function CashConfirm({ runId }: { runId: string }) {
  const [done, setDone] = useState(false);
  const { busy, error, run } = useRun();
  if (done) return <p className="text-center text-sm font-medium text-emerald-800">บันทึกแล้วว่าได้รับเงินสด</p>;
  return (
    <div className="flex flex-col gap-1">
      <button type="button" className={outline} disabled={busy} onClick={() => run(() => confirmCashAction({ runId }), () => setDone(true))}>
        ได้รับเงินสดแล้ว
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
