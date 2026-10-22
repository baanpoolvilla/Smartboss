import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { mySlips } from "../lib/views";
import { fmtBaht, periodLabel, thaiDate } from "../lib/types";
import { card } from "./ui";

/** สลิปของฉัน — เฉพาะงวดที่บริษัทบันทึกจ่ายแล้ว */
export async function MySlipList({ orgId, userId }: { orgId: string; userId: string }) {
  const slips = await mySlips(orgId, userId).catch(() => []);
  if (slips.length === 0) {
    return <div className={`${card} p-6 text-center text-sm text-(--ink-soft)`}>ยังไม่มีสลิปเงินเดือน — สลิปจะขึ้นที่นี่เมื่อบริษัทจ่ายเงินเดือนผ่านระบบแล้ว</div>;
  }
  return (
    <ul className={`${card} divide-y divide-(--line)`}>
      {slips.map((s) => (
        <li key={s.runId}>
          <Link href={`/salary/my/${s.runId}`} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-(--bg-soft)">
            <div className="min-w-0">
              <div className="font-semibold text-(--ink)">สลิปเงินเดือน {periodLabel(s.period)}</div>
              <div className="text-xs text-(--ink-soft)">เงินเข้า {thaiDate(s.paidOn ?? s.payDate)}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold tabular-nums text-(--ink)">{fmtBaht(s.net)}</span>
              <ChevronRight className="h-4 w-4 text-(--ink-soft)" aria-hidden="true" />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
