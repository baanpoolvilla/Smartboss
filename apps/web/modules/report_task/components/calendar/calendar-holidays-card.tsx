"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { formatDate } from "@/modules/report_task/lib/format";
import type { CalendarEvent } from "@/modules/report_task/types";

/**
 * บริษัทใช้ "วันหยุดแบบสะสม" ไหม (มีประเภทลาที่ได้สิทธิ์จากวันหยุดบริษัท — ระบบบุคคล accrues_from_holidays)
 * แบบสะสม: วันหยุดตามปฏิทินไม่ได้หยุดจริง วันนั้นทำงานปกติ แล้วได้สิทธิ์ Holiday ไปเลือกหยุดวันอื่น
 * แบบหยุดตามวัน: ทุกคนหยุดวันนั้นเลย · null = ยังไม่รู้/อ่านไม่ได้ (ไม่ขึ้นคำอธิบาย)
 * ดึงครั้งเดียวต่อการเปิดหน้า (endpoint เดียวกับหน้าต่างยื่นลา)
 */
let accrualCache: Promise<boolean | null> | null = null;
function useHolidayAccrual(): boolean | null {
  const [value, setValue] = useState<boolean | null>(null);
  useEffect(() => {
    accrualCache ??= fetch("/api/report-task/hr/leave-context")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { leaveTypes?: { availableByMonth?: unknown }[] } | null) =>
        d?.leaveTypes ? d.leaveTypes.some((t) => t.availableByMonth !== undefined) : null
      )
      .catch(() => null);
    let alive = true;
    void accrualCache.then((v) => {
      if (alive) setValue(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return value;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * วันหยุดตามปฏิทินของบริษัท — การ์ดเล็กใต้ "วันหยุดของฉัน" (ใช้ที่ว่างตรงนั้น ไม่กินพื้นที่เพิ่ม)
 * แยกจากวันหยุด/ลาที่ลงเอง ไม่นับรวมกัน ("ลงไว้ 8 แต่ขึ้น 10 เพราะ 2 วันมาจากปฏิทิน")
 * สูงคงที่ วันเยอะก็เลื่อนในการ์ด
 */
export function CalendarHolidaysCard({ events, range }: { events: CalendarEvent[]; range: { start: Date; end: Date } }) {
  const accrual = useHolidayAccrual();
  // มุมมองเดือน: ช่วงของปฏิทินกินเผื่อสัปดาห์ของเดือนข้างเคียง — เอาเฉพาะเดือนที่ดูอยู่ (เหมือนตารางทีม)
  const span = (range.end.getTime() - range.start.getTime()) / 86_400_000;
  const mid = new Date((range.start.getTime() + range.end.getTime()) / 2);
  const from = span > 20 ? ymd(new Date(mid.getFullYear(), mid.getMonth(), 1)) : ymd(range.start);
  const to = span > 20 ? ymd(new Date(mid.getFullYear(), mid.getMonth() + 1, 1)) : ymd(range.end);
  const holidays = events
    .filter((e) => e.type === "holiday" && !e.userId && e.start.slice(0, 10) >= from && e.start.slice(0, 10) < to)
    .sort((a, b) => a.start.localeCompare(b.start));
  if (holidays.length === 0) return null;

  return (
    <Card className="border-[var(--line)] shadow-none">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
          <CalendarDays className="h-3.5 w-3.5 text-[var(--ink-soft)]" /> วันหยุดตามปฏิทิน
          <span className="rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-xs font-normal text-[var(--ink-soft)]">{holidays.length} วัน</span>
        </CardTitle>
        {accrual === true && (
          <p className="text-xs text-[var(--ink-soft)]">แสดงให้รู้เท่านั้น — วันนี้ยังทำงานปกติ และได้สิทธิ์ Holiday ไว้เลือกหยุดวันอื่น</p>
        )}
        {accrual === false && <p className="text-xs text-[var(--ink-soft)]">วันหยุดบริษัท — ทุกคนหยุดวันนี้ ไม่ต้องลงเอง</p>}
      </CardHeader>
      <CardContent className="max-h-36 space-y-1 overflow-y-auto">
        {holidays.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-2 rounded-md border-l-[3px] border-[#3b6fd8] bg-[#3b6fd8]/8 px-2 py-1 text-sm">
            <span className="min-w-0 truncate">{e.title}</span>
            <span className="shrink-0 text-xs tabular-nums text-[var(--ink-soft)]">{formatDate(e.start)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
