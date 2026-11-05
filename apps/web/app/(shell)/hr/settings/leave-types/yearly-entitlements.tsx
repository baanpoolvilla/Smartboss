"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { fmtDays } from "@/modules/hr/lib/leave-type-choice";
import { setYearlyEntitlementAction } from "../../actions";

export interface YearlyRow {
  employmentId: string;
  name: string;
  code: string;
  entitled: number;
  used: number;
  pending: number;
  available: number;
}

/**
 * ตารางสิทธิ์ลารายปีของแต่ละคน — HR กรอกจำนวนวันเอง ปีปฏิทิน ม.ค.–ธ.ค. หมดปีแล้วทิ้ง
 * ส่วนนี้แสดงเฉพาะฝ่ายบุคคลและ CEO (yearly-entitlement-access.ts) คนอื่นไม่รู้ว่าใครได้กี่วัน
 */
export function YearlyEntitlements({
  leaveTypeId,
  leaveTypeName,
  year,
  rows,
}: {
  leaveTypeId: string;
  leaveTypeName: string;
  year: number;
  rows: YearlyRow[];
}) {
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name, "th"));
  const unset = rows.filter((r) => r.entitled <= 0).length;
  const yearLink = (y: number) => `/hr/settings/leave-types?year=${y}#yearly-${leaveTypeId}`;
  return (
    <section id={`yearly-${leaveTypeId}`} data-testid="yearly-entitlements" className="rounded-(--radius) border border-(--line) bg-(--bg) p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-(--ink)">สิทธิ์{leaveTypeName}รายคน · ปี {year + 543}</h2>
          <p className="text-xs text-(--ink-soft)">
            กรอกจำนวนวันของแต่ละคนแล้วกดบันทึก · นับ ม.ค.–ธ.ค. หมดปีแล้วทิ้ง · เห็นได้เฉพาะเจ้าตัว ฝ่ายบุคคล และ CEO
            {unset > 0 ? ` · ยังไม่ได้กรอก ${unset} คน (คนกลุ่มนี้ลงประเภทนี้ไม่ได้)` : ""}
          </p>
        </div>
        <div className="flex gap-1 text-xs">
          <Link href={yearLink(year - 1)} className="rounded-full border border-(--line) px-2.5 py-1 hover:bg-(--bg-soft)">‹ {year + 542}</Link>
          <Link href={yearLink(year + 1)} className="rounded-full border border-(--line) px-2.5 py-1 hover:bg-(--bg-soft)">{year + 544} ›</Link>
        </div>
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-(--ink-soft)">ยังไม่มีพนักงาน</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--line) text-left text-xs text-(--ink-soft)">
                <th className="py-2 pr-2 font-medium">พนักงาน</th>
                <th className="py-2 pr-2 font-medium">ได้ (วัน/ปี)</th>
                <th className="hidden py-2 pr-2 text-right font-medium sm:table-cell">อนุมัติแล้ว</th>
                <th className="hidden py-2 pr-2 text-right font-medium sm:table-cell">รออนุมัติ</th>
                <th className="hidden py-2 text-right font-medium sm:table-cell">เหลือ</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <Row key={`${r.employmentId}:${year}:${r.entitled}`} row={r} leaveTypeId={leaveTypeId} year={year} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Row({ row, leaveTypeId, year }: { row: YearlyRow; leaveTypeId: string; year: number }) {
  const router = useRouter();
  const [days, setDays] = useState(row.entitled > 0 ? fmtDays(row.entitled) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = days.trim() !== (row.entitled > 0 ? fmtDays(row.entitled) : "");
  const save = () => {
    setError(null);
    const form = new FormData();
    form.set("leave_type_id", leaveTypeId);
    form.set("employment_id", row.employmentId);
    form.set("year", String(year));
    form.set("days", days.trim());
    startTransition(async () => {
      const result = await setYearlyEntitlementAction(form);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };
  return (
    <tr className="border-b border-(--line) last:border-0" data-testid={`yearly-row-${row.employmentId}`}>
      <td className="py-2 pr-2 font-medium">
        {row.name}
        {row.code && <span className="ml-1 text-xs font-normal text-(--ink-soft)">{row.code}</span>}
        {/* มือถือไม่มีที่พอสำหรับ 3 ช่องตัวเลข — รวมไว้ใต้ชื่อ */}
        <span className={`block text-xs font-normal sm:hidden ${row.available < 0 ? "text-(--danger)" : "text-(--ink-soft)"}`} data-testid="yearly-row-summary">
          อนุมัติ {fmtDays(row.used)} · รอ {fmtDays(row.pending)} · เหลือ {fmtDays(row.available)}
        </span>
      </td>
      <td className="py-2 pr-2">
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            max={366}
            step={0.5}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            aria-label={`จำนวนวันของ ${row.name}`}
            className="h-8 w-20 rounded-md border border-(--line) bg-(--bg) px-2 text-sm"
          />
          {dirty && (
            <button type="button" disabled={pending || days.trim() === ""} onClick={save} className="h-8 rounded-md bg-(--brand-navy) px-2.5 text-xs font-semibold text-white disabled:opacity-50">
              {pending ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          )}
        </div>
        {error && <p className="mt-1 text-xs text-(--danger)">{error}</p>}
      </td>
      <td className="hidden py-2 pr-2 text-right tabular-nums sm:table-cell">{fmtDays(row.used)}</td>
      <td className="hidden py-2 pr-2 text-right tabular-nums sm:table-cell">{fmtDays(row.pending)}</td>
      <td className={`hidden py-2 text-right font-semibold tabular-nums sm:table-cell ${row.available < 0 ? "text-(--danger)" : ""}`}>{fmtDays(row.available)}</td>
    </tr>
  );
}
