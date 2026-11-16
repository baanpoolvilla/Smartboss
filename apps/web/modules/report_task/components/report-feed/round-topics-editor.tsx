"use client";

import { ArrowUp, Plus, X } from "lucide-react";
import { formatTemplate, KEYWORD_MARK, topicKeywords, topicNames } from "@/modules/report_task/lib/report-format";

/**
 * ตั้งหัวข้อรายงานของรอบแบบเป็นแถว ๆ (16/11/2569 ผู้ใช้: กล่องข้อความ + สัญลักษณ์ 🏁 / | "ใช้ยาก ดูแปลก")
 * ไม่ต้องรู้สัญลักษณ์: แต่ละแถวเป็น "หมวด" หรือ "หัวข้อ" · หัวข้อมีช่องคำหลัก (คำที่นับว่าใช่ แม้ชื่อไม่ตรงตัว)
 * เก็บลงที่เดิม (requiredTopics) ในรูปแบบเดิม: หมวด = "🏁ชื่อ🏁" · หัวข้อ = "ชื่อ | ชื่อเรียกอื่นเดิม | ~คำหลัก"
 * — รอบที่ตั้งไว้ก่อนหน้าเปิดมาแก้ได้ ไม่ต้องตั้งใหม่ (ชื่อเรียกอื่นแบบเดิมเก็บไว้ให้เหมือนเดิม แค่ไม่โชว์)
 */
export interface TopicRow {
  kind: "section" | "topic";
  name: string;
  /** คั่นด้วย , */
  keywords: string;
  /** ชื่อเรียกอื่นแบบเดิม ("|") — ไม่โชว์แต่ไม่ทิ้ง */
  aliases: string[];
}

export function rowsFromTopics(topics: readonly string[] | undefined): TopicRow[] {
  return (topics ?? []).map((line) => {
    const section = line.includes("🏁");
    const names = topicNames(line).map((n) => n.replace(/🏁/g, "").trim()).filter(Boolean);
    return { kind: section ? "section" : "topic", name: names[0] ?? "", keywords: topicKeywords(line).join(", "), aliases: names.slice(1) };
  });
}

export function topicsFromRows(rows: readonly TopicRow[]): string[] {
  return rows
    .filter((r) => r.name.trim())
    .map((r) => {
      const name = r.name.replace(/[🏁|~]/g, "").trim();
      if (r.kind === "section") return `🏁${name}🏁`;
      const kws = r.keywords
        .split(/[,，]/)
        .map((k) => k.replace(/[|~]/g, "").trim())
        .filter(Boolean)
        .map((k) => `${KEYWORD_MARK}${k}`);
      return [name, ...r.aliases, ...kws].join(" | ");
    });
}

/** แบบสำเร็จรูป Common Report — คำหลักมาจากชื่อที่พนักงานใช้จริงในรายงาน 12–16 พ.ย. */
export const COMMON_REPORT_ROWS: TopicRow[] = [
  { kind: "section", name: "Common Report", keywords: "", aliases: [] },
  { kind: "topic", name: "วันนี้ส่งงานอะไร", keywords: "ส่งงาน, ทำงานอะไร, งานที่ทำ", aliases: [] },
  { kind: "topic", name: "งานที่ล่าช้า ผิดพลาด ไม่เป็นไปตามแผน", keywords: "ล่าช้า, ผิดแผน, งานค้าง", aliases: [] },
  { kind: "topic", name: "ปัญหาและความเสี่ยง", keywords: "ปัญหา, ความเสี่ยง, อุปสรรค", aliases: [] },
  { kind: "topic", name: "วิธีแก้ไขและความรับผิดชอบ", keywords: "วิธีแก้, แก้ไข", aliases: [] },
  { kind: "topic", name: "เรื่องที่ต้องการให้ Boss ตัดสินใจ", keywords: "ตัดสินใจ", aliases: [] },
  { kind: "section", name: "Department Module", keywords: "", aliases: [] },
];

const field = "h-9 w-full min-w-0 rounded-md border border-[var(--line)] bg-white px-2.5 text-sm outline-none focus:border-[var(--brand-navy)]";

export function RoundTopicsEditor({
  rows,
  onChange,
  requireColor,
  onRequireColor,
}: {
  rows: TopicRow[];
  onChange: (rows: TopicRow[]) => void;
  requireColor: boolean;
  onRequireColor: (v: boolean) => void;
}) {
  const set = (i: number, patch: Partial<TopicRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number) => {
    if (i === 0) return;
    const next = rows.slice();
    [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
    onChange(next);
  };
  const template = formatTemplate(topicsFromRows(rows), requireColor).trim();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--ink-soft)]">เริ่มจากแบบสำเร็จรูป:</span>
        <button type="button" onClick={() => onChange(COMMON_REPORT_ROWS.map((r) => ({ ...r })))} className="h-8 rounded-full border border-[var(--brand-navy)] bg-white px-3 text-xs font-semibold text-[var(--brand-navy)]">
          Common Report (5 หัวข้อ)
        </button>
        {rows.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="h-8 rounded-full border border-[var(--line)] bg-white px-3 text-xs">
            ล้างทั้งหมด
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--line)] px-3 py-4 text-center text-xs text-[var(--ink-soft)]">ยังไม่มีหัวข้อ — กดแบบสำเร็จรูปด้านบน หรือเพิ่มเองด้านล่าง</p>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={i} className={r.kind === "section" ? "pt-1.5" : "pl-5"}>
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-12 shrink-0 rounded-full py-0.5 text-center text-[11px] ${r.kind === "section" ? "bg-[var(--brand-navy)] font-semibold text-white" : "bg-[var(--bg-soft)] text-[var(--ink)]"}`}
                >
                  {r.kind === "section" ? "หมวด" : "หัวข้อ"}
                </span>
                <input
                  value={r.name}
                  onChange={(e) => set(i, { name: e.target.value })}
                  placeholder={r.kind === "section" ? "ชื่อหมวด เช่น Common Report" : "ชื่อหัวข้อ เช่น ปัญหาและความเสี่ยง"}
                  aria-label={r.kind === "section" ? "ชื่อหมวด" : "ชื่อหัวข้อ"}
                  maxLength={80}
                  className={field}
                />
                <button type="button" onClick={() => move(i)} disabled={i === 0} aria-label="เลื่อนขึ้น" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-white disabled:opacity-30">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="ลบ" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-white text-[var(--danger)]">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {r.kind === "topic" && (
                <label className="mt-1 flex items-center gap-1.5 pl-[3.375rem] pr-[4.875rem] text-[11px] text-[var(--ink-soft)]">
                  <span className="shrink-0">คำที่นับว่าใช่</span>
                  <input
                    value={r.keywords}
                    onChange={(e) => set(i, { keywords: e.target.value })}
                    placeholder="เช่น ล่าช้า, ผิดแผน (ไม่ใส่ = ต้องเขียนชื่อตรง)"
                    aria-label={`คำที่นับว่าใช่ของ ${r.name || "หัวข้อนี้"}`}
                    className="h-7 w-full min-w-0 rounded-md border border-[var(--line)] bg-white px-2 text-xs outline-none focus:border-[var(--brand-navy)]"
                  />
                </label>
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={() => onChange([...rows, { kind: "topic", name: "", keywords: "", aliases: [] }])} className="inline-flex h-8 items-center gap-1 rounded-lg border border-dashed border-[var(--ink-faint,#9aa6bb)] bg-white px-3 text-xs text-[var(--brand-navy)]">
          <Plus className="h-3.5 w-3.5" /> หัวข้อ
        </button>
        <button type="button" onClick={() => onChange([...rows, { kind: "section", name: "", keywords: "", aliases: [] }])} className="inline-flex h-8 items-center gap-1 rounded-lg border border-dashed border-[var(--ink-faint,#9aa6bb)] bg-white px-3 text-xs text-[var(--brand-navy)]">
          <Plus className="h-3.5 w-3.5" /> หมวด (หัวข้อใหญ่)
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--ink-soft)]">
        <b className="text-[var(--ink)]">หมวด</b> = หัวข้อใหญ่ที่ต้องมีและมีเนื้อหาข้างใต้ (ไม่ต้องใส่สี) · <b className="text-[var(--ink)]">หัวข้อ</b> = เรื่องที่ต้องเขียน ·{" "}
        <b className="text-[var(--ink)]">คำที่นับว่าใช่</b> = ถ้าบรรทัดหัวข้อมีคำนี้ช่วงต้นบรรทัด นับว่าเป็นหัวข้อนี้ แม้ชื่อไม่ตรงตัว (เช่น &quot;งานล่าช้า/ผิดแผน&quot;) · คำเดียวกันในเนื้อหายาว ๆ ไม่นับ
      </p>

      <label className="flex items-center gap-2 border-t border-[var(--line)] pt-3 text-sm">
        <input type="checkbox" checked={requireColor} onChange={(e) => onRequireColor(e.target.checked)} className="h-4 w-4 accent-[var(--brand-navy)]" />
        ทุกหัวข้อต้องมีสีสถานะนำหน้า 🔴 🟡 🟢
      </label>

      {template && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-[var(--ink)]">แม่แบบที่พนักงานจะได้ (ปุ่ม &quot;ใส่หัวข้อที่ขาดให้&quot;)</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] px-3 py-2 font-sans text-xs leading-relaxed text-[var(--ink)]">{template}</pre>
        </div>
      )}
    </div>
  );
}
