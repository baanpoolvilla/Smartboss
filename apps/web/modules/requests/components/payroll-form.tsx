"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { markPayrollAction } from "../actions";
import { baht, thaiDate } from "../lib/types";
import { Notice } from "./ui";

export interface PayrollItem {
  id: string;
  code: string;
  name: string;
  title: string;
  date: string;
  amount: number;
  note: string;
  self: boolean;
}

/** ติ๊กรายการที่ใส่ในงวดเงินเดือนนี้แล้ว → บันทึกทีเดียว (เก็บว่าใครกด งวดไหน) */
export function PayrollForm({ period, periodLabel, pays, deducts }: { period: string; periodLabel: string; pays: PayrollItem[]; deducts: PayrollItem[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [payIds, setPayIds] = useState<Set<string>>(new Set(pays.filter((p) => !p.self).map((p) => p.id)));
  const [deductIds, setDeductIds] = useState<Set<string>>(new Set(deducts.filter((p) => !p.self).map((p) => p.id)));
  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  };
  const payTotal = pays.filter((p) => payIds.has(p.id)).reduce((s, p) => s + p.amount, 0);
  const deductTotal = deducts.filter((p) => deductIds.has(p.id)).reduce((s, p) => s + p.amount, 0);

  function save() {
    setError(null);
    start(async () => {
      const res = await markPayrollAction({ period, payIds: [...payIds], deductIds: [...deductIds] });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(`บันทึกแล้ว ${res.done} รายการ`);
      router.refresh();
    });
  }

  const table = (title: string, hint: string, items: PayrollItem[], set: Set<string>, apply: (s: Set<string>) => void, total: number, sign: "+" | "−") => (
    <section className="rounded-(--radius-lg) border border-(--line) bg-(--bg)">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-(--line) px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-(--ink)">{title}</h2>
          <p className="text-xs text-(--ink-soft)">{hint}</p>
        </div>
        <div className="text-sm">
          เลือก {[...set].filter((id) => items.some((i) => i.id === id)).length}/{items.length} · <strong className="tabular-nums">{sign}{baht(total)}</strong>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-(--ink-soft)">ไม่มีรายการ</div>
      ) : (
        <ul className="divide-y divide-(--line)">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
              <input type="checkbox" className="h-5 w-5" checked={set.has(i.id)} disabled={i.self} onChange={() => toggle(set, i.id, apply)} aria-label={`${i.code} ${i.name}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-(--ink)">{i.name} · {i.title}</div>
                <div className="truncate text-xs text-(--ink-soft)">
                  <Link href={`/requests/${i.id}`} className="hover:underline">{i.code}</Link> · {thaiDate(i.date)}{i.note ? ` · ${i.note}` : ""}{i.self ? " · ของคุณเอง ให้ HR อีกคนบันทึก" : ""}
                </div>
              </div>
              <div className="shrink-0 text-sm font-bold tabular-nums">{baht(i.amount)}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="flex flex-col gap-4">
      {table("บวกเข้าเงินเดือน", "OT พนักงานที่อนุมัติแล้ว ยังไม่ได้จ่าย", pays, payIds, setPayIds, payTotal, "+")}
      {table("หักจากเงินเดือน", "เบิกล่วงหน้า / เงินเบิกไปก่อนที่ไม่ได้คืน — ยังไม่ได้หัก", deducts, deductIds, setDeductIds, deductTotal, "−")}
      {error && <Notice tone="danger">{error}</Notice>}
      {done && <Notice tone="ok">{done}</Notice>}
      <button type="button" onClick={save} disabled={busy || (payIds.size === 0 && deductIds.size === 0)} className="inline-flex h-12 items-center justify-center gap-2 rounded-(--radius) bg-(--app) px-4 text-base font-semibold text-white hover:brightness-95 disabled:opacity-50">
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        ใส่ในงวด {periodLabel} แล้ว — บันทึก
      </button>
      <p className="text-center text-xs text-(--ink-soft)">กดหลังจากใส่ยอดในระบบเงินเดือน/โอนเงินเดือนแล้ว · รายการที่ไม่ได้ติ๊กจะยกไปงวดถัดไป</p>
    </div>
  );
}
