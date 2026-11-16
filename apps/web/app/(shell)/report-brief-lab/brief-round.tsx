"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { briefInternals as I } from "./brief-lab";

/**
 * ⚠ ตัวอย่างทดลอง — "รอบนี้มีอะไร" แบ่งตามประเภทเรื่อง (ผู้ใช้ 12/11: อยากรู้เลยว่ารอบนี้มีอะไร แบบไหน ปัญหายังไง)
 * กล่องนับ 4 ประเภท → แตะกล่อง = รายการของประเภทนั้น บรรทัดละเรื่อง: สี · ใคร · เรื่องอะไร
 * สีและประเภท = ระบบอ่านจากหัวข้อที่คนเขียน (ไม่ใช่ AI เดา) · ใจความสั้น = AI ย่อ
 */

type Kind = "stuck" | "late" | "ask" | "done";
const KINDS: { id: Kind; icon: string; label: string; empty: string }[] = [
  { id: "stuck", icon: "⚠️", label: "ปัญหา / ความเสี่ยง", empty: "ไม่มีใครแจ้งปัญหา" },
  { id: "late", icon: "⏰", label: "ล่าช้า / ค้าง", empty: "ไม่มีงานล่าช้า" },
  { id: "ask", icon: "🙋", label: "รอคุณตัดสินใจ", empty: "ไม่มีเรื่องรอคุณ" },
  { id: "done", icon: "✅", label: "เสร็จแล้ว", empty: "—" },
];

function buildRound(round: "eve" | "morn") {
  const { PARSED, SHORT, colorOfTopic, RANK, NONE, isMorning, bucketOf } = I;
  const day = round === "eve" ? "2026-11-10" : "2026-11-11";
  const reps = PARSED.filter((r) => r.day === day && (round === "eve" ? !isMorning(r) : isMorning(r)));
  const items: Record<Kind, { n: number; text: string; color: string }[]> = { stuck: [], late: [], ask: [], done: [] };
  for (const r of reps) {
    for (const t of SHORT[r.n]?.topics ?? []) {
      const b = bucketOf(t.topic);
      if (!b || b === "plan" || NONE.test(t.short.trim()) || /^ไม่มี/.test(t.short.trim())) continue;
      items[b as Kind].push({ n: r.n, text: t.short, color: colorOfTopic(r.text, t.topic) });
    }
  }
  for (const k of Object.keys(items) as Kind[]) items[k].sort((a, b) => RANK[a.color]! - RANK[b.color]!);
  return { day, reps, items };
}

export function BriefRoundCard() {
  const { thDay, personName, LIGHT, Source, D, clean } = I;
  const [round, setRound] = useState<"eve" | "morn">("eve");
  const b = buildRound(round);
  const [kind, setKind] = useState<Kind>("stuck");
  const [src, setSrc] = useState<number | null>(null);
  const [showQa, setShowQa] = useState(false);
  const [more, setMore] = useState(false);
  const list = b.items[kind];
  const headline = clean(round === "eve" ? D.eve.headline : D.morn.headline).replace(/\s*\(#.*$/, "");
  const reds = (k: Kind) => b.items[k].filter((i) => i.color === "red").length;
  return (
    <div className="mx-3 mt-2 sm:mx-5">
      <div className="max-h-[66vh] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--bg)] shadow-sm">
        {/* หัว: รอบไหน ส่งกี่คน ภาพรวม 1 ประโยค */}
        <div className="flex items-start gap-3 px-4 pt-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-navy)] text-white"><Sparkles className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <b className="text-[15px] text-[var(--ink)]">สรุปรอบ{round === "eve" ? "เย็น" : "เช้า"} · {thDay(b.day)}</b>
              <span className="text-xs text-[var(--ink-soft)]">ส่งแล้ว {b.reps.length} คน · ยังไม่ส่ง: <i>(ของจริงขึ้นชื่อ)</i></span>
              <span className="ml-auto flex gap-1">
                {(["morn", "eve"] as const).map((r) => (
                  <button key={r} type="button" onClick={() => setRound(r)}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] ${round === r ? "border-[var(--brand-navy)] bg-[var(--brand-navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                    รอบ{r === "eve" ? "เย็น" : "เช้า"}
                  </button>
                ))}
              </span>
            </div>
            <p className="mt-1 text-[14px] leading-snug text-[var(--ink)]">{headline}</p>
          </div>
        </div>

        {/* กล่องนับ 4 ประเภท */}
        <div className="grid grid-cols-2 gap-2 px-4 pt-3 sm:grid-cols-4">
          {KINDS.map((k) => {
            const on = kind === k.id;
            const n = b.items[k.id].length;
            const red = reds(k.id);
            return (
              <button key={k.id} type="button" onClick={() => { setKind(k.id); setMore(false); }}
                className={`flex flex-col items-start gap-0.5 rounded-lg border-2 px-3 py-2 text-left transition-colors ${on ? "border-[var(--brand-navy)] bg-[var(--bg-soft)]" : "border-[var(--line)] hover:bg-[var(--bg-soft)]"}`}>
                <span className="text-xs text-[var(--ink-soft)]">{k.icon} {k.label}</span>
                <span className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold text-[var(--ink)]">{n}</span>
                  <span className="text-xs text-[var(--ink-soft)]">เรื่อง</span>
                  {red > 0 && <span className="rounded bg-[var(--bg-soft)] px-1 text-[11px] font-semibold text-[var(--tone-danger)]">🔴 {red}</span>}
                </span>
              </button>
            );
          })}
        </div>

        {/* รายการของประเภทที่เลือก */}
        <div className="px-4 pb-2 pt-3">
          <p className="mb-1 text-xs font-semibold text-[var(--ink-soft)]">{KINDS.find((k) => k.id === kind)!.icon} {KINDS.find((k) => k.id === kind)!.label} · เรียงแดงก่อน</p>
          {list.length === 0 && <p className="py-2 text-sm text-[var(--ink-soft)]">{KINDS.find((k) => k.id === kind)!.empty}</p>}
          <div className="flex flex-col divide-y divide-[var(--line)]">
            {(more ? list : list.slice(0, 5)).map((it, i) => (
              <button key={i} type="button" onClick={() => setSrc(it.n)} className="flex items-start gap-2.5 py-2 text-left hover:bg-[var(--bg-soft)]">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: LIGHT[it.color]!.dot }} />
                <span className="min-w-0 flex-1 text-[14px] leading-snug text-[var(--ink)]"><b>{personName(it.n)}</b> · {it.text}</span>
              </button>
            ))}
          </div>
          {list.length > 5 && (
            <button type="button" onClick={() => setMore(!more)} className="mt-1 text-xs text-[var(--ink-soft)] underline">
              {more ? "ย่อ" : `ดูอีก ${list.length - 5} เรื่อง`}
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-[var(--line)] px-4 py-2 text-xs text-[var(--ink-soft)]">
          <span>จุดสี = สีที่คนเขียนใส่เอง</span>
          <button type="button" onClick={() => setShowQa(!showQa)} className="ml-auto hover:text-[var(--ink)]">💬 ถาม AI</button>
        </div>
        {showQa && (
          <div className="flex flex-col gap-2 border-t border-[var(--line)] bg-[var(--bg-soft)] px-4 py-3 text-[13px]">
            <p><b>CEO:</b> {D.qa.q}</p>
            <div className="flex gap-2"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-navy)]" />
              <div className="flex flex-col gap-1 text-[var(--ink)]">{(D.qa.a as string).split("\n").filter(Boolean).map((line, i) => <p key={i}>{line.replaceAll("**", "").replace(/\s*\(#[\d,\s#]+\)/g, "")}</p>)}</div>
            </div>
          </div>
        )}
      </div>
      {src != null && <Source n={src} close={() => setSrc(null)} say={() => {}} />}
    </div>
  );
}
