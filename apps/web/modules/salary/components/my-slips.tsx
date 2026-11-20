import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { mySlips } from "../lib/views";
import { mySavings } from "../lib/savings";
import { fmtBaht, periodLabel, thaiDate } from "../lib/types";
import { card } from "./ui";

/** เงินสะสมของฉัน — ยอดรวมอย่างเดียว (ไม่มีเงินสะสม = ไม่มีกล่อง) */
export async function MySavingsBox({ orgId, userId }: { orgId: string; userId: string }) {
  const rows = await mySavings(orgId, userId).catch(() => []);
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <section key={r.name} className={`${card} flex flex-col gap-0.5 p-4`}>
          <span className="text-sm text-(--ink-soft)">เงินสะสมของฉัน · {r.name}</span>
          <span className="text-2xl font-bold tabular-nums text-(--ink)">{fmtBaht(r.total)}</span>
          <span className="text-xs text-(--ink-soft)">{r.asOf ? `ถึง ${periodLabel(r.asOf)} · ` : ""}ได้คืนเมื่อออกจากงาน</span>
        </section>
      ))}
    </div>
  );
}

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
