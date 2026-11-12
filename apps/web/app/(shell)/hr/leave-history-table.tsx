"use client";

import { Children, useState, type ReactNode } from "react";
import { DataTable } from "@/modules/hr/components/ui";

const FIRST = 10;
const STEP = 20;

/**
 * ตารางประวัติการลง/ยกเลิก/สลับวันหยุด — เดือนที่คนลงเยอะประวัติยาวทั้งหน้า
 * (ผู้ใช้ 12/11/2569 "ประวัติมาเยอะเกินไป") → โชว์ 10 แถวล่าสุดก่อน กด "ดูเพิ่ม" ทีละ 20
 * พอเกิน 10 แถวจะอยู่ในกรอบสูงจำกัด เลื่อนขึ้นลงในกรอบแทนการยืดทั้งหน้า
 */
export function LeaveHistoryTable({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  const rows = Children.toArray(children);
  const [shown, setShown] = useState(FIRST);
  const visible = rows.slice(0, shown);
  const left = rows.length - visible.length;

  return (
    <div className="space-y-2">
      <div className={shown > FIRST ? "max-h-[32rem] overflow-y-auto rounded-xl" : undefined} data-testid="leave-history-box">
        <DataTable head={head}>{visible}</DataTable>
      </div>
      {(left > 0 || shown > FIRST) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-(--ink-soft)">
            แสดง {visible.length} จาก {rows.length} รายการ
          </span>
          {left > 0 && (
            <button
              type="button"
              onClick={() => setShown((n) => n + STEP)}
              className="rounded-lg border border-(--line) bg-white px-3 py-1.5 font-medium text-(--brand-navy) hover:bg-(--bg-soft)"
            >
              ดูเพิ่มอีก {Math.min(STEP, left)} รายการ
            </button>
          )}
          {left > STEP && (
            <button type="button" onClick={() => setShown(rows.length)} className="px-2 py-1.5 text-xs text-(--ink-soft) hover:text-(--ink) hover:underline">
              ดูทั้งหมด
            </button>
          )}
          {shown > FIRST && (
            <button type="button" onClick={() => setShown(FIRST)} className="px-2 py-1.5 text-xs text-(--ink-soft) hover:text-(--ink) hover:underline">
              ย่อกลับ
            </button>
          )}
        </div>
      )}
    </div>
  );
}
