"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import { KIND_META, KINDS, baht, thaiDate, type RequestKind, type StatusInfo } from "../lib/types";
import { KindChip, StatusChip } from "./ui";

export interface ListRow {
  id: string;
  code: string;
  kind: RequestKind;
  title: string;
  meta: string;
  beneficiaryName: string;
  beneficiaryLabel: string;
  createdByName: string;
  workDate: string;
  amount: number;
  status: StatusInfo;
  waitingMe: boolean;
  toPay: boolean;
  mine: boolean;
  open: boolean;
}

type Tab = "me" | "pay" | "mine" | "open" | "all";

export function RequestList({ rows, showPayTab, showAllTab }: { rows: ListRow[]; showPayTab: boolean; showAllTab: boolean }) {
  const counts = {
    me: rows.filter((r) => r.waitingMe).length,
    pay: rows.filter((r) => r.toPay).length,
    mine: rows.filter((r) => r.mine).length,
    open: rows.filter((r) => r.open).length,
  };
  const [tab, setTab] = useState<Tab>(counts.me > 0 ? "me" : counts.pay > 0 && showPayTab ? "pay" : showAllTab ? (counts.open > 0 ? "open" : "all") : "mine");
  const [kind, setKind] = useState<RequestKind | null>(null);
  const [q, setQ] = useState("");

  const tabs: { id: Tab; label: string; n?: number; show: boolean }[] = [
    { id: "me", label: "รอฉันอนุมัติ", n: counts.me, show: counts.me > 0 || showAllTab },
    { id: "pay", label: "รอจ่าย", n: counts.pay, show: showPayTab },
    { id: "mine", label: "ของฉัน", n: counts.mine, show: true },
    { id: "open", label: "ยังไม่จบ", n: counts.open, show: showAllTab },
    { id: "all", label: "ทั้งหมด", show: showAllTab },
  ];

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "me" && !r.waitingMe) return false;
      if (tab === "pay" && !r.toPay) return false;
      if (tab === "mine" && !r.mine) return false;
      if (tab === "open" && !r.open) return false;
      if (kind && r.kind !== kind) return false;
      if (needle && ![r.code, r.title, r.beneficiaryName, r.createdByName, r.meta].some((s) => s.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [rows, tab, kind, q]);
  const sum = shown.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {tabs.filter((t) => t.show).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`h-9 rounded-full px-3.5 text-sm transition-colors ${tab === t.id ? "bg-(--brand-navy) font-semibold text-white" : "border border-(--line) bg-(--bg) text-(--ink) hover:bg-(--bg-soft)"}`}
            >
              {t.label}
              {t.n !== undefined && t.n > 0 && <span className={`ml-1.5 rounded-full px-1.5 text-xs ${tab === t.id ? "bg-white/20" : t.id === "me" || t.id === "pay" ? "bg-red-100 text-red-800" : "bg-(--bg-soft)"}`}>{t.n}</span>}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <label className="relative w-full sm:w-64">
          <span className="sr-only">ค้นหา</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา เลขที่ ชื่อ รายการ" className="h-9 w-full rounded-full border border-(--line) bg-(--bg) pl-9 pr-3 text-sm" />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setKind(null)} aria-pressed={kind === null} className={`h-8 rounded-full px-3 text-xs ${kind === null ? "bg-slate-200 font-semibold text-(--ink)" : "border border-(--line) text-(--ink-soft) hover:bg-(--bg-soft)"}`}>
          ทุกประเภท
        </button>
        {KINDS.map((k) => (
          <button key={k} type="button" onClick={() => setKind(kind === k ? null : k)} aria-pressed={kind === k} className={`h-8 rounded-full px-3 text-xs ${kind === k ? "bg-slate-200 font-semibold text-(--ink)" : "border border-(--line) text-(--ink-soft) hover:bg-(--bg-soft)"}`}>
            {KIND_META[k].short}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-(--radius-lg) border border-dashed border-(--line) bg-(--bg) px-4 py-10 text-center text-sm text-(--ink-soft)">
          {tab === "me" ? "ไม่มีใบรอคุณอนุมัติ" : tab === "pay" ? "ไม่มีใบรอจ่าย" : "ยังไม่มีรายการ"}
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-(--line) overflow-hidden rounded-(--radius-lg) border border-(--line) bg-(--bg)">
          {shown.map((r) => (
            <li key={r.id}>
              <Link href={`/requests/${r.id}`} className={`flex flex-col gap-1.5 px-4 py-3 hover:bg-(--bg-soft) sm:flex-row sm:items-center sm:gap-4 ${r.waitingMe || r.toPay ? "bg-red-50/40" : ""}`}>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <KindChip kind={r.kind} />
                    <span className="truncate text-sm font-semibold text-(--ink)">{r.title}</span>
                  </div>
                  <div className="truncate text-xs text-(--ink-soft)">
                    {r.code} · {thaiDate(r.workDate)} · {r.beneficiaryName} ({r.beneficiaryLabel}){r.meta ? ` · ${r.meta}` : ""}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 sm:w-64 sm:justify-end">
                  <StatusChip info={r.status} />
                  <span className="text-base font-bold tabular-nums text-(--ink)">{baht(r.amount)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && (
        <div className="text-right text-xs text-(--ink-soft)">
          {shown.length} รายการ · รวม <strong className="text-(--ink)">{baht(sum)}</strong>
        </div>
      )}
    </div>
  );
}
