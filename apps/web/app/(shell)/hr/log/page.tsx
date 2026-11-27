import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrg } from "@smartboss/auth";
import { AppScaffold } from "@/components/module/app-scaffold";
import { filterChangeLog, loadChangeLog, type ChangeEntry } from "@/modules/hr/lib/change-log";
import { CHANGE_CATEGORIES, type ChangeCategory } from "@/modules/hr/lib/change-log-text";
import { canSeeHrLog, hrLogHref, parseHrLogParams } from "@/modules/hr/lib/change-log-params";

export const dynamic = "force-dynamic";
export const metadata = { title: "Log การบันทึกระบบบุคคล · Smartboss" };

/**
 * Log การบันทึกระบบบุคคล — ใครทำอะไร เมื่อไร กับข้อมูลของใคร เปลี่ยนจากอะไรเป็นอะไร (ผู้ใช้ 27/11/2569)
 * เมนูแยกของระบบบุคคล ("ให้แยกออกมาเลยนะ") · Boss + คนที่มีสิทธิ์ตั้งค่าระบบบุคคล
 * ข้อมูลรวมจากทุกแหล่ง (modules/hr/lib/change-log.ts) อ่านอย่างเดียว · หน้า "ประวัติการใช้งาน" เดิมในตั้งค่ายังอยู่
 */

const CAT_TONE: Record<ChangeCategory, string> = {
  people: "bg-blue-50 text-blue-800",
  pay: "bg-amber-50 text-amber-900",
  leave: "bg-emerald-50 text-emerald-800",
  time: "bg-violet-50 text-violet-800",
  ot: "bg-orange-50 text-orange-800",
  shift: "bg-slate-100 text-slate-700",
  money: "bg-teal-50 text-teal-800",
  worker: "bg-lime-50 text-lime-800",
  commission: "bg-yellow-50 text-yellow-900",
  settings: "bg-slate-100 text-slate-700",
  device: "bg-sky-50 text-sky-800",
  view: "bg-pink-50 text-pink-800",
  checkin: "bg-slate-100 text-slate-600",
};

function bkkDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

function dayHeading(ymd: string): string {
  return new Date(`${ymd}T12:00:00+07:00`).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", weekday: "long", day: "numeric", month: "short", year: "numeric" });
}

function timeText(iso: string): string {
  return new Date(iso).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });
}

export default async function HrLogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireOrg();
  if (!canSeeHrLog(session)) redirect("/hr");
  const p = parseHrLogParams(await searchParams);
  const { entries: all, failed } = await loadChangeLog(session.orgId, { from: p.from, to: p.to, includeCheckins: p.includeCheckins });

  // ตัวเลขบนปุ่มหมวด = ตามตัวกรองอื่นที่เลือกอยู่ (ไม่รวมหมวดเอง)
  const forCounts = filterChangeLog(all, { category: "all", actor: p.actor, target: p.target, q: p.q });
  const counts = new Map<string, number>();
  for (const e of forCounts) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  const rows = filterChangeLog(all, { category: p.category, actor: p.actor, target: p.target, q: p.q });
  const shown = rows.slice(0, p.limit);

  const actors = [...new Set(all.map((e) => e.actor))].sort((a, b) => a.localeCompare(b, "th"));
  const targets = [...new Map(all.filter((e) => e.target).map((e) => [e.target!.id, e.target!] as const)).values()].sort((a, b) => a.name.localeCompare(b.name, "th"));

  const groups: { day: string; items: ChangeEntry[] }[] = [];
  for (const e of shown) {
    const day = bkkDayKey(e.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }

  const cats = (Object.keys(CHANGE_CATEGORIES) as ChangeCategory[]).filter((c) => c !== "checkin" || p.includeCheckins);
  const inputCls = "w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink)";

  return (
    <AppScaffold
      title="Log การบันทึกระบบบุคคล"
      width="max-w-6xl"
      actions={
        <a
          href={hrLogHref(p, {}, "/hr/log/export")}
          title="ดาวน์โหลด Excel ตามตัวกรองที่เลือก"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-(--radius) border border-(--line) bg-(--bg) px-2.5 py-1.5 text-sm font-semibold text-(--ink) hover:bg-(--bg-soft)"
        >
          <span className="hidden sm:inline">ดาวน์โหลด </span>Excel
        </a>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-(--ink-soft)">
          ใครทำอะไร เมื่อไร กับข้อมูลของใคร และเปลี่ยนจากอะไรเป็นอะไร · รวมทุกเมนูของระบบบุคคล (ลงเวลา ลา OT พนักงาน เงินเดือน ค่าคอม เบิกจ่าย คนงานรายวัน ตั้งค่า) · แก้หรือลบประวัติไม่ได้
        </p>

        <form method="get" className="flex flex-col gap-3 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <label className="flex flex-col gap-1 text-xs text-(--ink-soft)">
              ตั้งแต่วันที่
              <input type="date" name="from" defaultValue={p.fromYmd} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-(--ink-soft)">
              ถึงวันที่
              <input type="date" name="to" defaultValue={p.toYmd} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-(--ink-soft)">
              คนที่ทำ
              <select name="actor" defaultValue={p.actor} className={inputCls}>
                <option value="">ทุกคน</option>
                {actors.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-(--ink-soft)">
              ข้อมูลของพนักงาน
              <select name="emp" defaultValue={p.target} className={inputCls}>
                <option value="">ทุกคน</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{t.code ? ` (${t.code})` : ""}</option>
                ))}
              </select>
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-xs text-(--ink-soft) lg:col-span-1">
              ค้นหา
              <input type="search" name="q" defaultValue={p.q} placeholder="เช่น เงินเดือน, ลาพักร้อน" className={inputCls} />
            </label>
          </div>
          {p.category !== "all" && <input type="hidden" name="cat" value={p.category} />}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-(--ink)">
              <input type="checkbox" name="checkins" value="1" defaultChecked={p.includeCheckins} className="h-4 w-4 accent-(--brand-navy)" />
              แสดงการถ่ายรูปลงเวลาปกติด้วย (วันละหลายรายการ ไม่ใช่การแก้ไข)
            </label>
            <div className="flex gap-2">
              <Link href="/hr/log" className="rounded-(--radius) border border-(--line) px-3 py-1.5 text-sm text-(--ink-soft) hover:bg-(--bg-soft)">
                ล้างตัวกรอง
              </Link>
              <button type="submit" className="rounded-(--radius) bg-(--brand-navy) px-4 py-1.5 text-sm font-semibold text-white">
                ค้นหา
              </button>
            </div>
          </div>
        </form>

        <nav aria-label="หมวด" className="flex flex-wrap items-center gap-1.5">
          <Link
            href={hrLogHref(p, { cat: "" })}
            className={`rounded-full px-3 py-1 text-[13px] font-semibold ${p.category === "all" ? "bg-(--brand-navy) text-white" : "border border-(--line) bg-(--bg) text-(--ink)"}`}
          >
            ทั้งหมด {forCounts.length.toLocaleString("th-TH")}
          </Link>
          {cats.map((c) => (
            <Link
              key={c}
              href={hrLogHref(p, { cat: c })}
              className={`rounded-full px-3 py-1 text-[13px] ${p.category === c ? "bg-(--brand-navy) font-semibold text-white" : "border border-(--line) bg-(--bg) text-(--ink)"}`}
            >
              {CHANGE_CATEGORIES[c]} {(counts.get(c) ?? 0).toLocaleString("th-TH")}
            </Link>
          ))}
        </nav>

        {failed.length > 0 && (
          <p className="rounded-(--radius) border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            อ่านประวัติบางส่วนไม่ได้ตอนนี้: {failed.join(", ")} — รายการด้านล่างอาจไม่ครบ ลองโหลดใหม่อีกครั้ง
          </p>
        )}

        {shown.length === 0 ? (
          <p className="rounded-(--radius-lg) border border-dashed border-(--line) px-4 py-12 text-center text-sm text-(--ink-soft)">
            ไม่มีรายการในช่วงนี้ตามตัวกรองที่เลือก
          </p>
        ) : (
          <div className="overflow-hidden rounded-(--radius-lg) border border-(--line) bg-(--bg)">
            <div className="hidden grid-cols-[4.5rem_10rem_minmax(0,1fr)_11rem] gap-3 bg-(--bg-soft) px-4 py-2 text-xs font-semibold text-(--ink-soft) md:grid">
              <span>เวลา</span>
              <span>คนที่ทำ</span>
              <span>ทำอะไร</span>
              <span>ข้อมูลของ</span>
            </div>
            {groups.map((g) => (
              <section key={g.day}>
                <h2 className="border-t border-(--line) bg-(--bg-soft)/60 px-4 py-1.5 text-xs font-bold text-(--ink-soft)">{dayHeading(g.day)}</h2>
                {g.items.map((e) => (
                  <Row key={e.id} e={e} />
                ))}
              </section>
            ))}
            {rows.length > shown.length && (
              <div className="flex justify-center border-t border-(--line) p-3">
                <Link href={hrLogHref(p, { n: String(p.limit + 100) })} scroll={false} className="rounded-full border border-(--line) px-4 py-1.5 text-sm font-semibold text-(--ink) hover:bg-(--bg-soft)">
                  แสดงเพิ่มอีก {Math.min(100, rows.length - shown.length).toLocaleString("th-TH")} รายการ (เหลือ {(rows.length - shown.length).toLocaleString("th-TH")})
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </AppScaffold>
  );
}

function Row({ e }: { e: ChangeEntry }) {
  const hasMore = e.details.length > 0 || !!e.reason || !!e.device;
  const head = (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 md:grid-cols-[4.5rem_10rem_minmax(0,1fr)_11rem]">
      <span className="font-mono text-[13px] text-(--ink-soft) tabular-nums">{timeText(e.at)}</span>
      <span className="min-w-0 text-sm font-semibold text-(--ink) md:font-medium">{e.actor}</span>
      <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-(--ink) md:col-span-1">
        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${CAT_TONE[e.category]}`}>{CHANGE_CATEGORIES[e.category]}</span>
        <span className="min-w-0 break-words">{e.text}</span>
        {hasMore && <span className="text-xs text-(--ink-soft) group-open:hidden">ดูรายละเอียด ▾</span>}
      </span>
      <span className="col-span-2 min-w-0 text-sm md:col-span-1">
        {e.target ? (
          <>
            <span className="font-medium text-(--ink)">{e.target.name}</span>
            {e.target.code && <span className="ml-1 text-xs text-(--ink-soft)">{e.target.code}</span>}
          </>
        ) : (
          <span className="text-(--ink-soft) md:inline">—</span>
        )}
      </span>
    </div>
  );
  if (!hasMore) return <div className="border-t border-(--line)">{head}</div>;
  return (
    <details className="group border-t border-(--line) open:bg-(--bg-soft)/40">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{head}</summary>
      <div className="px-4 pb-3 md:pl-[calc(4.5rem+10rem+2.5rem)]">
        <div className="flex flex-col gap-1.5 rounded-(--radius) border border-(--line) bg-(--bg) p-3 text-[13px]">
          {e.details.map((d, i) => (
            <div key={`${d.label}-${i}`} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_1rem_minmax(0,1fr)]">
              <span className="text-(--ink-soft)">{d.label}</span>
              {d.before !== null && d.after !== null ? (
                <>
                  <span className="break-words text-red-700 line-through">{d.before}</span>
                  <span aria-hidden="true" className="hidden text-(--ink-soft) sm:inline">→</span>
                  <span className="col-start-2 break-words font-semibold text-emerald-700 sm:col-start-auto">{d.after}</span>
                </>
              ) : d.after !== null ? (
                <span className="break-words font-semibold text-emerald-700 sm:col-span-3">{d.after}</span>
              ) : (
                <span className="break-words text-red-700 line-through sm:col-span-3">{d.before}</span>
              )}
            </div>
          ))}
          {e.reason && (
            <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <span className="text-(--ink-soft)">เหตุผล</span>
              <span className="break-words">{e.reason}</span>
            </div>
          )}
          {e.device && <div className="text-xs text-(--ink-soft)">จาก {e.device}</div>}
        </div>
      </div>
    </details>
  );
}
