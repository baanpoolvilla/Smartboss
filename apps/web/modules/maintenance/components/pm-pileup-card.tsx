"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Layers } from "lucide-react";

import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { decidePileupAction, mergePileupAction, type MergeScore } from "@/app/(shell)/maintenance/pm/rounds/actions";

import { useCeoTitle } from "@/lib/ceo-title-client";
export interface PileupRoundView {
  id: string;
  code: string;
  roundLabel: string;
  lateDays: number;
  docked: number;
  assigneeName: string;
  waived: boolean;
}

/**
 * PM ค้างหลายรอบ 1 แผน — CEO เลือกทีละรอบ (ต้องทำ/ไม่ต้องทำ · หัก/ไม่หัก) หรือรวบเป็นใบเดียว
 * สีที่เลือกอยู่ใช้ navy ไม่ใช่เขียว (เขียว = เสร็จ)
 */
export function PmPileupCard({
  pmId,
  title,
  subtitle,
  rounds,
  minDate,
}: {
  pmId: string;
  title: string;
  subtitle: string;
  rounds: PileupRoundView[];
  minDate: string;
}) {
  const ceo = useCeoTitle();
  const [skip, setSkip] = useState<Record<string, boolean>>({});
  const [waive, setWaive] = useState<Record<string, boolean>>(() => Object.fromEntries(rounds.map((r) => [r.id, r.waived])));
  const [merging, setMerging] = useState(false);
  const [due, setDue] = useState("");
  const [score, setScore] = useState<MergeScore>("one");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const skipped = rounds.filter((r) => skip[r.id]).length;
  const waivedCount = rounds.filter((r) => waive[r.id]).length;
  const perDock = Math.min(...rounds.map((r) => r.docked).filter((n) => n < 0), 0);

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await decidePileupAction(pmId, rounds.map((x) => ({ woId: x.id, skip: !!skip[x.id], waive: !!waive[x.id] })));
      setMsg(r.error ?? "บันทึกแล้ว");
    });
  const merge = () =>
    start(async () => {
      setMsg(null);
      const r = await mergePileupAction({ pmId, woIds: rounds.map((x) => x.id), dueDate: due, score, note });
      setMsg(r.error ?? `รวบแล้ว → ${r.code}`);
    });

  return (
    <section className="overflow-hidden rounded-(--radius) border border-(--line) bg-(--bg)">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-(--line) px-4 py-3">
        <div>
          <h3 className="m-0 flex items-center gap-2 text-[15px] font-semibold text-(--ink)">
            {title}
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11.5px] font-semibold text-red-700">ค้าง {rounds.length} รอบ</span>
          </h3>
          <p className="m-0 text-xs text-(--ink-soft)">{subtitle}</p>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13.5px]">
          <thead>
            <tr className="bg-(--bg-soft) text-left text-xs text-(--ink-soft)">
              <th className="px-4 py-2 font-semibold">รอบ</th>
              <th className="px-4 py-2 font-semibold">ใบงาน</th>
              <th className="px-4 py-2 font-semibold">สถานะ</th>
              <th className="px-4 py-2 font-semibold">คะแนน</th>
              <th className="px-4 py-2 font-semibold">ต้องทำไหม</th>
              <th className="px-4 py-2 font-semibold">หักคะแนน</th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((r) => (
              <tr key={r.id} className="border-t border-(--line)">
                <td className="px-4 py-2.5 font-semibold">{r.roundLabel}</td>
                <td className="px-4 py-2.5">
                  <Link href={`/maintenance/work-orders/${r.id}`} className="text-(--brand-navy) hover:underline">{r.code}</Link>
                  <div className="text-xs text-(--ink-soft)">{r.assigneeName}</div>
                </td>
                <td className="px-4 py-2.5">
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11.5px] font-semibold text-red-700">เลย {r.lateDays} วัน</span>
                </td>
                <td className="px-4 py-2.5 text-(--ink-soft)">{r.docked < 0 ? `${r.docked} หักแล้ว` : "ยังไม่หัก"}</td>
                <td className="px-4 py-2.5">
                  <Seg
                    label={`ต้องทำรอบ ${r.roundLabel} ไหม`}
                    options={[{ v: false, t: "ต้องทำ" }, { v: true, t: "ไม่ต้องทำ" }]}
                    value={!!skip[r.id]}
                    onChange={(v) => setSkip((m) => ({ ...m, [r.id]: v }))}
                  />
                </td>
                <td className="px-4 py-2.5">
                  <Seg
                    label={`หักคะแนนรอบ ${r.roundLabel} ไหม`}
                    options={[{ v: false, t: "หัก" }, { v: true, t: "ไม่หัก" }]}
                    value={!!waive[r.id]}
                    onChange={(v) => setWaive((m) => ({ ...m, [r.id]: v }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-(--line) bg-(--bg-soft) px-4 py-3">
        <span className="text-xs text-(--ink-soft)">
          {skipped > 0 ? `ยกเลิก ${skipped} ใบ` : "ยังไม่ยกเลิกใบไหน"} · {waivedCount > 0 ? `ไม่หัก ${waivedCount} รอบ` : "หักตามปกติทุกรอบ"}
          {msg && <b className="ml-2 text-(--ink)">{msg}</b>}
        </span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMerging((v) => !v)}
            aria-expanded={merging}
            className="inline-flex items-center gap-1.5 rounded-(--radius) border border-(--brand-navy) bg-(--brand-navy) px-3 py-1.5 text-sm font-semibold text-white"
          >
            <Layers className="h-4 w-4" aria-hidden="true" /> รวบ {rounds.length} รอบเป็นใบเดียว
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-(--radius) bg-(--brand-green) px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            บันทึกตามที่เลือก
          </button>
        </div>
      </footer>

      {merging && (
        <div className="flex flex-col gap-3 border-t border-(--line) px-4 py-4">
          <b className="text-sm">รวบ {rounds.length} รอบเป็นใบเดียว: ช่างทำครั้งเดียว ใบเดิมยกเลิกและชี้ไปใบรวม</b>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-(--ink-soft)">กำหนดส่งใบรวม</span>
            <DatePickerField value={due} minDate={minDate} onChange={setDue} className="h-10 max-w-56" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-(--ink-soft)">หักคะแนน {rounds.length} รอบที่ค้าง</span>
            <Seg
              label="หักคะแนนรอบที่รวบ"
              options={[
                { v: "all" as MergeScore, t: `หักทุกรอบ${perDock ? ` (${perDock * rounds.length})` : ""}` },
                { v: "one" as MergeScore, t: `หักรอบเดียว${perDock ? ` (${perDock})` : ""}` },
                { v: "none" as MergeScore, t: "ไม่หัก" },
              ]}
              value={score}
              onChange={setScore}
            />
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-(--ink-soft)">หมายเหตุ {ceo} (ช่างเห็นในใบงาน)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={1000}
              className="rounded-(--radius) border border-(--line) px-3 py-2 text-sm"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setMerging(false)} className="rounded-(--radius) border border-(--line) px-3 py-1.5 text-sm">ยกเลิก</button>
            <button
              type="button"
              onClick={merge}
              disabled={pending || !due}
              className="rounded-(--radius) bg-(--brand-navy) px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              รวบเป็นใบเดียว
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Seg<T>({ label, options, value, onChange }: { label: string; options: { v: T; t: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-fit gap-0.5 rounded-(--radius) border border-(--line) bg-(--bg-soft) p-0.5">
      {options.map((o) => (
        <button
          key={o.t}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={
            value === o.v
              ? "whitespace-nowrap rounded-[calc(var(--radius)-2px)] bg-(--bg) px-2.5 py-0.5 text-[12.5px] font-semibold text-(--brand-navy) shadow-sm"
              : "whitespace-nowrap rounded-[calc(var(--radius)-2px)] px-2.5 py-0.5 text-[12.5px] text-(--ink-soft)"
          }
        >
          {o.t}
        </button>
      ))}
    </div>
  );
}
