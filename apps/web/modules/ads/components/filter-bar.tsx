"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { addDays, todayIn } from "../lib/periods";

/**
 * ตัวเลือกร่วมทุกหน้า (spec §7): เลือกบัญชี · ช่วงเวลา · ช่วงเปรียบเทียบ
 * เก็บสถานะใน query string (?customer_id=&from=&to=&compare=) เพื่อแชร์ลิงก์ได้
 */
export function FilterBar({
  accounts,
  customerId,
  from,
  to,
  compare,
  showPeriod = true,
}: {
  accounts: { customerId: string; name: string | null }[];
  customerId: string | null;
  from: string;
  to: string;
  /** "previous" | "none" | "YYYY-MM-DD,YYYY-MM-DD" */
  compare: string;
  showPeriod?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [cFrom, cTo] = compare.includes(",") ? compare.split(",") : ["", ""];
  const [custom, setCustom] = useState({ from, to, mode: compare.includes(",") ? "custom" : compare, cFrom, cTo });

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("report");
    router.push(`${pathname}?${next.toString()}`);
  };

  const yesterday = addDays(todayIn(), -1);
  const lastN = (n: number) => ({ from: addDays(yesterday, -(n - 1)), to: yesterday });
  const today = todayIn();
  const monthStart = `${today.slice(0, 8)}01`;
  const prevMonthEnd = addDays(monthStart, -1);
  const presets = [
    { label: "7 วัน", ...lastN(7) },
    { label: "14 วัน", ...lastN(14) },
    { label: "30 วัน", ...lastN(30) },
    { label: "เดือนนี้", from: monthStart, to: yesterday < monthStart ? monthStart : yesterday },
    { label: "เดือนก่อน", from: `${prevMonthEnd.slice(0, 8)}01`, to: prevMonthEnd },
  ];

  const ctl = "h-9 rounded-(--radius) border border-(--line) bg-(--bg) px-2 text-sm text-(--ink)";

  return (
    <div className="flex flex-col gap-2 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-3 shadow-(--shadow-card)">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-(--ink-soft)">บัญชี</span>
          <select
            className={`${ctl} max-w-[260px]`}
            value={customerId ?? ""}
            onChange={(e) => go({ customer_id: e.target.value })}
          >
            {accounts.map((a) => (
              <option key={a.customerId} value={a.customerId}>
                {a.name ?? a.customerId} ({a.customerId})
              </option>
            ))}
          </select>
        </label>
        {showPeriod &&
          presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => go({ from: p.from, to: p.to })}
              className={`h-9 rounded-(--radius) border px-3 text-sm ${
                p.from === from && p.to === to
                  ? "border-[#1A73E8] bg-[#EEF4FE] font-medium text-[#1A73E8]"
                  : "border-(--line) text-(--ink)"
              }`}
            >
              {p.label}
            </button>
          ))}
      </div>
      {showPeriod && (
        <form
          className="flex flex-wrap items-center gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            go({
              from: custom.from,
              to: custom.to,
              compare: custom.mode === "custom" ? `${custom.cFrom},${custom.cTo}` : custom.mode,
            });
          }}
        >
          <span className="text-(--ink-soft)">ช่วง</span>
          <input type="date" className={ctl} value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <span>–</span>
          <input type="date" className={ctl} value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          <span className="ml-2 text-(--ink-soft)">เทียบกับ</span>
          <select className={ctl} value={custom.mode} onChange={(e) => setCustom({ ...custom, mode: e.target.value })}>
            <option value="previous">ช่วงก่อนหน้า (ยาวเท่ากัน)</option>
            <option value="custom">กำหนดเอง</option>
            <option value="none">ไม่เปรียบเทียบ</option>
          </select>
          {custom.mode === "custom" && (
            <>
              <input type="date" className={ctl} value={custom.cFrom} onChange={(e) => setCustom({ ...custom, cFrom: e.target.value })} required />
              <span>–</span>
              <input type="date" className={ctl} value={custom.cTo} onChange={(e) => setCustom({ ...custom, cTo: e.target.value })} required />
            </>
          )}
          <button type="submit" className="h-9 rounded-(--radius) bg-[#1A73E8] px-4 text-sm font-medium text-white">
            ใช้ช่วงนี้
          </button>
        </form>
      )}
    </div>
  );
}
