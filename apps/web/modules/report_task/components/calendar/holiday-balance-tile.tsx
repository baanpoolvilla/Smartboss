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

/** ช่องสถิติ "Holiday เหลือ" — หน้าตาเดียวกับช่อง วันลา / วันหยุดประจำ ข้าง ๆ · กดได้ = เปิดรายละเอียด (holiday-detail-dialog.tsx) */
export function HolidayBalanceTile({ balance, onOpen }: { balance: HolidayBalance; onOpen?: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      className="rounded-lg bg-[var(--bg-soft)] px-3 py-2 text-center transition-colors enabled:hover:bg-[var(--accent)] enabled:cursor-pointer"
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
      {onOpen && <p className="text-[10px] font-medium text-[var(--brand-green-dark)]">ดูรายละเอียด ›</p>}
    </button>
  );
}

export interface MyWorkDays {
  tracked: boolean;
  workedDays?: number;
  lateDays?: number;
  absentDays?: number;
  otDays?: number;
  otMinutes?: number;
}

/**
 * วันมาทำงาน / ขาด / OT ของตัวเองในช่วงที่ปฏิทินแสดง (api/report-task/hr/my-work-days) — ของใครของมัน
 * null ระหว่างโหลด · tracked=false = ไม่ได้ผูกทะเบียนพนักงาน ⇒ ไม่แสดงช่อง
 */
export function useMyWorkDays(start: Date, end: Date): MyWorkDays | null {
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const key = `${ymd(start)}_${ymd(end)}`;
  const [loaded, setLoaded] = useState<{ key: string; data: MyWorkDays } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const [from, to] = key.split("_");
    fetch(`/api/report-task/hr/my-work-days?from=${from}&to=${to}`)
      .then((r) => (r.ok ? r.json() : { tracked: false }))
      .then((data: MyWorkDays) => {
        if (!cancelled) setLoaded({ key, data });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, data: { tracked: false } });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return loaded?.key === key ? loaded.data : null;
}
