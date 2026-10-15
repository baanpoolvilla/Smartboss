import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireOrg } from "@smartboss/auth";

import { AppScaffold } from "@/components/module/app-scaffold";
import { bangkokToday, loadMyMonth } from "@/modules/daily_worker/lib/data";
import { hoursLabel, shiftMonth } from "@/modules/daily_worker/lib/types";

export const dynamic = "force-dynamic";

const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const WD = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

const STATUS: Record<string, { text: string; cls: string }> = {
  m: { text: "มา", cls: "bg-(--tone-ok)/12 text-(--tone-ok)" },
  x: { text: "ขาด", cls: "bg-(--tone-danger)/12 text-(--tone-danger)" },
  n: { text: "ไม่มา", cls: "bg-(--bg-soft) text-(--ink-soft)" },
  o: { text: "หยุด", cls: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100" },
  l: { text: "ลา", cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200" },
  r: { text: "หยุดตามกะ", cls: "bg-(--bg-soft) text-(--ink-soft)" },
};

/**
 * "เข้าออกของฉัน" ของคนงาน — ทั้งเดือน วันละการ์ด (มือถือก่อน) · แยกจากหน้าลงเวลา
 * เห็นเฉพาะของตัวเอง · เหตุผลที่ผู้ดูแลแก้ ขาด → มา ไม่แสดง (เห็นแค่ "มา (แก้แล้ว)")
 */
export default async function MyMonthPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await requireOrg();
  const { month: raw } = await searchParams;
  const thisMonth = bangkokToday().slice(0, 7);
  const month = raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) && raw <= thisMonth ? raw : thisMonth;
  const mine = await loadMyMonth(session.orgId, session.userId, month).catch(() => null);
  if (mine === null && month === thisMonth) {
    // ไม่ใช่คนงาน — หน้านี้มีไว้ให้คนงานเท่านั้น
    redirect("/");
  }

  const [y, m] = month.split("-").map(Number) as [number, number];
  const todayDay = mine && mine.today.startsWith(month) ? Number(mine.today.slice(8, 10)) : 32;
  const days = mine
    ? Object.entries(mine.worker.cells)
        .map(([d, c]) => ({ day: Number(d), ...c }))
        .filter((c) => c.day <= todayDay && (c.s !== "" || c.ot))
        .sort((a, b) => b.day - a.day)
    : [];
  const s = mine?.summary;

  return (
    <AppScaffold title="เข้าออกของฉัน" width="max-w-lg">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Link href={`?month=${shiftMonth(month, -1)}`} className="rounded-full border border-(--line) bg-(--bg) p-2.5" aria-label="เดือนก่อน">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1 rounded-full border border-(--line) bg-(--bg) py-2 text-center font-semibold">
            {MONTHS[m - 1]} {y + 543}
          </div>
          {month < thisMonth ? (
            <Link href={`?month=${shiftMonth(month, 1)}`} className="rounded-full border border-(--line) bg-(--bg) p-2.5" aria-label="เดือนถัดไป">
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <span className="rounded-full border border-(--line) p-2.5 opacity-30" aria-hidden>
              <ChevronRight className="h-4 w-4" />
            </span>
          )}
        </div>

        {s && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "มา", value: `${s.present} วัน` },
              { label: "ขาด", value: `${s.absent} วัน` },
              { label: "หยุด", value: `${s.off} วัน` },
              { label: "OT", value: s.otMinutes ? hoursLabel(s.otMinutes) : "0" },
            ].map((t) => (
              <div key={t.label} className="rounded-2xl border border-(--line) bg-(--bg) p-3">
                <p className="text-xs text-(--ink-soft)">{t.label}</p>
                <p className="text-lg font-bold tabular-nums">{t.value}</p>
              </div>
            ))}
          </div>
        )}

        {!mine?.worker.shiftId && mine && <p className="rounded-xl bg-(--tone-warn)/10 p-3 text-sm text-(--tone-warn)">ยังไม่ได้ผูกกะ — แจ้งผู้ดูแล</p>}

        <ul className="flex flex-col gap-2">
          {days.map((c) => {
            const st = STATUS[c.s] ?? { text: "—", cls: "bg-(--bg-soft) text-(--ink-soft)" };
            const wd = WD[new Date(`${month}-${String(c.day).padStart(2, "0")}T12:00:00+07:00`).getUTCDay()];
            return (
              <li key={c.day} className="flex items-center gap-3 rounded-2xl border border-(--line) bg-(--bg) px-4 py-3">
                <div className="w-12 shrink-0 text-center">
                  <p className="text-xs text-(--ink-soft)">{wd}</p>
                  <p className="text-xl font-bold tabular-nums">{c.day}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm tabular-nums">
                    เข้า <b>{c.inAt ?? "--:--"}</b> · ออก <b>{c.outAt ?? "--:--"}</b>
                  </p>
                  <p className="text-xs text-(--ink-soft)">
                    {c.early && <span className="text-(--tone-warn)">กลับก่อนเวลา · </span>}
                    {c.ot && <span className="text-violet-700 dark:text-violet-300">OT {c.ot.start}–{c.ot.end} ({hoursLabel(c.ot.minutes)}) · </span>}
                    {c.leave && c.s !== "o" && c.s !== "l" ? c.leave.name : ""}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${st.cls}`}>{c.override ? "มา (แก้แล้ว)" : st.text}</span>
              </li>
            );
          })}
          {days.length === 0 && <li className="rounded-2xl border border-(--line) bg-(--bg) p-6 text-center text-sm text-(--ink-soft)">ยังไม่มีการลงเวลาในเดือนนี้</li>}
        </ul>
        <p className="text-xs text-(--ink-soft)">เข้าหลังเวลาเข้ากะ = ขาด · ลืมลงเวลาหรือลงไม่ติด แจ้งผู้ดูแลให้แก้ · วันหยุดผู้ดูแลเป็นคนลง</p>
      </div>
    </AppScaffold>
  );
}
