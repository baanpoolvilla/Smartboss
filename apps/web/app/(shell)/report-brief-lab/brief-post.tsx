"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { briefInternals as I } from "./brief-lab";

/**
 * ⚠ ตัวอย่างทดลอง — สรุปเป็น "โพสต์ปักหมุด" บนสุดของหน้าโพสต์ในห้องรายงาน (ไม่มีแท็บใหม่)
 * แตะบรรทัด = ไปที่โพสต์ของคนนั้น · ถามต่อ = คอมเมนต์ใต้โพสต์สรุป
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
function buildBrief(kind: "eve" | "morn") {
  const { PARSED, SHORT, D, colorOfTopic, RANK, NONE, refsOf, clean, isMorning } = I;
  const day = kind === "eve" ? "2026-11-10" : "2026-11-11";
  const reps = PARSED.filter((r) => r.day === day && (kind === "eve" ? !isMorning(r) : isMorning(r)));
  const people = reps
    .map((r) => {
      const topics = (SHORT[r.n]?.topics ?? []).map((t) => ({ ...t, color: colorOfTopic(r.text, t.topic) }));
      const worst = topics.reduce<string>((w, t) => (RANK[t.color]! < RANK[w]! ? t.color : w), "none");
      return { n: r.n, worst, one: SHORT[r.n]?.oneLine ?? "", topics };
    })
    .sort((a, b) => RANK[a.worst]! - RANK[b.worst]!);
  const words = (s: string) => new Set((s.match(/[A-Za-z0-9]{2,}/g) ?? []).map((w) => w.toLowerCase()));
  const same = (t1: string, r1: number[], t2: string, r2: number[]) => r1.some((n) => r2.includes(n)) && [...words(t1)].some((w) => words(t2).has(w));
  const carry = (kind === "eve" ? D.eve.carry : []).filter((x: any) => x.daysOpen >= 2).map((x: any) => ({ ...x, r: refsOf(x.refs) }));
  const used = new Set<any>();
  const age = (t: string, r: number[]) => {
    const c = carry.find((c: any) => same(t, r, c.title, c.r));
    if (c) used.add(c);
    return c?.daysOpen as number | undefined;
  };
  const pick = (refs: any) => refsOf(refs).filter((n) => reps.some((r) => r.n === n)).at(-1) ?? refsOf(refs).at(-1)!;
  type Line = { icon: string; n: number; text: string; age?: number };
  const lines: Line[] = [];
  if (kind === "eve") {
    for (const p of people)
      for (const t of p.topics)
        if (t.color === "red" && !NONE.test(t.short.trim())) {
          const s = D.eve.red.find((x: any) => refsOf(x.refs).includes(p.n));
          const text = s ? `${clean(s.title)}: ${clean(s.detail)}` : t.short;
          lines.push({ icon: "🔴", n: p.n, text, age: age(text, [p.n]) });
        }
    for (const x of D.eve.needBoss) lines.push({ icon: "🙋", n: pick(x.refs), text: `รอคุณ: ${clean(x.title)}`, age: age(x.title, refsOf(x.refs)) });
    for (const x of D.eve.red)
      if (!lines.some((l) => same(l.text, [l.n], x.title, refsOf(x.refs))))
        lines.push({ icon: "🟡", n: pick(x.refs), text: `${clean(x.title)}: ${clean(x.detail)}`, age: age(x.title, refsOf(x.refs)) });
  } else {
    for (const x of D.morn.bossToday) lines.push({ icon: "🙋", n: pick(x.refs), text: `ควรดูวันนี้: ${clean(x.title)}` });
    for (const x of D.morn.watch.slice(0, 2)) lines.push({ icon: "🟡", n: pick(x.refs), text: `เมื่อวานค้าง แต่แผนเช้าไม่พูดถึง: ${clean(x.title)}` });
  }
  const restCarry = carry.filter((c: any) => !used.has(c));
  const mentioned = new Set(lines.map((l) => l.n));
  const quiet = people.filter((p) => !mentioned.has(p.n));
  const headline = clean(kind === "eve" ? D.eve.headline : D.morn.headline).replace(/\s*\(#.*$/, "");
  return { day, reps, people, lines, restCarry, quiet, headline };
}

export function BriefPostCard() {
  const { thDay, personName, LIGHT, Source, D } = I;
  const [k, setK] = useState<"eve" | "morn">("eve");
  const b = buildBrief(k);
  const [all, setAll] = useState(false);
  const [showQa, setShowQa] = useState(false);
  const [src, setSrc] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 2400);
  };
  const jump = (n: number) => {
    say("ของจริง: กระโดดไปที่โพสต์ของคนนั้นในห้องนี้ (ตัวอย่างนี้เปิดรายงานต้นฉบับให้ดูแทน)");
    setSrc(n);
  };
  return (
    <div className="mx-3 mt-2 sm:mx-5">
      <div className="max-h-[62vh] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--bg)] shadow-sm">
        <div className="flex items-start gap-3 px-4 pt-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-navy)] text-white">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <b className="text-[15px] text-[var(--ink)]">ผู้ช่วยสรุป</b>
              <span className="text-xs text-[var(--ink-soft)]">
                {k === "eve" ? "20:35" : "09:35"} · {thDay(b.day)}
              </span>
              <span className="ml-auto flex items-center gap-1 text-[11px] text-[var(--ink-soft)]">
                📌 ปักหมุด
                <button type="button" onClick={() => setK(k === "eve" ? "morn" : "eve")} className="ml-2 rounded-full border border-[var(--line)] px-2 py-0.5 hover:bg-[var(--bg-soft)]">
                  ดู{k === "eve" ? "สรุปเช้า" : "สรุปเย็น"}
                </button>
              </span>
            </div>
            <p className="mt-0.5 text-[15px] font-medium leading-snug text-[var(--ink)]">
              {k === "eve" ? "สรุปเย็น" : "สรุปเช้า"}: {b.headline}
            </p>
            <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
              ส่งแล้ว {b.reps.length} คน · ยังไม่ส่ง: <i>(ของจริงขึ้นชื่อ)</i>
            </p>
          </div>
        </div>
        <div className="flex flex-col py-2">
          {b.lines.map((l, i) => (
            <button key={i} type="button" onClick={() => jump(l.n)} className="flex items-start gap-2.5 px-4 py-1.5 text-left hover:bg-[var(--bg-soft)]">
              <span className="w-5 shrink-0 text-center">{l.icon}</span>
              <span className="min-w-0 flex-1 text-[14px] leading-snug text-[var(--ink)]">
                <b>{personName(l.n)}</b> · {l.text}
                {l.age && <span className="ml-1.5 rounded bg-[var(--bg-soft)] px-1 text-[11px] font-semibold text-[var(--tone-danger)]">ค้าง {l.age} วัน</span>}
              </span>
            </button>
          ))}
          {b.restCarry.length > 0 && !all && (
            <button type="button" onClick={() => setAll(true)} className="flex items-start gap-2.5 px-4 py-1.5 text-left text-[14px] text-[var(--ink)] hover:bg-[var(--bg-soft)]">
              <span className="w-5 shrink-0 text-center">⏳</span>
              <span>ค้างหลายวันอีก {b.restCarry.length} เรื่อง: {b.restCarry.map((c: any) => I.clean(c.title)).join(", ")}</span>
            </button>
          )}
          {!all && (
            <button type="button" onClick={() => setAll(true)} className="flex items-start gap-2.5 px-4 py-1.5 text-left text-[14px] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]">
              <span className="w-5 shrink-0 text-center">🟢</span>
              <span>
                อีก {b.quiet.length} คนไม่มีเรื่องต้องดู · <u>ดูทุกคน ▾</u>
              </span>
            </button>
          )}
          {all && (
            <div className="mx-4 mt-1 flex flex-col divide-y divide-[var(--line)] rounded-lg border border-[var(--line)]">
              {b.people.map((p) => (
                <button key={p.n} type="button" onClick={() => jump(p.n)} className="flex items-start gap-2.5 px-3 py-2 text-left hover:bg-[var(--bg-soft)]">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: LIGHT[p.worst]!.dot }} />
                  <span className="min-w-0 text-[13px] leading-snug text-[var(--ink)]">
                    <b>{personName(p.n)}</b> · {p.one}
                  </span>
                </button>
              ))}
              <button type="button" onClick={() => setAll(false)} className="px-3 py-1.5 text-left text-xs text-[var(--ink-soft)] underline">
                ย่อ
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-[var(--line)] px-4 py-2 text-xs text-[var(--ink-soft)]">
          <button type="button" onClick={() => setShowQa(!showQa)} className="hover:text-[var(--ink)]">
            💬 1 ความคิดเห็น
          </button>
          <span>แตะบรรทัดไหน ไปที่โพสต์ของคนนั้น</span>
        </div>
        {showQa && (
          <div className="flex flex-col gap-2 border-t border-[var(--line)] bg-[var(--bg-soft)] px-4 py-3 text-[13px]">
            <p>
              <b>CEO:</b> {D.qa.q}
            </p>
            <div className="flex gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-navy)]" />
              <div className="flex flex-col gap-1 text-[var(--ink)]">
                {(D.qa.a as string)
                  .split("\n")
                  .filter(Boolean)
                  .map((line, i) => (
                    <p key={i}>{line.replaceAll("**", "").replace(/\s*\(#[\d,\s#]+\)/g, "")}</p>
                  ))}
              </div>
            </div>
            <div className="mt-1 rounded-full border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-[var(--ink-soft)]">ถามต่อ… (ผู้ช่วยตอบเป็นความคิดเห็น)</div>
          </div>
        )}
      </div>
      {src != null && <Source n={src} close={() => setSrc(null)} say={say} />}
      {toast && <div className="fixed bottom-24 left-1/2 z-[90] max-w-[90vw] -translate-x-1/2 rounded-[var(--radius)] bg-[var(--ink)] px-4 py-2 text-sm text-[var(--bg)] shadow-lg">{toast}</div>}
    </div>
  );
}
