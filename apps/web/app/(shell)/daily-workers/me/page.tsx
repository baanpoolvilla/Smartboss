import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireOrg } from "@smartboss/auth";

import { AppScaffold } from "@/components/module/app-scaffold";
import { bangkokToday, loadMyMonth } from "@/modules/daily_worker/lib/data";
import { monthCounts, type DayCell } from "@/modules/daily_worker/lib/types";
import { MONTHS_SHORT, WEEKDAYS_MON, displayYear, tr, type WorkerLang, type WorkerTextKey } from "@/modules/daily_worker/i18n";
import { workerLangFor } from "@/modules/daily_worker/lang-server";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { key: WorkerTextKey; cls: string }> = {
  m: { key: "present", cls: "bg-(--tone-ok)/12 text-(--tone-ok)" },
  s: { key: "late", cls: "bg-(--tone-warn)/15 text-(--tone-warn)" },
  x: { key: "absent", cls: "bg-(--tone-danger)/12 text-(--tone-danger)" },
  n: { key: "noShow", cls: "bg-(--bg-soft) text-(--ink-soft)" },
  o: { key: "dayOff", cls: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100" },
  l: { key: "leave", cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200" },
  r: { key: "restDay", cls: "bg-(--bg-soft) text-(--ink-soft)" },
};

const hours = (lang: WorkerLang, minutes: number) => {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} ${tr(lang, "hours")}`;
};

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** วันจันทร์ของสัปดาห์ที่วันนั้นอยู่ */
const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
const label = (lang: WorkerLang, date: string) => `${Number(date.slice(8))} ${MONTHS_SHORT[lang][Number(date.slice(5, 7)) - 1]}`;

/**
 * "เข้าออกของฉัน" ของคนงาน — ทีละสัปดาห์ (จันทร์–อาทิตย์) วันละการ์ด มือถือก่อน · แยกจากหน้าลงเวลา
 * เห็นเฉพาะของตัวเอง · เหตุผลที่ผู้ดูแลแก้ ขาด → มา ไม่แสดง (เห็นแค่ "มา (แก้แล้ว)")
 */
export default async function MyWeekPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const session = await requireOrg();
  const lang = await workerLangFor(session.roles);
  const t = (key: WorkerTextKey) => tr(lang, key);
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
  // ทั้งเดือนของวันสุดท้ายที่ผ่านมาแล้วในสัปดาห์นี้ (สัปดาห์คร่อมเดือน = เดือนหลัง)
  const lastShown = dates[6]! > today ? today : dates[6]!;
  const monthMine = loaded[months.indexOf(lastShown.slice(0, 7))];
  const mc = monthMine ? monthCounts(monthMine.worker.cells) : null;

  return (
    <AppScaffold title={t("menuMyWeek")} width="max-w-none">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Link href={`?week=${addDays(start, -7)}`} className="rounded-full border border-(--line) bg-(--bg) p-2.5" aria-label={t("prevWeek")}>
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1 rounded-full border border-(--line) bg-(--bg) py-2 text-center text-sm font-semibold">
            {label(lang, dates[0]!)} – {label(lang, dates[6]!)} {displayYear(lang, Number(dates[6]!.slice(0, 4)))}
            {start === thisWeek && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{t("thisWeek")}</span>}
          </div>
          {start < thisWeek ? (
            <Link href={`?week=${addDays(start, 7)}`} className="rounded-full border border-(--line) bg-(--bg) p-2.5" aria-label={t("nextWeek")}>
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <span className="rounded-full border border-(--line) p-2.5 opacity-30" aria-hidden>
              <ChevronRight className="h-4 w-4" />
            </span>
          )}
        </div>

        <div className="grid grid-cols-5 gap-2">
          {[
            { label: t("present"), value: count("m") + count("s") },
            { label: t("late"), value: count("s") },
            { label: t("absent"), value: count("x") },
            { label: t("dayOff"), value: count("o") },
            { label: "OT", value: otMinutes ? hours(lang, otMinutes) : "0" },
          ].map((t) => (
            <div key={t.label} className="rounded-2xl border border-(--line) bg-(--bg) p-2.5 text-center">
              <p className="text-xs text-(--ink-soft)">{t.label}</p>
              <p className="text-base font-bold tabular-nums">{t.value}</p>
            </div>
          ))}
        </div>

        {mc && (
          <div className="rounded-2xl border border-(--line) bg-(--bg) p-3">
            <p className="pb-2 text-xs font-semibold text-(--ink-soft)">
              {tr(lang, "monthSummary", { month: `${MONTHS_SHORT[lang][Number(lastShown.slice(5, 7)) - 1]} ${displayYear(lang, Number(lastShown.slice(0, 4)))}` })}
            </p>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: t("present"), value: tr(lang, "days", { n: mc.worked }) },
                { label: t("dayOff"), value: tr(lang, "days", { n: mc.off + mc.leave }) },
                { label: t("absent"), value: tr(lang, "days", { n: mc.absent }) },
                { label: "OT", value: mc.otDays ? `${tr(lang, "days", { n: mc.otDays })} · ${hours(lang, mc.otMinutes)}` : tr(lang, "days", { n: 0 }) },
              ].map((x) => (
                <div key={x.label}>
                  <p className="text-xs text-(--ink-soft)">{x.label}</p>
                  <p className="text-sm font-bold tabular-nums">{x.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {!hasShift && <p className="rounded-xl bg-(--tone-warn)/10 p-3 text-sm text-(--tone-warn)">{t("noShiftYet")}</p>}

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
                  <p className="text-xs text-(--ink-soft)">{WEEKDAYS_MON[lang][i]}</p>
                  <p className="text-xl font-bold tabular-nums">{Number(date.slice(8))}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm tabular-nums">
                    {t("in")} <b>{c?.inAt ?? "--:--"}</b> · {t("out")} <b>{c?.outAt ?? "--:--"}</b>
                  </p>
                  <p className="text-xs text-(--ink-soft)">
                    {date === today && `${t("today")} · `}
                    {c?.lateMin ? <span className="text-(--tone-warn)">{t("late")} {c.lateMin} {t("minutes")} · </span> : null}
                    {c?.early && <span className="text-(--tone-warn)">{t("earlyOut")}{c.earlyMin ? ` ${c.earlyMin} ${t("minutes")}` : ""} · </span>}
                    {c?.ot && <span className="text-violet-700 dark:text-violet-300">OT {c.ot.start}–{c.ot.end} ({hours(lang, c.ot.minutes)})</span>}
                  </p>
                </div>
                {st ? (
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${st.cls}`}>{c?.override ? t("fixed") : t(st.key)}</span>
                ) : (
                  <span className="shrink-0 text-xs text-(--ink-soft)">{future ? "" : "—"}</span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-(--ink-soft)">{t("weekFootnote")}</p>
      </div>
    </AppScaffold>
  );
}
