"use client";

import { useEffect, useState } from "react";

const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

interface MyMonth {
  worker: boolean;
  month?: string;
  summary?: { present: number; absent: number; early: number; noShow: number; off: number; ot: string };
  nextOff?: number | null;
  recent?: { day: number; text: string; tone: "bad" | "mute" | "ot" | "warn" }[];
  hasShift?: boolean;
}

const TONE: Record<string, string> = {
  bad: "bg-(--tone-danger)/12 text-(--tone-danger)",
  mute: "bg-(--bg-soft) text-(--ink-soft)",
  ot: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200",
  warn: "bg-(--tone-warn)/12 text-(--tone-warn)",
};

/** "เดือนนี้ของฉัน" — ขึ้นเฉพาะคนงาน (บทบาท WORKER) · คนอื่นไม่เห็นอะไร */
export function MyMonthCard() {
  const [data, setData] = useState<MyMonth | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/m/my-month", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: MyMonth | null) => {
        if (alive) setData(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!data?.worker || !data.summary || !data.month) return null;
  const m = MONTHS[Number(data.month.slice(5, 7)) - 1];
  const s = data.summary;
  return (
    <section className="rounded-2xl border border-(--line) p-4">
      <h2 className="font-semibold">เดือนนี้ของฉัน · {m}</h2>
      {!data.hasShift && <p className="mt-1 text-xs text-(--tone-warn)">ยังไม่ได้ผูกกะ — แจ้งผู้ดูแล</p>}
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl border border-(--line) p-2"><p className="text-xs text-(--ink-soft)">มา</p><b className="tabular-nums">{s.present} วัน</b></div>
        <div className="rounded-xl border border-(--line) p-2"><p className="text-xs text-(--ink-soft)">ขาด</p><b className="tabular-nums">{s.absent} วัน</b></div>
        <div className="rounded-xl border border-(--line) p-2"><p className="text-xs text-(--ink-soft)">OT</p><b className="tabular-nums">{s.ot}</b></div>
        <div className="rounded-xl border border-(--line) p-2"><p className="text-xs text-(--ink-soft)">วันหยุดถัดไป</p><b className="tabular-nums">{data.nextOff ? `${data.nextOff} ${m}` : "—"}</b></div>
      </div>
      {data.recent && data.recent.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5 text-sm">
          {data.recent.map((r) => (
            <li key={r.day} className="flex items-center justify-between gap-2 border-b border-(--line) pb-1.5">
              <span>{r.day} {m}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[r.tone]}`}>{r.text}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-(--ink-soft)">เข้าหลังเวลาเข้ากะ = ขาด · ลงวันหยุดให้ผู้ดูแลเป็นคนลง</p>
    </section>
  );
}
