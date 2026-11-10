"use client";

import { useState } from "react";
import { leaveColor } from "./leave-colors";

export interface LeaveTypeGroup {
  name: string;
  days: number;
  people: { employmentId: string; name: string; code: string; dates: string[] }[];
}

/**
 * ป้ายวันลาแยกประเภท — กดแล้วเห็นว่าใครลา วันไหน (ผู้ใช้ 10/11/2569 "ให้ HR CEO เข้ามาดูง่าย")
 * ตอนพิมพ์: ซ่อนกล่องรายชื่อ ให้เอกสารเหมือนเดิม
 */
export function LeaveTypeTotals({ groups }: { groups: LeaveTypeGroup[] }) {
  const [picked, setPicked] = useState<string | null>(null);
  const open = groups.find((g) => g.name === picked) ?? null;

  if (groups.length === 0) return <p className="text-xs text-(--ink-soft)">ไม่มีวันลาในเดือนนี้</p>;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => {
          const c = leaveColor(g.name);
          const selected = g.name === picked;
          return (
            <button
              key={g.name}
              type="button"
              aria-pressed={selected}
              onClick={() => setPicked(selected ? null : g.name)}
              data-testid="leave-type-chip"
              className={`flex min-h-10 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors print:min-h-0 ${
                selected
                  ? "border-2 border-(--brand-navy,#1b2537) bg-(--bg-soft)"
                  : "border border-(--line) bg-(--bg) hover:bg-(--bg-soft)"
              }`}
            >
              <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: c.dot }} />
              <span className="font-medium">{g.name}</span>
              <b className="tabular-nums">{g.days}</b>
              <span className="text-(--ink-soft)">
                วัน · {g.people.length} คน
              </span>
            </button>
          );
        })}
      </div>
      {open ? (
        <div className="mt-3 overflow-hidden rounded-md border-2 border-(--brand-navy,#1b2537) print:hidden" data-testid="leave-type-people">
          <div className="flex items-center justify-between bg-(--bg-soft) px-3 py-2">
            <p className="text-sm font-semibold">
              {open.name} — {open.people.length} คน รวม {open.days} วัน
            </p>
            <button
              type="button"
              onClick={() => setPicked(null)}
              aria-label="ปิด"
              className="min-h-9 min-w-9 rounded text-(--ink-soft) hover:text-(--ink)"
            >
              ✕
            </button>
          </div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-[11px] text-(--ink-soft)">
                <th className="border-b border-(--line) px-3 py-1.5 font-semibold">พนักงาน</th>
                <th className="border-b border-(--line) px-3 py-1.5 font-semibold">วันที่ลา</th>
                <th className="border-b border-(--line) px-3 py-1.5 text-right font-semibold">จำนวน</th>
              </tr>
            </thead>
            <tbody>
              {open.people.map((p) => (
                <tr key={p.employmentId}>
                  <td className="border-b border-(--line) px-3 py-1.5 align-top">
                    <a href={`#emp-${p.employmentId}`} className="font-medium hover:underline">
                      {p.name}
                    </a>
                    <span className="ml-1.5 font-mono text-[10px] text-(--ink-soft)">{p.code}</span>
                  </td>
                  <td className="border-b border-(--line) px-3 py-1.5">{p.dates.join(", ")}</td>
                  <td className="border-b border-(--line) px-3 py-1.5 text-right font-semibold tabular-nums">{p.dates.length} วัน</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
