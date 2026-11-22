"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Sparkles, Undo2, X } from "lucide-react";
import { inputClass } from "@/modules/admin/components/ui";
import { PLUS_GRADE_PRESET, halfStepWeights, type GradeThresholds } from "@/lib/grade-thresholds";

type Row = { name: string; min: string; comm: string };

/** คอลัมน์ค่าคอมต่อเกรด — null = บริษัทไม่คิดค่าคอมจากเกรด หรือคนนี้ไม่มีสิทธิ์แก้เงินเดือน */
export interface GradeCommissionProps {
  label: string;
  /** ตัวคูณ (แบ่งก้อน) — true = ปุ่มชุดเกรดบวกเติมไล่ทีละ 0.5 ให้ด้วย */
  isWeight: boolean;
  values: Record<string, number>;
  unset: string[];
}

const BELOW = "F";

/**
 * เกณฑ์เกรด + ค่าคอมของแต่ละเกรดในตารางเดียว — เพิ่ม/ลบ/แก้แล้วบันทึกครั้งเดียว มีผลทั้งเกรด ค่าคอม และเงินเดือน
 * (เงินเดือนดึงค่าคอมจากที่เดียวกัน) · กดบันทึกแล้วขึ้นสรุปสิ่งที่เปลี่ยนให้ยืนยันก่อน
 * ส่งค่าเป็น gradeName / gradeMin / gradeComm / gradeCommF / gradeFrom ในฟอร์มเดิม (savePerformanceSettingsAction)
 */
export function GradeThresholdsEditor({
  initial,
  baseScore,
  currentRoundLabel,
  nextRoundLabel,
  historyNote,
  commission,
  commissionNote,
}: {
  initial: GradeThresholds;
  baseScore: number;
  currentRoundLabel: string;
  nextRoundLabel: string;
  historyNote: string | null;
  commission: GradeCommissionProps | null;
  /** บอกเหตุผลที่ไม่มีคอลัมน์ค่าคอม (ไม่มีสิทธิ์ / ไม่คิดจากเกรด) */
  commissionNote: string | null;
}) {
  const initialRows = useMemo<Row[]>(
    () => initial.filter(([n]) => n !== BELOW).map(([name, min]) => ({ name, min: String(min), comm: commission ? String(commission.values[name] ?? "") : "" })),
    [initial, commission],
  );
  const initialF = commission ? String(commission.values[BELOW] ?? 0) : "";
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [fComm, setFComm] = useState(initialF);
  const [from, setFrom] = useState<"current" | "next" | "all">("current");
  const [asking, setAsking] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const confirmedRef = useRef(false);

  const filled = rows.filter((r) => r.name.trim() || r.min.trim());
  const valid = useMemo(() => {
    const out: GradeThresholds = [];
    for (const r of filled) {
      const min = Number(r.min);
      if (r.name.trim() && r.min.trim() !== "" && Number.isInteger(min)) out.push([r.name.trim(), min]);
    }
    return out.sort((a, b) => b[1] - a[1]);
  }, [filled]);

  // ── สิ่งที่ผิด (บันทึกไม่ได้) ──
  const problems: string[] = [];
  const names = filled.map((r) => r.name.trim()).filter(Boolean);
  const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  if (dupes.length) problems.push(`ชื่อเกรดซ้ำกัน: ${dupes.join(", ")}`);
  if (filled.some((r) => !r.name.trim() || r.min.trim() === "")) problems.push("มีแถวที่กรอกไม่ครบ (ต้องมีทั้งชื่อเกรดและคะแนนขั้นต่ำ) — ลบแถวนั้นหรือกรอกให้ครบ");
  if (names.includes(BELOW)) problems.push(`ไม่ต้องใส่เกรด ${BELOW} ในตาราง — คนที่ต่ำกว่าทุกเกณฑ์ได้ ${BELOW} อยู่แล้ว (แถวล่างสุด)`);
  const mins = valid.map(([, m]) => m);
  if (new Set(mins).size !== mins.length) problems.push("มีสองเกรดใช้คะแนนขั้นต่ำเท่ากัน");
  if (valid.length === 0) problems.push("ต้องมีอย่างน้อยหนึ่งเกรด");
  if (commission) {
    const blank = filled.filter((r) => r.name.trim() && r.comm.trim() === "").map((r) => r.name.trim());
    if (fComm.trim() === "") blank.push(BELOW);
    if (blank.length) problems.push(`ยังไม่ได้ใส่${commission.label}ของเกรด ${blank.join(", ")}`);
  }

  // ── สิ่งที่เปลี่ยน (โชว์ให้ยืนยัน) ──
  const initMap = new Map(initial.filter(([n]) => n !== BELOW));
  const nowMap = new Map(valid);
  const added = valid.filter(([n]) => !initMap.has(n));
  const removed = [...initMap].filter(([n]) => !nowMap.has(n));
  const moved = valid.filter(([n, m]) => initMap.has(n) && initMap.get(n) !== m);
  const commChanged = commission
    ? [
        ...filled.filter((r) => r.name.trim() && initMap.has(r.name.trim()) && String(commission.values[r.name.trim()] ?? "") !== r.comm.trim()),
        ...(fComm.trim() !== initialF ? [{ name: BELOW, comm: fComm }] : []),
      ].map((r) => ({ name: r.name.trim(), from: commission.values[r.name.trim()], to: r.comm.trim() }))
    : [];
  const gradesChanged = added.length + removed.length + moved.length > 0;
  const dirty = gradesChanged || commChanged.length > 0;

  // กดปุ่มบันทึกของฟอร์ม → ถ้าแก้เกรด/ค่าคอม ขึ้นสรุปให้ยืนยันก่อน
  // ฟังที่ window (capture) ให้มาก่อนตัวกันกดซ้ำ components/shell/save-feedback.tsx (capture ที่ document):
  // ถ้าให้ตัวนั้นเห็น submit ที่เราหยุดไว้ มันจะล็อกฟอร์ม 3 วินาที → กด "กลับไปแก้" แล้วกดบันทึกใหม่เร็ว ๆ ไม่มีอะไรเกิดขึ้น
  useEffect(() => {
    const form = wrapRef.current?.closest("form");
    if (!form) return;
    const onSubmit = (e: SubmitEvent) => {
      if (e.target !== form || confirmedRef.current || !dirty) return;
      e.preventDefault();
      e.stopPropagation();
      setAsking(true);
    };
    window.addEventListener("submit", onSubmit, true);
    return () => window.removeEventListener("submit", onSubmit, true);
  }, [dirty]);

  const confirmSave = () => {
    const form = wrapRef.current?.closest("form");
    if (!form || problems.length) return;
    confirmedRef.current = true;
    setAsking(false);
    form.requestSubmit(); // ส่ง submit event ทันที (sync) — ปล่อยธงหลังจากนั้น บันทึกไม่ผ่านแล้วกดใหม่ยังถามอีก
    confirmedRef.current = false;
  };

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const applyPreset = () => {
    const w = commission?.isWeight ? halfStepWeights([...PLUS_GRADE_PRESET.map(([g]) => g), BELOW]) : null;
    setRows(
      PLUS_GRADE_PRESET.map(([name, min]) => ({
        name,
        min: String(min),
        comm: commission ? String(w ? w[name] : (rows.find((r) => r.name.trim() === name)?.comm ?? "")) : "",
      })),
    );
    if (w) setFComm("0");
  };
  const revert = () => {
    setRows(initialRows);
    setFComm(initialF);
  };

  const cols = commission ? "grid-cols-[1fr_1fr_1fr_2.75rem]" : "grid-cols-[1fr_1fr_2.75rem]";
  const lowest = valid[valid.length - 1];
  const fmtComm = (v: number | undefined) => (v === undefined ? "ยังไม่ได้ตั้ง" : String(v));

  return (
    <div ref={wrapRef} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={applyPreset}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-(--line) px-3 text-xs font-medium text-(--ink) hover:bg-(--bg-soft)"
        >
          <Sparkles className="h-3.5 w-3.5" /> ใช้ชุดเกรดบวก (A+ ถึง D ห่างกัน 5{commission?.isWeight ? " · ตัวคูณไล่ทีละ 0.5" : ""})
        </button>
        {dirty && (
          <button
            type="button"
            onClick={revert}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-(--line) px-3 text-xs text-(--ink-soft) hover:bg-(--bg-soft)"
          >
            <Undo2 className="h-3.5 w-3.5" /> ยกเลิกที่แก้ กลับเป็นชุดที่ใช้อยู่
          </button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,17rem)]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className={`grid ${cols} gap-2 px-0.5 text-[11px] text-(--ink-soft)`}>
            <span>ชื่อเกรด</span>
            <span>คะแนนขั้นต่ำ</span>
            {commission && <span>{commission.label}</span>}
            <span />
          </div>
          {rows.map((row, i) => (
            <div key={i} className={`grid ${cols} gap-2`}>
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
              {commission && (
                <input
                  type="text"
                  inputMode="decimal"
                  name="gradeComm"
                  value={row.comm}
                  onChange={(e) => update(i, { comm: e.target.value })}
                  placeholder="เช่น 4"
                  aria-label={`${commission.label}ของเกรดระดับที่ ${i + 1}`}
                  className={inputClass}
                />
              )}
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
          <div className={`grid ${cols} items-center gap-2`}>
            <span className="flex h-11 items-center rounded-lg border border-dashed border-(--line) px-3 text-sm font-medium text-(--ink)">{BELOW}</span>
            <span className="px-1 text-xs text-(--ink-soft)">{lowest ? `ต่ำกว่า ${lowest[1]}` : "ต่ำกว่าทุกเกณฑ์"}</span>
            {commission && (
              <input
                type="text"
                inputMode="decimal"
                name="gradeCommF"
                value={fComm}
                onChange={(e) => setFComm(e.target.value)}
                aria-label={`${commission.label}ของเกรด ${BELOW}`}
                className={inputClass}
              />
            )}
            <span />
          </div>
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, { name: "", min: "", comm: "" }])}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed border-(--line) text-xs text-(--ink-soft) hover:bg-(--bg-soft)"
          >
            <Plus className="h-3.5 w-3.5" /> เพิ่มเกรด
          </button>
          {problems.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-(--tone-danger)">
              {problems.map((p) => (
                <li key={p}>• {p}</li>
              ))}
            </ul>
          )}
          {commission && commission.unset.length > 0 && !dirty && (
            <p className="text-xs text-(--tone-warn)">
              ⚠ {commission.label}ของเกรด {commission.unset.join(", ")} ยังไม่เคยบันทึก — ตอนนี้ใช้ค่าตั้งต้นของระบบ (ตัวเลขในช่อง) ตรวจแล้วกดบันทึก
            </p>
          )}
          {commissionNote && <p className="text-xs text-(--ink-soft)">{commissionNote}</p>}
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
            {lowest && (
              <li className="flex items-center justify-between gap-2">
                <span className="min-w-10 rounded-md bg-(--bg) px-1.5 py-0.5 text-center font-semibold text-(--ink)">{BELOW}</span>
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

      {gradesChanged ? (
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
        </fieldset>
      ) : (
        <input type="hidden" name="gradeFrom" value="current" />
      )}
      {historyNote && <p className="text-[11px] text-(--ink-soft)">{historyNote}</p>}

      {asking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="grade-confirm-title">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-2xl border border-(--line) bg-(--bg) p-5 shadow-xl">
            <h3 id="grade-confirm-title" className="text-base font-semibold text-(--ink)">ยืนยันการเปลี่ยนเกรด</h3>
            <ul className="flex flex-col gap-1.5 text-sm text-(--ink)">
              {added.map(([g, m]) => (
                <li key={`a-${g}`}>➕ เพิ่มเกรด <b>{g}</b> คะแนนตั้งแต่ {m}</li>
              ))}
              {removed.map(([g]) => (
                <li key={`r-${g}`}>➖ ลบเกรด <b>{g}</b> — คนที่เคยได้เกรดนี้จะได้เกรดถัดลงไป</li>
              ))}
              {moved.map(([g, m]) => (
                <li key={`m-${g}`}>✏️ เกรด <b>{g}</b> คะแนนขั้นต่ำ {initMap.get(g)} → {m}</li>
              ))}
              {commission &&
                added.map(([g]) => (
                  <li key={`ac-${g}`}>💰 {commission.label} <b>{g}</b> = {rows.find((r) => r.name.trim() === g)?.comm || "—"}</li>
                ))}
              {commChanged.map((c) => (
                <li key={`c-${c.name}`}>💰 {commission?.label} <b>{c.name}</b> {fmtComm(c.from)} → {c.to}</li>
              ))}
            </ul>
            {gradesChanged && (
              <p className="rounded-lg bg-(--bg-soft) px-3 py-2 text-xs text-(--ink-soft)">
                เริ่มใช้: {from === "current" ? `รอบนี้ (${currentRoundLabel})` : from === "next" ? `รอบหน้า (${nextRoundLabel})` : "ทุกรอบ รวมรอบที่ผ่านมา (ย้อนหลังเปลี่ยนตาม)"}
              </p>
            )}
            <p className="text-xs text-(--ink-soft)">มีผลกับหน้าคะแนน ค่าคอม และค่าคอมในงวดเงินเดือนที่ยังไม่ได้ส่ง</p>
            {problems.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-xs text-(--tone-danger)">
                {problems.map((p) => (
                  <li key={p}>• {p}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button type="button" onClick={() => setAsking(false)} className="h-10 rounded-lg border border-(--line) px-4 text-sm text-(--ink) hover:bg-(--bg-soft)">
                กลับไปแก้
              </button>
              <button
                type="button"
                onClick={confirmSave}
                disabled={problems.length > 0}
                className="h-10 rounded-lg bg-(--brand-navy,#22345c) px-4 text-sm font-medium text-white disabled:opacity-40"
              >
                ยืนยัน บันทึก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
