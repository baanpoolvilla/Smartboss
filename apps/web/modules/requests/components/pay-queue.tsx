"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { payManyAction } from "../actions";
import { baht, round2 } from "../lib/types";
import { Notice } from "./ui";

export interface QueueItem {
  id: string;
  code: string;
  title: string;
  beneficiaryName: string;
  meta: string;
  /** ยอดที่จะจ่าย (ค้างจ่าย) */
  amount: number;
  /** ยังรออนุมัติ — คนนี้อนุมัติได้ (ระดับ HR ไม่ต้องผ่าน CEO) → อนุมัติแล้วจ่ายในครั้งเดียว */
  pending: boolean;
  /** ผ่านเองด้วยวงเงินรายคน */
  autoApproved: boolean;
}

/**
 * คิว "รอจ่ายวันนี้" (ผู้ใช้ 22/11/2569 — ลอกแนวจ่ายรวดเดียว) — ติ๊กหลายใบ จ่ายเงินสด/เงินสดย่อยครั้งเดียว
 * ใบที่ยังรออนุมัติ (ที่คุณอนุมัติได้) อนุมัติพร้อมจ่ายได้ · ไม่ต้องถ่ายรูป ผู้รับกด "ได้รับเงินแล้ว" เอง
 * กดแล้วขึ้นสรุปให้ยืนยันก่อนทุกครั้ง
 */
export function PayQueue({ items, holders, canPayCash, myUserId }: { items: QueueItem[]; holders: { id: string; name: string; balance: number }[]; canPayCash: boolean; myUserId: string }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(items.filter((i) => !i.pending).map((i) => i.id)));
  const myHolder = holders.find((h) => h.id === myUserId);
  const [source, setSource] = useState<string>(myHolder ? `petty:${myHolder.id}` : canPayCash ? "cash" : holders[0] ? `petty:${holders[0].id}` : "cash");
  const [asking, setAsking] = useState(false);
  const [busy, start] = useTransition();
  const [result, setResult] = useState<{ done: string[]; failed: { code: string; error: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chosen = items.filter((i) => picked.has(i.id));
  const total = round2(chosen.reduce((s, i) => s + i.amount, 0));
  const holderId = source.startsWith("petty:") ? source.slice(6) : null;
  const holder = holders.find((h) => h.id === holderId) ?? null;
  const short = holder !== null && total > holder.balance + 0.005;
  const approveCount = chosen.filter((i) => i.pending).length;
  const sources = useMemo(
    () => [
      ...holders.filter((h) => canPayCash || h.id === myUserId).map((h) => ({ value: `petty:${h.id}`, label: `เงินสดย่อยของ${h.id === myUserId ? "ฉัน" : ` ${h.name}`} · เหลือ ${baht(h.balance)}` })),
      ...(canPayCash ? [{ value: "cash", label: "เงินสด (ไม่ผ่านเงินสดย่อย)" }] : []),
    ],
    [holders, canPayCash, myUserId],
  );

  if (items.length === 0) return null;

  const toggle = (id: string) => setPicked((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  function pay() {
    setError(null);
    start(async () => {
      const res = await payManyAction({ ids: chosen.map((i) => i.id), method: holderId ? "petty_cash" : "cash", pettyHolderId: holderId, approve: approveCount > 0 });
      setAsking(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult({ done: res.done, failed: res.failed });
      setPicked(new Set());
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-(--radius-lg) border-2 border-(--app) bg-(--bg) p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-(--ink)">รอจ่ายวันนี้ · จ่ายรวดเดียว</h2>
        <span className="text-xs text-(--ink-soft)">เงินสด ไม่ต้องถ่ายรูป — ผู้รับกด “ได้รับเงินแล้ว” ในมือถือ</span>
      </div>
      <ul className="flex flex-col divide-y divide-(--line) rounded-(--radius) border border-(--line)">
        {items.map((i) => (
          <li key={i.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-(--bg-soft)">
              <input type="checkbox" className="h-4 w-4 shrink-0" checked={picked.has(i.id)} onChange={() => toggle(i.id)} aria-label={`เลือก ${i.code}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-(--ink)">
                  {i.beneficiaryName} · {i.title}
                  {i.autoApproved && <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 text-[11px] font-semibold text-emerald-900">ผ่านด้วยวงเงิน</span>}
                  {i.pending && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-900">อนุมัติ + จ่าย</span>}
                </div>
                <div className="truncate text-xs text-(--ink-soft)">
                  <Link href={`/requests/${i.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{i.code}</Link>
                  {i.meta ? ` · ${i.meta}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-sm font-bold tabular-nums text-(--ink)">{baht(i.amount)}</div>
            </label>
          </li>
        ))}
      </ul>
      {sources.length > 1 && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-(--ink)">จ่ายจาก</span>
          <select className="h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm" value={source} onChange={(e) => setSource(e.target.value)} aria-label="จ่ายจาก">
            {sources.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius) bg-(--bg-soft) px-3 py-2">
        <div className="text-sm">
          <div className="font-semibold text-(--ink)">เลือก {chosen.length} ใบ · {baht(total)}</div>
          {holder && <div className={`text-xs ${short ? "font-semibold text-red-700" : "text-(--ink-soft)"}`}>{short ? `เงินในมือไม่พอ (เหลือ ${baht(holder.balance)}) — ขอเติมเงินก่อน` : `เงินในมือ ${baht(holder.balance)} → เหลือ ${baht(round2(holder.balance - total))}`}</div>}
        </div>
        <button type="button" disabled={busy || chosen.length === 0 || short} onClick={() => setAsking(true)} className="inline-flex h-11 items-center justify-center rounded-(--radius) bg-(--app) px-4 text-sm font-semibold text-white disabled:opacity-50">
          {approveCount > 0 ? `อนุมัติและจ่าย ${chosen.length} ใบ` : `จ่ายเงินสด ${chosen.length} ใบ`}
        </button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {result && (
        <Notice tone={result.failed.length ? "warn" : "ok"}>
          จ่ายแล้ว {result.done.length} ใบ{result.done.length ? ` (${result.done.join(", ")})` : ""}
          {result.failed.length > 0 && <> · ไม่สำเร็จ {result.failed.map((f) => `${f.code}: ${f.error}`).join(" · ")}</>}
        </Notice>
      )}

      {asking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="pay-many-title">
          <div className="flex max-h-[85vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-2xl border border-(--line) bg-(--bg) p-5 shadow-xl">
            <h3 id="pay-many-title" className="text-base font-semibold text-(--ink)">ยืนยันจ่ายเงินสด {chosen.length} ใบ</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {chosen.map((i) => (
                <li key={i.id} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">{i.beneficiaryName} · {i.title}{i.pending ? " (อนุมัติ + จ่าย)" : ""}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{baht(i.amount)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between border-t border-(--line) pt-2 text-sm font-bold">
              <span>รวม{holder ? ` จากเงินสดย่อยของ ${holder.name}` : " เงินสด"}</span>
              <span className="tabular-nums">{baht(total)}</span>
            </div>
            <p className="rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-xs text-(--ink-soft)">ไม่ต้องถ่ายรูป — ทั้ง {chosen.length} คนได้แจ้งเตือนให้กด “ได้รับเงินแล้ว” เป็นหลักฐาน</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAsking(false)} className="h-10 rounded-(--radius) border border-(--line) px-4 text-sm">กลับไปแก้</button>
              <button type="button" onClick={pay} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-(--radius) bg-(--brand-navy,#1b2537) px-4 text-sm font-semibold text-white disabled:opacity-50">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}ยืนยัน จ่าย
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
