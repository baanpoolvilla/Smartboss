import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireOrg } from "@smartboss/auth";

import { AppScaffold } from "@/components/module/app-scaffold";
import { bangkokToday, loadMyMonth } from "@/modules/daily_worker/lib/data";
import { hoursLabel, type DayCell } from "@/modules/daily_worker/lib/types";

export const dynamic = "force-dynamic";

const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const WD = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."];

const STATUS: Record<string, { text: string; cls: string }> = {
  m: { text: "มา", cls: "bg-(--tone-ok)/12 text-(--tone-ok)" },
  x: { text: "ขาด", cls: "bg-(--tone-danger)/12 text-(--tone-danger)" },
  n: { text: "ไม่มา", cls: "bg-(--bg-soft) text-(--ink-soft)" },
  o: { text: "หยุด", cls: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100" },
  l: { text: "ลา", cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200" },
  r: { text: "หยุดตามกะ", cls: "bg-(--bg-soft) text-(--ink-soft)" },
};

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** วันจันทร์ของสัปดาห์ที่วันนั้นอยู่ */
const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
const label = (date: string) => `${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;

/**
 * "เข้าออกของฉัน" ของคนงาน — ทีละสัปดาห์ (จันทร์–อาทิตย์) วันละการ์ด มือถือก่อน · แยกจากหน้าลงเวลา
 * เห็นเฉพาะของตัวเอง · เหตุผลที่ผู้ดูแลแก้ ขาด → มา ไม่แสดง (เห็นแค่ "มา (แก้แล้ว)")
 */
export default async function MyWeekPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const session = await requireOrg();
  const { week: raw } = await searchParams;
  const today = bangkokToday();
  const thisWeek = mondayOf(today);
  const week = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? mondayOf(raw) : thisWeek;
  const start = week > thisWeek ? thisWeek : week;
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  // สัปดาห์คร่อมสองเดือนได้ — โหลดทุกเดือนที่เกี่ยว
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const loaded = await Promise.all(months.map((m) => loadMyMonth(session.orgId, session.userId, m).catch(() => null)));
  if (loaded.every((x) => x === null)) redirect("/"); // ไม่ใช่คนงาน
  const cellOf = (date: string): DayCell | undefined => {
    const mine = loaded[months.indexOf(date.slice(0, 7))];
    return mine?.worker.cells[Number(date.slice(8, 10))];
  };
  const hasShift = loaded.some((x) => x?.worker.shiftId);

  const shown = dates.filter((d) => d <= today).map((d) => ({ date: d, c: cellOf(d) }));
  const count = (s: string) => shown.filter((x) => x.c?.s === s).length;
  const otMinutes = shown.reduce((sum, x) => sum + (x.c?.ot?.minutes ?? 0), 0);

  return (
    <AppScaffold title="เข้าออกของฉัน" width="max-w-lg">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Link href={`?week=${addDays(start, -7)}`} className="rounded-full border border-(--line) bg-(--bg) p-2.5" aria-label="สัปดาห์ก่อน">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1 rounded-full border border-(--line) bg-(--bg) py-2 text-center text-sm font-semibold">
            {label(dates[0]!)} – {label(dates[6]!)} {Number(dates[6]!.slice(0, 4)) + 543}
            {start === thisWeek && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">สัปดาห์นี้</span>}
          </div>
          {start < thisWeek ? (
            <Link href={`?week=${addDays(start, 7)}`} className="rounded-full border border-(--line) bg-(--bg) p-2.5" aria-label="สัปดาห์ถัดไป">
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <span className="rounded-full border border-(--line) p-2.5 opacity-30" aria-hidden>
              <ChevronRight className="h-4 w-4" />
            </span>
          )}
        </div>

        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "มา", value: count("m") },
            { label: "ขาด", value: count("x") },
            { label: "หยุด", value: count("o") },
            { label: "OT", value: otMinutes ? hoursLabel(otMinutes) : "0" },
          ].map((t) => (
            <div key={t.label} className="rounded-2xl border border-(--line) bg-(--bg) p-2.5 text-center">
              <p className="text-xs text-(--ink-soft)">{t.label}</p>
              <p className="text-base font-bold tabular-nums">{t.value}</p>
            </div>
          ))}
        </div>

        {!hasShift && <p className="rounded-xl bg-(--tone-warn)/10 p-3 text-sm text-(--tone-warn)">ยังไม่ได้ผูกกะ — แจ้งผู้ดูแล</p>}

        <ul className="flex flex-col gap-2">
          {dates.map((date, i) => {
            const c = cellOf(date);
            const future = date > today;
            const st = c?.s ? STATUS[c.s] : undefined;
            return (
              <li
                key={date}
                className={`flex items-center gap-3 rounded-2xl border bg-(--bg) px-4 py-3 ${date === today ? "border-amber-400" : "border-(--line)"} ${future ? "opacity-50" : ""}`}
              >
                <div className="w-11 shrink-0 text-center">
                  <p className="text-xs text-(--ink-soft)">{WD[i]}</p>
                  <p className="text-xl font-bold tabular-nums">{Number(date.slice(8))}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm tabular-nums">
                    เข้า <b>{c?.inAt ?? "--:--"}</b> · ออก <b>{c?.outAt ?? "--:--"}</b>
                  </p>
                  <p className="text-xs text-(--ink-soft)">
                    {date === today && "วันนี้ · "}
                    {c?.early && <span className="text-(--tone-warn)">กลับก่อนเวลา · </span>}
                    {c?.ot && <span className="text-violet-700 dark:text-violet-300">OT {c.ot.start}–{c.ot.end} ({hoursLabel(c.ot.minutes)})</span>}
                  </p>
                </div>
                {st ? (
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${st.cls}`}>{c?.override ? "มา (แก้แล้ว)" : st.text}</span>
                ) : (
                  <span className="shrink-0 text-xs text-(--ink-soft)">{future ? "" : "—"}</span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-(--ink-soft)">เข้าหลังเวลาเข้ากะ = ขาด · ลืมลงเวลาหรือลงไม่ติด แจ้งผู้ดูแลให้แก้ · วันหยุดผู้ดูแลเป็นคนลง</p>
      </div>
    </AppScaffold>
  );
}
