import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { eventDay } from "@/lib/performance";
import { formatDate } from "@/modules/hr/lib/labels";

/**
 * "เสียคะแนนเพราะ" แบบกดขยายได้ — กดหมวดไหนเห็นทุกครั้งที่โดนในหมวดนั้น วันไหน เพราะอะไร
 *
 * เดิมเห็นแค่ยอดรวม ("ใบงานเกินกำหนด 12 ครั้ง -36") ซึ่งทั้งหัวหน้าและตัวพนักงานเอง
 * ตอบไม่ได้ว่าโดนวันไหนบ้าง ใช้ทั้งหน้าพนักงาน (HR) และหน้า "คะแนนของฉัน"
 *
 * ใช้ <details> ล้วน ไม่ต้องมี JS — `events` ต้องเป็นช่วงเดียวกับที่คิด `rows`
 * (เดือนเดียวกัน) ไม่งั้นจำนวนในหัวแถวกับรายการข้างในจะไม่ตรงกัน
 */

export interface BreakdownRow {
  category: string;
  label: string;
  points: number;
  count: number;
}

export interface BreakdownEvent {
  id: string;
  category: string;
  occurredAt: Date;
  points: unknown;
  note: string | null;
  refType: string | null;
  refId: string | null;
}

function signed(points: number): string {
  return points > 0 ? `+${points}` : String(points);
}

function pointsColor(points: number): string {
  return points < 0 ? "var(--danger)" : "var(--tone-ok)";
}

export function ScoreBreakdown({
  rows,
  events,
  attendanceHref,
}: {
  rows: BreakdownRow[];
  events: BreakdownEvent[];
  /** ลิงก์ "ดูวันนั้น" ของเหตุการณ์ลงเวลา — ไม่ส่ง = ไม่มีลิงก์ (คนที่ไม่มีสิทธิ์ดูหน้าลงเวลารวม) */
  attendanceHref?: (workDate: string) => string;
}) {
  const byCategory = new Map<string, BreakdownEvent[]>();
  for (const ev of events) {
    const list = byCategory.get(ev.category) ?? [];
    list.push(ev);
    byCategory.set(ev.category, list);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-(--line)">
      <div className="flex items-center gap-3 border-b border-(--line) bg-(--bg-soft) px-4 py-2.5 text-xs font-semibold text-(--ink-soft)">
        <span className="flex-1">เสียคะแนนเพราะ · กดดูว่าวันไหน</span>
        <span className="w-16 text-right">ครั้ง</span>
        <span className="w-14 text-right">คะแนน</span>
      </div>
      {rows.map((row) => {
        const list = [...(byCategory.get(row.category) ?? [])].sort(
          (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
        );
        return (
          <details key={row.category} className="group border-b border-(--line) last:border-b-0">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm text-(--ink) hover:bg-(--bg-soft) [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-4 w-4 shrink-0 text-(--ink-soft) transition-transform group-open:rotate-90" />
              <span className="min-w-0 flex-1">{row.label}</span>
              <span className="w-16 text-right">{row.count}</span>
              <span className="w-14 text-right font-medium" style={{ color: pointsColor(row.points) }}>
                {signed(row.points)}
              </span>
            </summary>
            <ul className="bg-(--bg-soft)/60 pb-1">
              {list.length === 0 && (
                <li className="px-4 py-2 pl-11 text-xs text-(--ink-soft)">ไม่พบรายการ</li>
              )}
              {list.map((ev) => {
                const points = Number(ev.points);
                const workDate = eventDay(ev.occurredAt);
                const href =
                  ev.refType === "work_order" && ev.refId
                    ? `/maintenance/work-orders/${ev.refId}`
                    : ev.refType?.startsWith("attendance_day") && attendanceHref
                      ? attendanceHref(workDate)
                      : null;
                return (
                  <li key={ev.id} className="flex items-start gap-3 px-4 py-2 pl-11 text-sm">
                    <span className="w-24 shrink-0 text-(--ink-soft)">{formatDate(workDate)}</span>
                    <span className="min-w-0 flex-1 text-(--ink)">
                      {ev.note || (points > 0 ? "คืนคะแนน" : "—")}
                      {href && (
                        <Link href={href} className="ml-2 text-xs text-(--app-strong,var(--ink)) hover:underline">
                          ดู →
                        </Link>
                      )}
                    </span>
                    <span className="w-14 shrink-0 text-right font-medium" style={{ color: pointsColor(points) }}>
                      {signed(points)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
