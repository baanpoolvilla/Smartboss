"use client";

import { useEffect, useState } from "react";

interface HolidayBalance {
  leaveTypeId: string;
  name: string;
  availableDays: number;
  expiringDays: number;
}

/**
 * ยอด Holiday (แบบสะสม) ของตัวเองในเดือนที่ปฏิทินแสดงอยู่ — โหลดจากฝ่ายบุคคล ของใครของมัน
 * คืน [] ระหว่างโหลด/บริษัทไม่ได้ใช้แบบสะสม ⇒ การ์ดไม่ต้องเผื่อช่องไว้
 * refreshKey เปลี่ยน = โหลดใหม่ (เช่นหลังปิดฟอร์มยื่นวันลา ยอดอาจลดลงแล้ว)
 */
export function useHolidayBalance(month: string, refreshKey: unknown): HolidayBalance[] {
  const [loaded, setLoaded] = useState<{ month: string; items: HolidayBalance[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/report-task/hr/holiday-balance?month=${month}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items?: HolidayBalance[] }) => {
        if (!cancelled) setLoaded({ month, items: data.items ?? [] });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ month, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [month, refreshKey]);
  // ยอดของเดือนอื่นที่ค้างจากรอบก่อนไม่เอามาแสดง — ระหว่างโหลดเดือนใหม่ให้ว่างไว้
  return loaded?.month === month ? loaded.items : [];
}

/** ช่องสถิติ "Holiday เหลือ" — หน้าตาเดียวกับช่อง วันลา / วันหยุดประจำ ข้าง ๆ */
export function HolidayBalanceTile({ balance }: { balance: HolidayBalance }) {
  return (
    <div
      className="rounded-lg bg-[var(--bg-soft)] px-3 py-2 text-center"
      title={
        balance.expiringDays > 0
          ? `${balance.expiringDays} วันต้องใช้ภายในเดือนนี้ ไม่งั้นถูกตัดทิ้ง`
          : "สิทธิ์ของแต่ละเดือนใช้ได้ภายใน 3 เดือน"
      }
    >
      <p className="text-lg font-semibold tabular-nums">{balance.availableDays}</p>
      <p className="text-[11px] text-[var(--ink-soft)]">{balance.name} เหลือ</p>
      {balance.expiringDays > 0 && (
        <p className="text-[10px] font-medium" style={{ color: "var(--tone-warn)" }}>
          หมดอายุสิ้นเดือน {balance.expiringDays} วัน
        </p>
      )}
    </div>
  );
}
