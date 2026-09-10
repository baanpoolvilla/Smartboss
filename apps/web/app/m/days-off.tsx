"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * ปฏิทิน "วันหยุดของฉัน" ในเดือนหนึ่ง
 *
 * ⚠ คำศัพท์ที่ต้องรักษาไว้: หน้านี้พูดว่า **วันหยุด** ไม่ใช่ **ลา**
 * ถึงเบื้องหลังจะเก็บด้วยกลไกใบลาของ workforce ก็ตาม — สำหรับพนักงาน
 * "วันหยุด" คือสิทธิ์ประจำเดือนตามสัญญาจ้าง (เดือนละ 4-6 วัน) ส่วน "ลา" คือ
 * ป่วย/ธุระที่ต้องมีเหตุผล คนละเรื่องกันคนละความรู้สึกกัน
 */

interface DayOff {
  id: string;
  startsOn: string;
  endsOn: string;
  label: string;
  typeName: string | null;
  pending: boolean;
}

const WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/** เดือนปัจจุบันตามเวลาไทย — ไม่ใช่ของ UTC ซึ่งเปลี่ยนเดือนช้ากว่า 7 ชั่วโมง */
function currentMonth(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, m! - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function monthTitle(month: string): string {
  const [year, m] = month.split("-").map(Number);
  // ปีพุทธศักราช — ปฏิทินภายในบริษัทไทยใช้ พ.ศ. กันทั้งนั้น
  return `${THAI_MONTHS[m! - 1]} ${year! + 543}`;
}

/** ทุกวันที่อยู่ในช่วงคำขอหนึ่งใบ (ใบเดียวกินได้หลายวัน) */
function expandDates(item: DayOff): string[] {
  const out: string[] = [];
  const start = new Date(`${item.startsOn}T00:00:00Z`);
  const end = new Date(`${item.endsOn}T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function DaysOff() {
  const [month, setMonth] = useState(currentMonth);
  const [items, setItems] = useState<DayOff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (target: string) => {
    try {
      const response = await fetch(`/api/m/days-off?month=${target}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        items?: DayOff[];
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "โหลดวันหยุดไม่สำเร็จ");
        setItems([]);
        return;
      }
      setItems(payload.items ?? []);
      setError(null);
    } catch {
      setError("เชื่อมต่อไม่ได้ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [load, month]);

  const marked = new Map<string, DayOff>();
  for (const item of items) {
    for (const date of expandDates(item)) marked.set(date, item);
  }

  const [year, m] = month.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year!, m! - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year!, m!, 0)).getUTCDate();
  const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      return `${month}-${day}`;
    }),
  ];

  return (
    <div className="flex flex-1 flex-col gap-4 p-5 pt-8">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="เดือนก่อนหน้า"
          onClick={() => {
            setLoading(true);
            setMonth((current) => shiftMonth(current, -1));
          }}
          className="flex h-10 w-10 items-center justify-center rounded-full text-(--ink)"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">{monthTitle(month)}</h1>
        <button
          type="button"
          aria-label="เดือนถัดไป"
          onClick={() => {
            setLoading(true);
            setMonth((current) => shiftMonth(current, 1));
          }}
          className="flex h-10 w-10 items-center justify-center rounded-full text-(--ink)"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((label) => (
          <div key={label} className="py-1 text-xs font-medium text-(--ink-soft)">
            {label}
          </div>
        ))}

        {cells.map((date, index) => {
          if (date === null) return <div key={`pad-${index}`} />;
          const hit = marked.get(date);
          const isToday = date === today;

          return (
            <div
              key={date}
              className={`flex h-11 flex-col items-center justify-center rounded-(--radius) text-sm ${
                hit
                  ? hit.pending
                    ? "bg-(--tone-warn)/15 font-semibold text-(--tone-warn)"
                    : "bg-(--app)/15 font-semibold text-(--app-strong)"
                  : "text-(--ink)"
              } ${isToday ? "ring-2 ring-(--app)" : ""}`}
            >
              {Number(date.slice(-2))}
              {hit && (
                <span
                  className="mt-0.5 h-1 w-1 rounded-full"
                  style={{
                    backgroundColor: hit.pending ? "var(--tone-warn)" : "var(--app)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-sm text-(--danger)">{error}</p>}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-(--ink-soft)">
          วันหยุดเดือนนี้ {items.length > 0 && `(${marked.size} วัน)`}
        </h2>

        {loading ? (
          <p className="text-sm text-(--ink-soft)">กำลังโหลด…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-(--ink-soft)">เดือนนี้ยังไม่มีวันหยุด</p>
        ) : (
          <ul className="divide-y divide-(--line) rounded-(--radius) border border-(--line)">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 p-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm">{item.label}</span>
                  {item.typeName && item.typeName !== item.label && (
                    <span className="block truncate text-xs text-(--ink-soft)">
                      {item.typeName}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm tabular-nums">
                    {item.startsOn === item.endsOn
                      ? Number(item.startsOn.slice(-2))
                      : `${Number(item.startsOn.slice(-2))}–${Number(item.endsOn.slice(-2))}`}
                  </span>
                  {item.pending && (
                    <span className="block text-xs text-(--tone-warn)">รออนุมัติ</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
