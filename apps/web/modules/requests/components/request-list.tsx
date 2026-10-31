"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ClipboardList, Clock, Inbox, PenLine, Plus, Search, SlidersHorizontal, Wallet, X } from "lucide-react";

import { AppScaffold } from "@/components/module/app-scaffold";
import { KIND_META, KINDS, baht, thaiDate, type BeneficiaryKind, type RequestKind, type StatusInfo } from "../lib/types";
import { KindChip, Notice, StatusChip } from "./ui";

export interface ListRow {
  id: string;
  code: string;
  kind: RequestKind;
  title: string;
  meta: string;
  beneficiaryName: string;
  beneficiaryKind: BeneficiaryKind;
  beneficiaryLabel: string;
  createdByName: string;
  workDate: string;
  amount: number;
  /** ยอด OT พนักงานประจำที่คนดูไม่มีสิทธิ์เห็น (บอกเงินเดือนได้) — แสดง "ซ่อนยอด" แทนตัวเลข */
  amountHidden?: boolean;
  status: StatusInfo;
  waitingMe: boolean;
  toPay: boolean;
  mine: boolean;
  open: boolean;
}

export interface HomeStat {
  label: string;
  value: number;
  sub: string;
}

type Tab = "me" | "pay" | "mine" | "open" | "all";

const TAB_ICON = { me: Inbox, pay: Wallet, mine: PenLine, open: Clock, all: ClipboardList } as const;

/**
 * หน้ารวมเบิกจ่าย & OT — แบบบอร์ดงาน: แท็บอยู่บนแถบหัว (แทนชื่อหน้า) · ปุ่ม "ตัวกรอง" ขวาบนเป็นป๊อปอัป
 * เนื้อหาเต็มความกว้าง: จอกว้าง = รายการซ้าย + ตัวเลขสรุป/เงินสดย่อยคอลัมน์ขวา ("พื้นที่มีให้เยอะ ๆ")
 */
export function RequestsHome({
  rows,
  stats,
  statsTitle,
  petty,
  overdueNote,
  showPayTab,
  showAllTab,
  showApproveTab,
}: {
  rows: ListRow[];
  stats: HomeStat[] | null;
  statsTitle: string;
  petty: { id: string; name: string; balance: number }[];
  overdueNote: string | null;
  showPayTab: boolean;
  showAllTab: boolean;
  /** คนที่อนุมัติได้ (HR/CEO) — เห็นแท็บ "รอฉันอนุมัติ" แม้ว่าง · คนดูทุกใบอย่างเดียว (เช่น IT) ไม่ต้องเห็น */
  showApproveTab: boolean;
}) {
  const counts = {
    me: rows.filter((r) => r.waitingMe).length,
    pay: rows.filter((r) => r.toPay).length,
    mine: rows.filter((r) => r.mine).length,
    open: rows.filter((r) => r.open).length,
  };
  const [tab, setTab] = useState<Tab>(counts.me > 0 ? "me" : counts.pay > 0 && showPayTab ? "pay" : showAllTab ? (counts.open > 0 ? "open" : "all") : "mine");
  const [kinds, setKinds] = useState<RequestKind[]>([]);
  const [who, setWho] = useState<BeneficiaryKind | null>(null);
  const [q, setQ] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filterOpen) return;
    const close = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setFilterOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [filterOpen]);

  const tabs: { id: Tab; label: string; n?: number; alert?: boolean; show: boolean }[] = [
    { id: "me", label: "รอฉันอนุมัติ", n: counts.me, alert: true, show: counts.me > 0 || showApproveTab },
    { id: "pay", label: "รอจ่าย", n: counts.pay, alert: true, show: showPayTab },
    { id: "mine", label: "ของฉัน", n: counts.mine, show: true },
    { id: "open", label: "ค้างอยู่", n: counts.open, show: showAllTab },
    { id: "all", label: "ทั้งหมด", show: showAllTab },
  ];
  const activeFilters = kinds.length + (who ? 1 : 0) + (q.trim() ? 1 : 0);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "me" && !r.waitingMe) return false;
      if (tab === "pay" && !r.toPay) return false;
      if (tab === "mine" && !r.mine) return false;
      if (tab === "open" && !r.open) return false;
      if (kinds.length > 0 && !kinds.includes(r.kind)) return false;
      if (who && r.beneficiaryKind !== who) return false;
      if (needle && ![r.code, r.title, r.beneficiaryName, r.createdByName, r.meta].some((s) => s.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [rows, tab, kinds, who, q]);
  const sum = shown.reduce((s, r) => s + (r.amountHidden ? 0 : r.amount), 0);
  const hiddenCount = shown.filter((r) => r.amountHidden).length;

  const tabButtons = () =>
    tabs
      .filter((t) => t.show)
      .map((t) => {
        const Icon = TAB_ICON[t.id];
        const on = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => setTab(t.id)}
            title={t.label}
            className={`group flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 py-[7px] text-[13px] font-semibold transition-all duration-200 active:scale-[0.96] lg:px-4 ${
              on
                ? "bg-(--brand-navy) text-white shadow-[0_2px_10px_rgba(27,37,55,0.3)]"
                : "text-slate-600 hover:-translate-y-px hover:bg-white hover:text-(--brand-navy) hover:shadow-[0_2px_8px_rgba(27,37,55,0.12)]"
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className={on ? "" : "hidden md:inline"}>{t.label}</span>
            {t.n !== undefined && t.n > 0 && (
              <span className={`rounded-full px-1.5 text-[11px] leading-[18px] ${on ? "bg-white/20 text-white" : t.alert ? "bg-red-500 text-white" : "bg-slate-200 text-slate-700"}`}>{t.n}</span>
            )}
          </button>
        );
      });

  /** มือถือ: แท็บแบบแถบคอลัมน์ของบอร์ดงาน — ป้ายมีกรอบทุกอัน [จำนวน] ชื่อ · ที่เลือกอยู่ = กรอบ+พื้นกรมท่าอ่อน (ไม่ใช้เขียว) */
  const mobileTabs = tabs
    .filter((t) => t.show)
    .map((t) => {
      const on = tab === t.id;
      return (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={on}
          onClick={() => setTab(t.id)}
          className={`flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] transition-colors ${
            on ? "border-(--brand-navy) bg-[#dde3ee] font-bold text-(--ink)" : "border-(--line) bg-white font-medium text-(--ink-soft)"
          }`}
        >
          {t.n !== undefined && (
            <span
              className={`flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[11.5px] font-bold tabular-nums ${
                on ? "bg-(--brand-navy) text-white" : t.alert && t.n > 0 ? "bg-red-500 text-white" : "bg-(--bg-soft) text-(--ink)"
              }`}
            >
              {t.n}
            </span>
          )}
          <span className="whitespace-nowrap">{t.label}</span>
        </button>
      );
    });

  const leading = (
    <div className="flex w-full min-w-0 items-center gap-2 pl-1 sm:pl-2">
      <span className="text-[17px] font-bold text-(--ink) sm:hidden">เบิกจ่าย & OT</span>
      <div className="hidden min-w-0 items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 sm:flex" role="tablist" aria-label="มุมมองรายการ">
        {tabButtons()}
      </div>
    </div>
  );

  const actions = (
    <div className="flex items-center gap-1">
      <div ref={filterRef} className="relative">
        <button
          type="button"
          onClick={() => setFilterOpen((v) => !v)}
          aria-expanded={filterOpen}
          aria-label={activeFilters > 0 ? `ตัวกรอง ใช้อยู่ ${activeFilters} รายการ` : "ตัวกรอง"}
          // มือถือ: ไอคอนกลมแบบบอร์ดงาน พื้นกรมท่าอ่อน + ขอบบาง (เดิมเทาจางจนดูไม่ออกว่าเป็นปุ่ม) · จอใหญ่: ปุ่ม "ตัวกรอง" มีข้อความ
          className={`relative flex h-10 w-10 items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold transition-colors active:scale-95 sm:w-auto sm:rounded-xl sm:px-3 ${
            activeFilters
              ? "bg-(--brand-navy) text-white shadow-[0_2px_8px_rgba(27,37,55,0.3)]"
              : "bg-[#dde3ee] text-(--brand-navy) ring-1 ring-inset ring-[#c3cbd9] hover:bg-[#cfd6e2]"
          }`}
        >
          <SlidersHorizontal className="h-5 w-5 sm:h-4 sm:w-4" aria-hidden="true" />
          <span className="hidden sm:inline">ตัวกรอง</span>
          {activeFilters > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10.5px] font-bold tabular-nums text-(--brand-navy) ring-1 ring-(--brand-navy) sm:static sm:h-auto sm:bg-white/25 sm:text-[11px] sm:font-normal sm:text-white sm:ring-0">
              {activeFilters}
            </span>
          )}
          <ChevronDown className="hidden h-3.5 w-3.5 sm:block" aria-hidden="true" />
        </button>
        {filterOpen && (
          <div className="fixed inset-x-3 top-16 z-50 flex flex-col gap-3 rounded-2xl border border-(--line) bg-(--bg) p-4 shadow-(--shadow-pop) sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[380px]">
            <label className="relative">
              <span className="sr-only">ค้นหา</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)" aria-hidden="true" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา เลขที่ ชื่อ รายการ บ้าน" className="h-10 w-full rounded-xl border border-(--line) bg-(--bg) pl-9 pr-3 text-sm" />
            </label>
            <div>
              <div className="mb-1.5 text-xs font-semibold text-(--ink-soft)">ประเภท</div>
              <div className="flex flex-wrap gap-1.5">
                {KINDS.map((k) => {
                  const on = kinds.includes(k);
                  return (
                    <button key={k} type="button" aria-pressed={on} onClick={() => setKinds(on ? kinds.filter((x) => x !== k) : [...kinds, k])} className={`h-8 rounded-full px-3 text-xs ${on ? "bg-(--brand-navy) font-semibold text-white" : "border border-(--line) text-(--ink) hover:bg-(--bg-soft)"}`}>
                      {KIND_META[k].label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-semibold text-(--ink-soft)">ของใคร</div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["staff", "พนักงาน"],
                    ["worker", "คนงาน"],
                    ["vendor", "ภายนอก"],
                  ] as [BeneficiaryKind, string][]
                ).map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={who === k} onClick={() => setWho(who === k ? null : k)} className={`h-8 rounded-full px-3 text-xs ${who === k ? "bg-(--brand-navy) font-semibold text-white" : "border border-(--line) text-(--ink) hover:bg-(--bg-soft)"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-(--line) pt-3 text-xs text-(--ink-soft)">
              <span>เจอ {shown.length} รายการ</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 font-medium text-(--app-strong) hover:underline disabled:opacity-40"
                disabled={activeFilters === 0}
                onClick={() => {
                  setKinds([]);
                  setWho(null);
                  setQ("");
                }}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" /> ล้างตัวกรอง
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const statCards = (compact: boolean) =>
    stats?.map((s) => (
      <div key={s.label} className={`rounded-(--radius-lg) border border-(--line) bg-(--bg) ${compact ? "px-3 py-2.5" : "p-3.5"}`}>
        <div className="truncate text-xs text-(--ink-soft)">{s.label} · {statsTitle}</div>
        <div className={`font-bold tabular-nums text-(--ink) ${compact ? "text-lg" : "mt-0.5 text-xl"}`}>{baht(s.value)}</div>
        <div className="truncate text-[11px] text-(--ink-soft)">{s.sub}</div>
      </div>
    ));

  const pettyBox = petty.length > 0 && (
    <section className="rounded-(--radius-lg) border border-(--line) bg-(--bg) p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-(--ink)">เงินสดย่อยคงเหลือ</h2>
        <Link href="/requests/petty-cash" className="text-xs font-medium text-(--app-strong) hover:underline">ประวัติ / เติมเงิน</Link>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {petty.map((h) => (
          <li key={h.id}>
            <Link href={`/requests/petty-cash?holder=${h.id}`} className="flex items-baseline justify-between gap-2 rounded-(--radius) bg-(--bg-soft) px-3 py-2 hover:brightness-95">
              <span className="truncate text-sm text-(--ink)">{h.name}</span>
              <span className={`text-base font-bold tabular-nums ${h.balance < 0 ? "text-(--danger)" : "text-(--ink)"}`}>{baht(h.balance)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );

  /** แท็บเล็ต/โน้ตบุ๊ก: ตัวเลข + เงินสดย่อยเป็นแถบเตี้ยแถวเดียวเหนือรายการ ให้รายการกว้างเต็ม */
  const strip = (stats || petty.length > 0) && (
    <div className="hidden gap-2 sm:grid sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.2fr)] 2xl:hidden">
      {statCards(true)}
      {petty.length > 0 && (
        <Link href="/requests/petty-cash" className="rounded-(--radius-lg) border border-(--line) bg-(--bg) px-3 py-2.5 hover:bg-(--bg-soft) sm:col-span-2 lg:col-span-1">
          <div className="text-xs text-(--ink-soft)">เงินสดย่อยคงเหลือ</div>
          <div className="mt-0.5 flex flex-col gap-0.5">
            {petty.map((h) => (
              <div key={h.id} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-(--ink)">{h.name}</span>
                <span className={`font-bold tabular-nums ${h.balance < 0 ? "text-(--danger)" : "text-(--ink)"}`}>{baht(h.balance)}</span>
              </div>
            ))}
          </div>
        </Link>
      )}
    </div>
  );

  return (
    <AppScaffold
      title="เบิกจ่าย & OT"
      hideTitle
      leading={leading}
      actions={actions}
      width="max-w-[1600px]"
      // ยื่นคำขอ = ปุ่มลอย + มุมขวาล่าง แบบบอร์ดงาน (ผู้ใช้ขอ 21/10/2569) — มือถือลอยเหนือเมนูล่าง
      fab={
        <Link
          href="/requests/new"
          aria-label="ยื่นคำขอ"
          title="ยื่นคำขอ"
          className="fixed bottom-[84px] right-4 z-40 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-(--app) text-white shadow-[0_4px_14px_rgba(124,58,237,0.4)] transition-transform hover:brightness-105 active:scale-95 lg:bottom-6 lg:right-6"
        >
          <Plus className="h-6 w-6" aria-hidden="true" />
        </Link>
      }
    >
      {/* เว้นท้ายหน้าให้ปุ่มลอยไม่บังยอดรวม/รายการสุดท้าย */}
      <div className="flex flex-col gap-4 pb-20 lg:pb-16 2xl:flex-row 2xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* มือถือ: แท็บเป็นแถวเลื่อนใต้แถบหัว (แถบหัวแคบ ใส่แท็บแล้วตกขอบ) */}
          <div
            className="-mx-4 -mt-4 flex items-center gap-2 overflow-x-auto border-b border-(--line) bg-white px-3 py-2 [scrollbar-width:none] sm:hidden [&::-webkit-scrollbar]:hidden"
            role="tablist"
            aria-label="มุมมองรายการ"
          >
            {mobileTabs}
          </div>
          {strip}
          {overdueNote && <Notice tone="warn">{overdueNote}</Notice>}
          {activeFilters > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-(--ink-soft)">กรองอยู่:</span>
              {kinds.map((k) => (
                <button key={k} type="button" onClick={() => setKinds(kinds.filter((x) => x !== k))} className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2.5 py-1 font-medium text-(--ink)">
                  {KIND_META[k].short} <X className="h-3 w-3" aria-label="เอาออก" />
                </button>
              ))}
              {who && (
                <button type="button" onClick={() => setWho(null)} className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2.5 py-1 font-medium text-(--ink)">
                  {who === "staff" ? "พนักงาน" : who === "worker" ? "คนงาน" : "ภายนอก"} <X className="h-3 w-3" aria-label="เอาออก" />
                </button>
              )}
              {q.trim() && (
                <button type="button" onClick={() => setQ("")} className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2.5 py-1 font-medium text-(--ink)">
                  “{q.trim()}” <X className="h-3 w-3" aria-label="เอาออก" />
                </button>
              )}
            </div>
          )}

          {shown.length === 0 ? (
            <div className="rounded-(--radius-lg) border border-dashed border-(--line) bg-(--bg) px-4 py-16 text-center text-sm text-(--ink-soft)">
              {tab === "me" ? "ไม่มีใบรอคุณอนุมัติ" : tab === "pay" ? "ไม่มีใบรอจ่าย" : activeFilters ? "ไม่มีรายการตามตัวกรอง" : "ยังไม่มีรายการ"}
            </div>
          ) : (
            <div className="overflow-hidden rounded-(--radius-lg) border border-(--line) bg-(--bg)">
              <div className="hidden grid-cols-[minmax(0,1fr)_170px_100px_160px_110px] gap-4 border-b border-(--line) bg-(--bg-soft) px-4 py-2 text-xs font-semibold text-(--ink-soft) xl:grid">
                <span>รายการ</span>
                <span>ของใคร</span>
                <span>วันที่</span>
                <span>สถานะ</span>
                <span className="text-right">ยอด</span>
              </div>
              <ul className="divide-y divide-(--line)">
                {shown.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/requests/${r.id}`}
                      className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 hover:bg-(--bg-soft) xl:grid-cols-[minmax(0,1fr)_170px_100px_160px_110px] xl:items-center xl:gap-4 ${r.waitingMe || r.toPay ? "bg-red-50/50" : ""}`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <KindChip kind={r.kind} />
                          <span className="truncate text-sm font-semibold text-(--ink)">{r.title}</span>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-(--ink-soft)">
                          {r.code}
                          {r.meta ? ` · ${r.meta}` : ""}
                          <span className="xl:hidden"> · {r.beneficiaryName} · {thaiDate(r.workDate)}</span>
                        </div>
                      </div>
                      <div className="hidden min-w-0 xl:block">
                        <div className="truncate text-sm text-(--ink)">{r.beneficiaryName}</div>
                        <div className="text-xs text-(--ink-soft)">{r.beneficiaryLabel}</div>
                      </div>
                      <div className="hidden text-sm text-(--ink) xl:block">{thaiDate(r.workDate)}</div>
                      <div className="col-start-1 row-start-2 xl:col-auto xl:row-auto">
                        <StatusChip info={r.status} />
                      </div>
                      <div className="row-span-2 self-center text-right text-base font-bold tabular-nums text-(--ink) xl:row-span-1">
                        {r.amountHidden ? <span className="text-xs font-medium text-(--ink-soft)" title="ยอด OT บอกเงินเดือนได้ — เห็นเฉพาะเจ้าตัว / CEO / ผู้ดูแลเงินเดือน">ซ่อนยอด</span> : baht(r.amount)}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between border-t border-(--line) bg-(--bg-soft) px-4 py-2 text-xs text-(--ink-soft)">
                <span>{shown.length} รายการ</span>
                <span>
                  รวม <strong className="text-(--ink)">{baht(sum)}</strong>
                  {hiddenCount > 0 && <> (ไม่รวม OT ที่ซ่อนยอด {hiddenCount} ใบ)</>}
                </span>
              </div>
            </div>
          )}
        </div>
        {/* จอใหญ่: คอลัมน์ขวา */}
        {(stats || petty.length > 0) && (
          <aside className="hidden w-[340px] shrink-0 flex-col gap-3 2xl:flex">
            {stats && <section className="grid grid-cols-1 gap-2">{statCards(false)}</section>}
            {pettyBox}
          </aside>
        )}
        {/* มือถือ: ตัวเลขสรุปต่อท้ายรายการ — รายการขึ้นก่อน */}
        {(stats || petty.length > 0) && (
          <div className="flex flex-col gap-2 sm:hidden">
            {stats && <section className="grid grid-cols-2 gap-2">{statCards(true)}</section>}
            {pettyBox}
          </div>
        )}
      </div>
    </AppScaffold>
  );
}
