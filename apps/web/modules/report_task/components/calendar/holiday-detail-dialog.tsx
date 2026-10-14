"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/modules/report_task/components/ui/dialog";
import { Button } from "@/modules/report_task/components/ui/button";

interface HolidayGrantDetail {
  month: string;
  grantedDays: number;
  remainingDays: number;
  expiresMonth: string;
  holidays: { date: string; name: string }[];
}

interface HolidayDetail {
  leaveTypeId: string;
  name: string;
  availableDays: number;
  expiringDays: number;
  grants?: HolidayGrantDetail[];
  used?: { startsOn: string; endsOn: string; days: number; pending: boolean }[];
}

const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const MONTHS_TH_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

/** "2026-12" → "ธันวาคม 2569" */
function monthLong(key: string): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return `${MONTHS_TH_FULL[m - 1]} ${y + 543}`;
}
/** "2027-02" → "ก.พ. 70" */
function monthShort(key: string): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return `${MONTHS_TH[m - 1]} ${String((y + 543) % 100).padStart(2, "0")}`;
}
/** "2026-12-05" → "5 ธ.ค." */
function dayShort(date: string): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS_TH[m - 1]}`;
}
/** สิ้นเดือนของ "2027-02" → "28 ก.พ. 2570" */
function endOfMonthLong(key: string): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const last = new Date(y, m, 0).getDate();
  return `${last} ${MONTHS_TH[m - 1]} ${y + 543}`;
}

/**
 * กดช่อง "Holiday เหลือ" ในการ์ด "วันหยุดของฉัน" (leave-sidebar.tsx) — ได้สิทธิ์มาจากวันหยุดไหน
 * เหลือเท่าไหร่ ใช้ได้ถึงเมื่อไหร่ ใช้ไปแล้ววันไหน และกติกาการนับ · ข้อมูลจาก
 * /api/report-task/hr/holiday-balance?detail=1 (ของตัวเองเท่านั้น)
 */
export function HolidayDetailDialog({
  open,
  onOpenChange,
  month,
  leaveTypeId,
  onBookHoliday,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** เดือนที่ปฏิทินแสดงอยู่ "YYYY-MM" */
  month: string;
  leaveTypeId: string;
  onBookHoliday: () => void;
}) {
  const [detail, setDetail] = useState<HolidayDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/report-task/hr/holiday-balance?month=${month}&detail=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { items?: HolidayDetail[] }) => {
        if (cancelled) return;
        setDetail(data.items?.find((i) => i.leaveTypeId === leaveTypeId) ?? null);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, month, leaveTypeId]);

  const grants = detail?.grants ?? [];
  const used = detail?.used ?? [];
  const granted = grants.reduce((sum, g) => sum + g.grantedDays, 0);
  const usedDays = grants.reduce((sum, g) => sum + (g.grantedDays - g.remainingDays), 0);
  const nextExpiring = grants.find((g) => g.remainingDays > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{detail?.name ?? "Holiday"} ของฉัน</DialogTitle>
          <p className="text-xs text-[var(--ink-soft)]">ณ เดือน{monthLong(month)}</p>
        </DialogHeader>

        {failed ? (
          <p className="text-sm text-[var(--danger)]">โหลดรายละเอียดไม่สำเร็จ ลองปิดแล้วเปิดใหม่</p>
        ) : !detail ? (
          <p className="text-sm text-[var(--ink-soft)]">กำลังโหลด…</p>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="flex flex-wrap items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums">{detail.availableDays}</span>
                <span className="text-sm text-[var(--ink-soft)]">
                  วันที่ลงได้ตอนนี้ · ได้ทั้งหมด {granted} · ใช้ไป {usedDays}
                </span>
              </p>
              {nextExpiring && (
                <p
                  className="mt-2 rounded-lg px-3 py-2 text-xs font-medium"
                  style={{ background: "var(--bg-soft)", color: "var(--tone-warn)" }}
                >
                  {nextExpiring.remainingDays} วันต้องใช้ภายใน {endOfMonthLong(nextExpiring.expiresMonth)} ไม่งั้นถูกตัดทิ้ง
                </p>
              )}
            </div>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-[var(--ink-soft)]">สิทธิ์ที่ได้ (แยกตามเดือน)</h3>
              {grants.length === 0 ? (
                <p className="text-sm text-[var(--ink-soft)]">ช่วง 3 เดือนนี้ไม่มีวันหยุดบริษัท จึงยังไม่มีสิทธิ์</p>
              ) : (
                grants.map((g) => {
                  const usedPart = g.grantedDays - g.remainingDays;
                  return (
                    <div key={g.month} className="space-y-2 rounded-xl border border-[var(--line)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold">
                          {monthLong(g.month)} · ได้ {g.grantedDays} วัน
                        </span>
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={
                            g.remainingDays === 0
                              ? { background: "var(--bg-soft)", color: "var(--ink-soft)" }
                              : { background: "var(--accent)", color: "var(--brand-green-dark)" }
                          }
                        >
                          {g.remainingDays === 0 ? "ใช้หมดแล้ว" : `เหลือ ${g.remainingDays} · ใช้ได้ถึงสิ้น ${monthShort(g.expiresMonth)}`}
                        </span>
                      </div>
                      <div
                        className="flex h-1.5 overflow-hidden rounded-full bg-[var(--bg-soft)]"
                        aria-label={`ใช้ ${usedPart} จาก ${g.grantedDays}`}
                      >
                        <span className="h-full bg-[var(--ink-soft)] opacity-40" style={{ width: `${(usedPart / g.grantedDays) * 100}%` }} />
                        <span className="h-full bg-[var(--brand-green)]" style={{ width: `${(g.remainingDays / g.grantedDays) * 100}%` }} />
                      </div>
                      {g.holidays.length > 0 ? (
                        <ul className="space-y-0.5 text-[13px]">
                          {g.holidays.map((h) => (
                            <li key={h.date} className="flex gap-2">
                              <span className="w-14 shrink-0 tabular-nums text-[var(--ink-soft)]">{dayShort(h.date)}</span>
                              <span className="min-w-0">{h.name}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        // HR กำหนดจำนวนวันของเดือนนี้เอง (ไม่ได้มาจากวันในปฏิทิน)
                        <p className="text-xs text-[var(--ink-soft)]">ฝ่ายบุคคลกำหนดจำนวนวันของเดือนนี้ให้</p>
                      )}
                    </div>
                  );
                })
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-[var(--ink-soft)]">ใช้ไปแล้ว</h3>
              {used.length === 0 ? (
                <p className="text-sm text-[var(--ink-soft)]">ยังไม่ได้ลง {detail.name} ในช่วงนี้</p>
              ) : (
                <ul className="space-y-1.5">
                  {used.map((u) => (
                    <li
                      key={`${u.startsOn}-${u.endsOn}`}
                      className="flex flex-wrap justify-between gap-2 rounded-lg bg-[var(--bg-soft)] px-3 py-2 text-[13px]"
                    >
                      <span>
                        {u.startsOn === u.endsOn ? dayShort(u.startsOn) : `${dayShort(u.startsOn)} – ${dayShort(u.endsOn)}`}{" "}
                        · {u.days} วัน
                      </span>
                      {u.pending && <span className="text-xs" style={{ color: "var(--tone-warn)" }}>รออนุมัติ</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-1">
              <h3 className="text-xs font-semibold text-[var(--ink-soft)]">กติกา</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-xs leading-relaxed text-[var(--ink-soft)]">
                <li>แต่ละเดือนได้ {detail.name} เท่าจำนวนวันหยุดนักขัตฤกษ์ของเดือนนั้น (ตามปฏิทินวันหยุดบริษัท)</li>
                <li>ใช้ได้ภายใน 3 เดือนนับรวมเดือนที่ได้ เช่น ของ ธ.ค. ใช้ได้ถึงสิ้น ก.พ.</li>
                <li>ลงวันหยุดเมื่อไหร่ ระบบหักจากสิทธิ์ที่ใกล้หมดอายุก่อน</li>
                <li>ตัววันหยุดราชการเองเป็นวันทำงานปกติ เลือกหยุดวันอื่นแทน</li>
              </ul>
            </section>

            <Button
              onClick={() => {
                onOpenChange(false);
                onBookHoliday();
              }}
            >
              ลง {detail.name}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
