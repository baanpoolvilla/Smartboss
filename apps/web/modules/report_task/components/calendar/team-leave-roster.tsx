"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Table2 } from "lucide-react";
import { useIsMobile } from "@/modules/report_task/hooks/use-is-mobile";
import { getUser } from "@/modules/report_task/lib/directory";
import { cn } from "@/modules/report_task/lib/utils";
import type { CalendarEvent } from "@/modules/report_task/types";

const OPEN_KEY = "sb.calendar.leaveRoster.open";
const DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** วันที่ต้องแสดง: มุมมองเดือน (ช่วงของ FullCalendar กินเผื่อสัปดาห์ก่อน/หลัง) = ทั้งเดือนของกลางช่วง · สัปดาห์/วัน = ตามช่วง */
function daysOf(range: { start: Date; end: Date }): Date[] {
  const span = (range.end.getTime() - range.start.getTime()) / 86_400_000;
  if (span > 20) {
    const mid = new Date((range.start.getTime() + range.end.getTime()) / 2);
    const last = new Date(mid.getFullYear(), mid.getMonth() + 1, 0).getDate();
    return Array.from({ length: last }, (_, i) => new Date(mid.getFullYear(), mid.getMonth(), i + 1));
  }
  const out: Date[] = [];
  for (const d = new Date(range.start); d < range.end && out.length < 42; d.setDate(d.getDate() + 1)) out.push(new Date(d));
  return out;
}

/** ตัวอักษรในช่อง — Day-Off = D · Holiday (สิทธิ์สะสม) = H · ลาอื่น ๆ = ล */
function codeOf(e: CalendarEvent): string {
  if (e.type === "dayoff") return "D";
  const name = (e.typeName ?? e.leaveType ?? "").toLowerCase();
  return name.includes("holiday") ? "H" : "ล";
}

/**
 * ตารางวันหยุด · ลาของทีม (คน × วัน แบบตารางเวร) — ใต้ปฏิทินเดือน เฉพาะมุมมอง "ทั้งหมด" ที่ติ๊ก "วันหยุด · ลา"
 * ("แบบนี้น่าสนใจ แต่ให้ขึ้นตอนติ๊กวันหยุดลา และมีหัวข้อ ไม่งั้นรก") · พับเก็บได้ จำไว้ในเครื่อง
 * ใช้รายการเดียวกับที่ปฏิทินแสดงอยู่ (กรองประเภทจากเมนู ▾ และคนที่ซ่อนไว้แล้ว) — แทนรายการ 80 แถวเดิม
 * วันหยุดบริษัทตามปฏิทินไม่ใช่วันหยุดของใคร: ไม่นับ แค่ระบายหัวคอลัมน์ให้รู้
 */
export function TeamLeaveRoster({ events, range }: { events: CalendarEvent[]; range: { start: Date; end: Date } }) {
  // อ่านค่าที่จำไว้หลัง mount — อ่านตอน render แรกจะไม่ตรงกับหน้าที่เซิร์ฟเวอร์ทำมา
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(OPEN_KEY) === "0") setOpen(false);
    } catch {
      /* โหมดส่วนตัว */
    }
  }, []);
  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      /* โหมดส่วนตัว — แค่ไม่จำ */
    }
  }

  const days = useMemo(() => daysOf(range), [range]);
  const { rows, publicDays, perDay, total } = useMemo(() => {
    const keys = days.map(ymd);
    const index = new Map(keys.map((k, i) => [k, i]));
    const publicDays = new Map<number, string>();
    const byUser = new Map<string, Map<number, CalendarEvent>>();
    for (const e of events) {
      if (e.type === "ot") continue;
      const s = e.start.slice(0, 10);
      // all-day: end ไม่รวมวันนั้น · ไม่มี end = วันเดียว
      const endExclusive = e.end ? e.end.slice(0, 10) : null;
      const cover: number[] = [];
      for (const [k, i] of index) if (k >= s && (endExclusive ? k < endExclusive : k === s)) cover.push(i);
      if (cover.length === 0) continue;
      if (e.type === "holiday" && !e.userId) {
        for (const i of cover) publicDays.set(i, e.title);
        continue;
      }
      if (!e.userId) continue;
      const m = byUser.get(e.userId) ?? new Map<number, CalendarEvent>();
      for (const i of cover) if (!m.has(i)) m.set(i, e);
      byUser.set(e.userId, m);
    }
    const rows = [...byUser.entries()]
      .map(([userId, cells]) => ({ userId, user: getUser(userId), cells }))
      .sort((a, b) => (a.user?.name ?? "").localeCompare(b.user?.name ?? "", "th"));
    const perDay = keys.map((_, i) => rows.filter((r) => r.cells.has(i)).length);
    const total = rows.reduce((n, r) => n + r.cells.size, 0);
    return { rows, publicDays, perDay, total };
  }, [events, days]);

  const busy = Math.max(2, Math.ceil(rows.length / 2));
  const today = ymd(new Date());

  // มือถือ: ทีละสัปดาห์ (อา–ส, 7 ช่องพอดีจอ) มีปุ่ม ‹ › แทนการปัดตารางทั้งเดือน · คอม: ทั้งเดือนเหมือนเดิม
  const isMobile = useIsMobile();
  const weeks = useMemo(() => {
    const out: number[][] = [];
    days.forEach((d, i) => {
      if (i === 0 || d.getDay() === 0) out.push([]);
      out[out.length - 1]!.push(i);
    });
    return out;
  }, [days]);
  const todayWeek = Math.max(0, weeks.findIndex((w) => w.some((i) => ymd(days[i]!) === today)));
  // จำสัปดาห์ที่เลือกแยกตามเดือน — เปลี่ยนเดือนแล้วเริ่มที่สัปดาห์ของวันนี้ (หรือสัปดาห์แรก)
  const monthKey = days[0] ? ymd(days[0]) : "";
  const [picked, setPicked] = useState<{ key: string; week: number } | null>(null);
  const week = picked?.key === monthKey ? Math.min(picked.week, weeks.length - 1) : todayWeek;
  const visible = isMobile ? (weeks[week] ?? []) : days.map((_, i) => i);
  const weekLabel = (() => {
    const w = weeks[week];
    if (!w?.length) return "";
    const a = days[w[0]!]!;
    const b = days[w[w.length - 1]!]!;
    const month = b.toLocaleDateString("th-TH", { month: "short" });
    return `${a.getDate()}–${b.getDate()} ${month}`;
  })();

  // มือถือเห็นได้ไม่กี่วันต่อจอ — เปิดมาให้เลื่อนไปที่วันนี้เอง (เว้นวันก่อนหน้าไว้นิดหน่อย) ไม่ต้องปัดหา
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayIndex = days.findIndex((d) => ymd(d) === today);
  useEffect(() => {
    const el = scrollRef.current;
    if (!open || !el || todayIndex < 0) return;
    const cell = el.querySelector<HTMLElement>(`[data-day="${todayIndex}"]`);
    const nameCol = el.querySelector<HTMLElement>("th");
    if (cell && cell.offsetLeft + cell.offsetWidth > el.clientWidth) {
      el.scrollLeft = Math.max(0, cell.offsetLeft - (nameCol?.offsetWidth ?? 0) - cell.offsetWidth * 2);
    }
  }, [open, todayIndex, rows.length]);

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--bg)]">
      <button type="button" onClick={toggle} className="flex w-full items-center gap-2 px-4 py-3 text-left" aria-expanded={open}>
        <Table2 className="h-4 w-4 text-[var(--ink-soft)]" />
        <span className="text-base font-semibold">ตารางวันหยุด · ลาของทีม</span>
        <span className="rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-xs text-[var(--ink-soft)]">
          {rows.length} คน · {total} วัน
        </span>
        <span className="ml-auto flex items-center gap-1 text-xs text-[var(--ink-soft)]">
          {open ? "ซ่อน" : "แสดง"}
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--line)] px-4 pb-4 pt-3">
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--ink-soft)]">
            <span><b className="mr-1 inline-block h-3 w-3 rounded bg-[#22a06b] align-[-1px]" />D = Day-Off</span>
            <span><b className="mr-1 inline-block h-3 w-3 rounded bg-[#3b6fd8] align-[-1px]" />H = Holiday</span>
            <span><b className="mr-1 inline-block h-3 w-3 rounded bg-[#d97706] align-[-1px]" />ล = ลาอื่น ๆ</span>
            <span className="hidden sm:inline">หัวคอลัมน์สีน้ำเงิน = วันหยุดตามปฏิทิน · ตัวเลขสีส้มแถวล่าง = วันที่หยุดตั้งแต่ครึ่งทีม</span>
          </div>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--ink-soft)]">ช่วงนี้ไม่มีใครลงวันหยุดหรือลา</p>
          ) : (
            <>
            {isMobile && (
              <div className="mb-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setPicked({ key: monthKey, week: Math.max(0, week - 1) })}
                  disabled={week === 0}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] disabled:opacity-30"
                  aria-label="สัปดาห์ก่อน"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-medium">
                  {weekLabel}
                  {week === todayWeek && todayWeek >= 0 && weeks[week]?.some((i) => ymd(days[i]!) === today) && (
                    <span className="ml-1.5 rounded-full bg-[var(--brand-green)]/15 px-2 py-0.5 text-[10px] text-[var(--brand-green-dark)]">สัปดาห์นี้</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setPicked({ key: monthKey, week: Math.min(weeks.length - 1, week + 1) })}
                  disabled={week >= weeks.length - 1}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] disabled:opacity-30"
                  aria-label="สัปดาห์ถัดไป"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
            <div ref={scrollRef} className="overflow-x-auto overscroll-x-contain rounded-lg border border-[var(--line)]">
              {/* มือถือ: table-fixed ให้ 7 วันกว้างเท่ากัน — ตารางแบบปกติให้ช่องที่มีของกว้างกว่า วันที่ไม่มีใครหยุดถูกบีบ */}
              <table className="w-full border-collapse text-[11px] max-sm:table-fixed">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 min-w-[92px] border-b border-r max-sm:w-[92px] sm:min-w-[150px] border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-left font-medium text-[var(--ink-soft)]">
                      พนักงาน
                    </th>
                    {visible.map((i) => {
                      const d = days[i]!;
                      const we = d.getDay() === 0 || d.getDay() === 6;
                      const ph = publicDays.get(i);
                      return (
                        <th
                          key={i}
                          data-day={i}
                          title={ph}
                          className={cn(
                            "min-w-[24px] border-b border-[var(--line)] px-0.5 py-1 text-center font-normal leading-tight",
                            we && "bg-[var(--bg-soft)]",
                            ph ? "font-bold text-[#3b6fd8]" : "text-[var(--ink-soft)]",
                            ymd(d) === today && "bg-[var(--brand-green)]/10"
                          )}
                        >
                          {DOW[d.getDay()]}
                          <br />
                          {d.getDate()}
                        </th>
                      );
                    })}
                    <th className="hidden border-b border-l border-[var(--line)] px-2 py-1 text-center font-medium text-[var(--ink-soft)] sm:table-cell">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.userId}>
                      <td
                        className="sticky left-0 z-10 max-w-[92px] truncate whitespace-nowrap border-b border-r border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-xs sm:max-w-none"
                        title={r.user?.name}
                      >
                        {r.user?.name ?? "—"}
                        {/* มือถือไม่มีคอลัมน์รวม — บอกยอดทั้งเดือนใต้ชื่อแทน */}
                        <span className="block text-[10px] text-[var(--ink-soft)] sm:hidden">เดือนนี้ {r.cells.size} วัน</span>
                      </td>
                      {visible.map((i) => {
                        const d = days[i]!;
                        const e = r.cells.get(i);
                        const we = d.getDay() === 0 || d.getDay() === 6;
                        return (
                          <td key={i} className={cn("border-b border-[var(--line)] p-0.5 text-center", we && "bg-[var(--bg-soft)]")}>
                            {e && (
                              <span
                                title={`${r.user?.name ?? ""} · ${e.typeName ?? e.title}`}
                                className="mx-auto block h-6 w-6 rounded text-[11px] font-bold leading-6 text-white sm:h-[18px] sm:w-[18px] sm:text-[9.5px] sm:leading-[18px]"
                                style={{ backgroundColor: e.colorHint ?? "#22a06b" }}
                              >
                                {codeOf(e)}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="hidden border-b border-l border-[var(--line)] px-2 text-center text-xs font-semibold tabular-nums sm:table-cell">
                        {r.cells.size} วัน
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="sticky left-0 z-10 border-r border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--ink-soft)]">
                      หยุดกี่คน
                    </td>
                    {visible.map((i) => perDay[i]!).map((n, i) => (
                      <td
                        key={i}
                        className={cn(
                          "py-1 text-center tabular-nums",
                          n >= busy ? "bg-[#fff4e0] font-bold text-[#b45309]" : "text-[var(--ink-soft)]"
                        )}
                      >
                        {n || ""}
                      </td>
                    ))}
                    <td className="hidden sm:table-cell" />
                  </tr>
                </tfoot>
              </table>
            </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
