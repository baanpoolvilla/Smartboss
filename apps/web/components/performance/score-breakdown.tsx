import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { eventDay, isReversalEvent, PERFORMANCE_CATEGORIES, type PerformanceCategory } from "@/lib/performance";
import type { EventDetail } from "@/lib/performance-details";
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
  userId: string;
  category: string;
  occurredAt: Date;
  points: unknown;
  note: string | null;
  refType: string | null;
  refId: string | null;
  createdBy?: string | null;
}

/** จับคู่รายการที่ถูกยกเลิก ↔ รายการยกเลิกของมัน — กติกาเดียวกับ reversedChecker ใน lib/performance
 * (หมวดต้องตรงกันด้วย: รอบรายงานเดียวกันมีทั้ง "ไม่ส่ง" และ "ส่งสาย" ใต้ refId เดียวกัน) */
function pairReversals(events: BreakdownEvent[]) {
  const reversalByKey = new Map<string, BreakdownEvent>();
  for (const e of events) {
    if (!e.refType || !e.refId || !isReversalEvent(e)) continue;
    const key = e.refType.endsWith("_undo")
      ? `${e.category}|${e.refType.slice(0, -"_undo".length)}|${e.refId}`
      : `${e.category}|id|${e.refId}`;
    reversalByKey.set(key, e);
  }
  const reversalOf = new Map<string, BreakdownEvent>();
  const matched = new Set<string>();
  for (const e of events) {
    if (isReversalEvent(e)) continue;
    const r =
      reversalByKey.get(`${e.category}|id|${e.id}`) ??
      (e.refType && e.refId ? reversalByKey.get(`${e.category}|${e.refType}|${e.refId}`) : undefined);
    if (r) {
      reversalOf.set(e.id, r);
      matched.add(r.id);
    }
  }
  return { reversalOf, matched };
}

function signed(points: number): string {
  return points > 0 ? `+${points}` : String(points);
}

function pointsColor(points: number): string {
  return points < 0 ? "var(--danger)" : "var(--tone-ok)";
}

/** มีของให้ดูใน allRows ไหม — หน้าที่เรียกใช้ตัดสินใจขึ้น "ไม่มีเลย — คะแนนเต็ม" แทน */
export function hasBreakdown(rows: BreakdownRow[], events: BreakdownEvent[]): boolean {
  return rows.length > 0 || pairReversals(events).reversalOf.size > 0;
}

export function ScoreBreakdown({
  rows,
  events,
  attendanceHref,
  details,
}: {
  rows: BreakdownRow[];
  events: BreakdownEvent[];
  /** "หักจากอะไร" ของแต่ละรายการ (lib/performance-details.ts) — มี = กดรายการแล้วกางดูได้ */
  details?: Map<string, EventDetail>;
  /** ลิงก์ "ดูวันนั้น" ของเหตุการณ์ลงเวลา — ไม่ส่ง = ไม่มีลิงก์ (คนที่ไม่มีสิทธิ์ดูหน้าลงเวลารวม) */
  attendanceHref?: (workDate: string) => string;
}) {
  const { reversalOf, matched } = pairReversals(events);
  // คืนคะแนนไปแล้วกี่ครั้งต่อหมวด — หมวดที่ถูกคืนหมด (0 ครั้ง 0 คะแนน) ยังต้องโชว์ ไม่งั้นยื่นคำร้องแล้ว
  // ได้คืน หน้านี้กลับว่างเปล่าเหมือนไม่เคยเกิดอะไร ("คืนคะแนนแล้วหน้านี้ยังไม่ขึ้นว่ามีการแก้ไข")
  const restoredByCategory = new Map<string, number>();
  for (const e of events) {
    if (reversalOf.has(e.id)) restoredByCategory.set(e.category, (restoredByCategory.get(e.category) ?? 0) + 1);
  }
  const allRows: BreakdownRow[] = [
    ...rows,
    ...[...restoredByCategory.keys()]
      .filter((c) => !rows.some((r) => r.category === c))
      .map((c) => ({ category: c, label: PERFORMANCE_CATEGORIES[c as PerformanceCategory] ?? c, points: 0, count: 0 })),
  ];
  const byCategory = new Map<string, BreakdownEvent[]>();
  // รายการยกเลิกที่จับคู่กับของเดิมได้ ไม่ต้องขึ้นแยกบรรทัด — ของเดิมจะขีดฆ่าแทน
  for (const ev of events.filter((e) => !matched.has(e.id))) {
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
      {allRows.map((row) => {
        const list = [...(byCategory.get(row.category) ?? [])].sort(
          (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
        );
        return (
          <details key={row.category} className="group border-b border-(--line) last:border-b-0">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm text-(--ink) hover:bg-(--bg-soft) [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-4 w-4 shrink-0 text-(--ink-soft) transition-transform group-open:rotate-90" />
              <span className="min-w-0 flex-1">
                {row.label}
                {restoredByCategory.get(row.category) ? (
                  <span className="ml-2 rounded-full bg-(--tone-ok)/10 px-2 py-0.5 text-[11px] font-semibold text-(--tone-ok)">
                    คืนคะแนนแล้ว {restoredByCategory.get(row.category)} ครั้ง
                  </span>
                ) : null}
              </span>
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
                const reversal = reversalOf.get(ev.id);
                const href =
                  ev.refType === "work_order" && ev.refId
                    ? `/maintenance/work-orders/${ev.refId}`
                    : ev.refType?.startsWith("attendance_day") && attendanceHref
                      ? attendanceHref(workDate)
                      : null;
                const detail = details?.get(ev.id);
                const line = (
                  <>
                    <span className="w-24 shrink-0 text-(--ink-soft)">{formatDate(workDate)}</span>
                    <span className="min-w-0 flex-1 text-(--ink)">
                      <span className={reversal ? "text-(--ink-soft) line-through" : undefined}>
                        {ev.note || (points > 0 ? "คืนคะแนน" : row.label)}
                      </span>
                      {reversal && (
                        <span className="mt-0.5 block text-xs font-medium text-(--tone-ok)">
                          คืนคะแนนแล้ว · ไม่นับ{reversal.note ? ` — ${reversal.note}` : ""}
                        </span>
                      )}
                      {href && (
                        <Link href={href} className="ml-2 text-xs text-(--app-strong,var(--ink)) hover:underline">
                          ดู →
                        </Link>
                      )}
                    </span>
                    <span
                      className="w-14 shrink-0 text-right font-medium"
                      style={{ color: reversal ? "var(--ink-soft)" : pointsColor(points) }}
                    >
                      {reversal ? "0" : signed(points)}
                    </span>
                  </>
                );
                if (!detail) {
                  return (
                    <li key={ev.id} className="flex items-start gap-3 px-4 py-2 pl-11 text-sm">
                      {line}
                    </li>
                  );
                }
                // กดรายการ → เห็นว่าหักจากอะไร (เวลาสแกนจริง / ห้องและรอบ / ใครหัก)
                return (
                  <li key={ev.id}>
                    <details className="group/ev">
                      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-2 pl-11 text-sm hover:bg-(--bg-soft) [&::-webkit-details-marker]:hidden">
                        {line}
                      </summary>
                      <div className="mb-1 ml-11 mr-4 flex flex-col gap-0.5 rounded-lg border border-(--line) bg-white px-3 py-2 text-xs text-(--ink-soft)">
                        {detail.lines.map((l, i) => (
                          <span key={i}>{l}</span>
                        ))}
                        {detail.href && (
                          <Link href={detail.href} className="mt-0.5 font-medium text-(--app-strong,var(--ink)) hover:underline">
                            {detail.hrefLabel ?? "ดู →"}
                          </Link>
                        )}
                      </div>
                    </details>
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
