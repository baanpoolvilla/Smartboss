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

/**
 * ชื่อย่อสำหรับมือถือ — ชื่อในระบบเป็นแบบ "ชื่อเล่น-แผนก-ชื่อจริง" ตัดส่วนสุดท้ายออก ("กาย-IT-Pacharapol" → "กาย-IT",
 * "ko-Surin" → "ko") ให้คอลัมน์ชื่อไม่กินที่ ("ชื่อเอาให้ไม่กินสเกลมาก") · ชื่อไม่มีขีด = ใช้ทั้งชื่อ
 */
function shortName(name: string): string {
  const parts = name.split("-").filter(Boolean);
  return parts.length >= 2 ? parts.slice(0, -1).join("-") : name;
}

/** ชื่อประเภทของรายการ (ใช้ทำป้ายอธิบาย + ตัวอักษรในช่อง) */
function typeLabelOf(e: CalendarEvent): string {
  if (e.type === "dayoff") return e.typeName ?? "Day-Off";
  return e.typeName ?? e.leaveType ?? "ลา";
}

/**
 * ตัวอักษรในช่อง — Day-Off = D · Holiday = H · ลาประเภทอื่นใช้ตัวแรกหลังคำว่า "ลา" (ลาป่วย → ป, ลากิจ → ก,
 * ลาพักร้อน → พ) ให้แยกกันออก (เดิมทุกประเภทเป็น "ล" เหมือนกันหมด) · สีมาจากประเภทเหมือนบนปฏิทิน
 */
function codeOf(e: CalendarEvent): string {
  if (e.type === "dayoff") return "D";
  const name = typeLabelOf(e).trim();
  if (name.toLowerCase().includes("holiday")) return "H";
  const rest = name.replace(/^ลา\s*/, "");
  // ข้ามสระนำหน้า (เ แ โ ใ ไ) ใช้พยัญชนะตัวแรก — "ลาเพื่อ…" ได้ "พ" ไม่ใช่ "เ"
  return (rest || name).replace(/^[เแโใไ]+/, "").charAt(0).toUpperCase() || "ล";
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
  const { rows, publicDays, perDay, total, legend } = useMemo(() => {
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
    const sorted = [...byUser.entries()]
      .map(([userId, cells]) => ({ userId, user: getUser(userId), cells }))
      .sort((a, b) => (a.user?.name ?? "").localeCompare(b.user?.name ?? "", "th"));
    // ชื่อย่อซ้ำกัน (สองคนชื่อเล่นเดียวกันแผนกเดียวกัน) = ใช้ชื่อเต็มของคนเหล่านั้น จะได้แยกออก
    const shortCount = new Map<string, number>();
    for (const r of sorted) {
      const k = shortName(r.user?.name ?? "");
      shortCount.set(k, (shortCount.get(k) ?? 0) + 1);
    }
    const rows = sorted.map((r) => {
      const full = r.user?.name ?? "—";
      const k = shortName(full);
      return { ...r, short: (shortCount.get(k) ?? 0) > 1 ? full : k };
    });
    const perDay = keys.map((_, i) => rows.filter((r) => r.cells.has(i)).length);
    const total = rows.reduce((n, r) => n + r.cells.size, 0);
    // ป้ายอธิบาย: เฉพาะประเภทที่มีอยู่จริงในตารางนี้ เรียงจากเจอบ่อยไปน้อย
    const legendMap = new Map<string, { label: string; code: string; color: string; count: number }>();
    for (const r of rows) {
      for (const e of r.cells.values()) {
        const label = typeLabelOf(e);
        const cur = legendMap.get(label) ?? { label, code: codeOf(e), color: e.colorHint ?? "#22a06b", count: 0 };
        cur.count += 1;
        legendMap.set(label, cur);
      }
    }
    const legend = [...legendMap.values()].sort((a, b) => b.count - a.count);
    return { rows, publicDays, perDay, total, legend };
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
          {/* ป้ายอธิบายจากประเภทที่มีจริง — มือถือ: บรรทัดเดียว เลื่อนซ้าย-ขวาถ้าเยอะ · คอม: ขึ้นบรรทัดใหม่ได้ */}
          <div className="mb-2 flex gap-x-3 gap-y-1 overflow-x-auto whitespace-nowrap pb-0.5 text-[11px] text-[var(--ink-soft)] [scrollbar-width:none] sm:flex-wrap sm:whitespace-normal">
            {legend.map((l) => (
              <span key={l.label} className="inline-flex shrink-0 items-center gap-1">
                <b className="inline-block h-4 w-4 rounded text-center text-[9px] leading-4 text-white" style={{ backgroundColor: l.color }}>
                  {l.code}
                </b>
                {l.label}
              </span>
            ))}
            <span className="hidden shrink-0 sm:inline">· หัวคอลัมน์สีน้ำเงิน = วันหยุดตามปฏิทิน · ตัวเลขสีส้มแถวล่าง = วันที่หยุดตั้งแต่ครึ่งทีม</span>
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
            <div
              ref={scrollRef}
              // คนเยอะ: สูงคงที่ เลื่อนขึ้นลงในตาราง (หัววัน + แถว "หยุดกี่คน" ค้างไว้) ไม่ยืดยาวลงไปทั้งหน้า
              className="max-h-[60vh] overflow-auto overscroll-contain rounded-lg border border-[var(--line)] sm:max-h-[440px]"
            >
              {/* มือถือ: table-fixed ให้ 7 วันกว้างเท่ากัน — ตารางแบบปกติให้ช่องที่มีของกว้างกว่า วันที่ไม่มีใครหยุดถูกบีบ */}
              <table className="w-full border-collapse text-[11px] max-sm:table-fixed">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-20 border-b border-r max-sm:w-[72px] sm:min-w-[150px] border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-left font-medium text-[var(--ink-soft)]">
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
                            "sticky top-0 z-[5] min-w-[24px] border-b border-[var(--line)] bg-[var(--bg)] px-0.5 py-1 text-center font-normal leading-tight",
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
                    <th className="sticky top-0 z-[5] hidden border-b border-l border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-center font-medium text-[var(--ink-soft)] sm:table-cell">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.userId}>
                      <td
                        className="sticky left-0 z-10 max-w-[72px] whitespace-nowrap border-b border-r border-[var(--line)] bg-[var(--bg)] px-1.5 py-1 text-xs sm:max-w-none sm:px-2"
                        title={r.user?.name}
                      >
                        {/* มือถือ: ชื่อย่อบรรทัดเดียว + ยอดทั้งเดือนเป็นเลขเล็กต่อท้าย (ไม่มีคอลัมน์รวม) · คอม: ชื่อเต็ม */}
                        <span className="flex items-center gap-1 sm:hidden">
                          <span className="min-w-0 truncate">{r.short}</span>
                          <span className="shrink-0 text-[10px] tabular-nums text-[var(--ink-soft)]">{r.cells.size}</span>
                        </span>
                        <span className="hidden sm:inline">{r.user?.name ?? "—"}</span>
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
                    <td className="sticky bottom-0 left-0 z-20 border-r border-t border-[var(--line)] bg-[var(--bg)] px-1.5 py-1 text-xs text-[var(--ink-soft)] sm:px-2">
                      <span className="sm:hidden">หยุด</span>
                      <span className="hidden sm:inline">หยุดกี่คน</span>
                    </td>
                    {visible.map((i) => perDay[i]!).map((n, i) => (
                      <td
                        key={i}
                        className={cn(
                          "sticky bottom-0 z-[5] border-t border-[var(--line)] bg-[var(--bg)] py-1 text-center tabular-nums",
                          n >= busy ? "bg-[#fff4e0] font-bold text-[#b45309]" : "text-[var(--ink-soft)]"
                        )}
                      >
                        {n || ""}
                      </td>
                    ))}
                    <td className="sticky bottom-0 z-[5] hidden border-t border-[var(--line)] bg-[var(--bg)] sm:table-cell" />
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
