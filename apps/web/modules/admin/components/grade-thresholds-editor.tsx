"use client";

import { useMemo, useState } from "react";
import { Plus, Sparkles, Undo2, X } from "lucide-react";
import { inputClass } from "@/modules/admin/components/ui";
import { PLUS_GRADE_PRESET, sameThresholds, type GradeThresholds } from "@/lib/grade-thresholds";

type Row = { name: string; min: string };

const toRows = (t: GradeThresholds): Row[] => t.map(([name, min]) => ({ name, min: String(min) }));

/**
 * เกณฑ์เกรด — เพิ่ม/ลบระดับได้ไม่จำกัด · ปุ่มชุดเกรดบวก (A+ … D ห่าง 5) · ดูช่วงคะแนนของแต่ละเกรดก่อนบันทึก
 * เปลี่ยนเกณฑ์แล้วเลือกได้ว่าเริ่มใช้รอบไหน (รอบก่อนหน้าคงเกรดเดิม — lib/grade-thresholds.ts)
 * ส่งค่าเป็น gradeName / gradeMin / gradeFrom ในฟอร์มเดิม (savePerformanceSettingsAction)
 */
export function GradeThresholdsEditor({
  initial,
  baseScore,
  currentRoundLabel,
  nextRoundLabel,
  historyNote,
}: {
  initial: GradeThresholds;
  baseScore: number;
  currentRoundLabel: string;
  nextRoundLabel: string;
  /** "รอบ ต.ค. 2569 และก่อนหน้าใช้เกณฑ์ชุดเดิม" — ว่าง = ไม่มีชุดเก่า */
  historyNote: string | null;
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));
  const [from, setFrom] = useState<"current" | "next" | "all">("current");

  const valid = useMemo(() => {
    const out: GradeThresholds = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const name = r.name.trim();
      const min = Number(r.min);
      if (!name || r.min.trim() === "" || !Number.isInteger(min) || seen.has(name)) continue;
      seen.add(name);
      out.push([name, min]);
    }
    return out.sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const dupes = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of rows) if (r.name.trim()) count.set(r.name.trim(), (count.get(r.name.trim()) ?? 0) + 1);
    return [...count].filter(([, n]) => n > 1).map(([k]) => k);
  }, [rows]);

  const changed = !sameThresholds(valid, initial);
  const hasF = valid.some(([g]) => g === "F");
  const lowest = valid[valid.length - 1];

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setRows(toRows(PLUS_GRADE_PRESET))}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-(--line) px-3 text-xs font-medium text-(--ink) hover:bg-(--bg-soft)"
        >
          <Sparkles className="h-3.5 w-3.5" /> ใช้ชุดเกรดบวก (A+ ถึง D ห่างกัน 5)
        </button>
        {changed && (
          <button
            type="button"
            onClick={() => setRows(toRows(initial))}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-(--line) px-3 text-xs text-(--ink-soft) hover:bg-(--bg-soft)"
          >
            <Undo2 className="h-3.5 w-3.5" /> กลับเป็นชุดที่ใช้อยู่
          </button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-[1fr_1fr_2.25rem] gap-2 px-0.5 text-[11px] text-(--ink-soft)">
            <span>ชื่อเกรด</span>
            <span>คะแนนขั้นต่ำ</span>
            <span />
          </div>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_2.25rem] gap-2">
              <input
                type="text"
                name="gradeName"
                value={row.name}
                onChange={(e) => update(i, { name: e.target.value })}
                maxLength={20}
                placeholder="ชื่อเกรด"
                aria-label={`ชื่อเกรดระดับที่ ${i + 1}`}
                className={inputClass}
              />
              <input
                type="number"
                name="gradeMin"
                value={row.min}
                onChange={(e) => update(i, { min: e.target.value })}
                min={0}
                max={1000}
                placeholder="คะแนนขั้นต่ำ"
                aria-label={`คะแนนขั้นต่ำระดับที่ ${i + 1}`}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                aria-label={`ลบเกรดระดับที่ ${i + 1}`}
                className="flex h-11 items-center justify-center rounded-lg text-(--ink-soft) hover:bg-(--bg-soft) hover:text-(--tone-danger)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, { name: "", min: "" }])}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed border-(--line) text-xs text-(--ink-soft) hover:bg-(--bg-soft)"
          >
            <Plus className="h-3.5 w-3.5" /> เพิ่มเกรด
          </button>
          {dupes.length > 0 && <p className="text-xs text-(--tone-danger)">ชื่อเกรดซ้ำกัน: {dupes.join(", ")} — แก้ก่อนบันทึก</p>}
        </div>

        <div className="rounded-xl border border-(--line) bg-(--bg-soft) p-3">
          <p className="mb-2 text-xs font-medium text-(--ink)">ช่วงคะแนนของแต่ละเกรด</p>
          <ul className="flex flex-col gap-1 text-xs">
            {valid.map(([g, min], i) => {
              const upper = i === 0 ? null : valid[i - 1]![1] - 1;
              return (
                <li key={g} className="flex items-center justify-between gap-2">
                  <span className="min-w-10 rounded-md bg-(--bg) px-1.5 py-0.5 text-center font-semibold text-(--ink)">{g}</span>
                  <span className="flex-1 text-right tabular-nums text-(--ink-soft)">
                    {upper === null ? `${min} ขึ้นไป` : upper <= min ? `${min}` : `${min} – ${upper}`}
                  </span>
                </li>
              );
            })}
            {!hasF && lowest && (
              <li className="flex items-center justify-between gap-2">
                <span className="min-w-10 rounded-md bg-(--bg) px-1.5 py-0.5 text-center font-semibold text-(--ink)">F</span>
                <span className="flex-1 text-right tabular-nums text-(--ink-soft)">ต่ำกว่า {lowest[1]}</span>
              </li>
            )}
          </ul>
          {valid[0] && valid[0][1] > baseScore && (
            <p className="mt-2 text-[11px] leading-relaxed text-(--ink-soft)">
              เกรด {valid[0][0]} ต้องได้เกิน {baseScore} คะแนนตั้งต้น — ได้เมื่อหัวหน้าให้คะแนนเพิ่มเท่านั้น
            </p>
          )}
        </div>
      </div>

      {changed ? (
        <fieldset className="rounded-xl border border-(--line) p-3">
          <legend className="px-1 text-xs font-medium text-(--ink)">เกณฑ์ใหม่เริ่มใช้รอบไหน</legend>
          <div className="flex flex-col gap-1.5 text-sm text-(--ink)">
            {(
              [
                ["current", `รอบนี้ (${currentRoundLabel}) — รอบก่อนหน้าคงเกรดเดิม`],
                ["next", `รอบหน้า (${nextRoundLabel}) — รอบนี้ยังใช้เกณฑ์เดิม`],
                ["all", "ทุกรอบ รวมรอบที่ผ่านมา — เกรดและค่าคอมย้อนหลังเปลี่ยนตาม"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-start gap-2">
                <input type="radio" name="gradeFrom" value={value} checked={from === value} onChange={() => setFrom(value)} className="mt-1 h-4 w-4" />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-(--ink-soft)">
            อย่าลืมไปตั้งตัวคูณค่าคอมของเกรดใหม่ที่ เงินเดือน › ค่าคอม — เกรดที่ยังไม่ได้ตั้งจะใช้ค่าตั้งต้นของระบบ
          </p>
        </fieldset>
      ) : (
        <input type="hidden" name="gradeFrom" value="current" />
      )}
      {historyNote && <p className="text-[11px] text-(--ink-soft)">{historyNote}</p>}
    </div>
  );
}
