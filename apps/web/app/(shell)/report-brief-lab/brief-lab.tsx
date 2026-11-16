"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle, Bell, CalendarDays, CheckCircle2, Clock, ExternalLink, Filter, History, Lightbulb,
  MessageSquare, Search, Send, Settings2, Sparkles, Sun, Moon, X,
} from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { Card } from "@smartboss/ui/components/card";
import raw from "./data.json";

/**
 * ⚠ ตัวอย่างทดลอง — ดู page.tsx
 * ส่วนที่ "ระบบนับเอง" (ใคร/วัน/สี/หัวข้อ) แยกหัวข้อด้วยกฎเดียวกับตัวตรวจรูปแบบรายงาน (report-format.ts)
 * ส่วนที่ "AI เขียน" (ภาพรวม, รอ Boss, เรื่องค้าง, รายสัปดาห์, ถามตอบ) = ผลจริงจาก gpt-6-sol ที่ทำไว้ล่วงหน้า
 */

type Ref = number | string;
type RefList = Ref[] | string | undefined;
interface Rep { n: number; at: string; round: string; text: string }
interface Label { n: number; who: string; team: string }
type Color = "red" | "yellow" | "green";
interface Block { topic: string; color: Color | null; content: string }

/* eslint-disable @typescript-eslint/no-explicit-any */
const D = raw as any;
const REPORTS: Rep[] = D.reports;
const LABELS: Record<number, Label> = Object.fromEntries((D.labels as Label[]).map((l) => [l.n, l]));

const TOPICS = [
  "วันนี้ส่งงานอะไร | วันนี้ส่งงาน | วันนี้ทำงานอะไร | งานที่ดำเนินการวันนี้",
  "งานที่ล่าช้า ผิดพลาด ไม่เป็นไปตามแผน | งานที่ล่าช้า ผิดพลาด หรือไม่เป็นไปตามแผน | งานที่ล่าช้าหรือไม่เป็นไปตามแผน | งานที่ล่าช้า / ผิดแผน | งานล่าช้า/ผิดแผน | งานที่ล่าช้า / ยังไม่ปิดงาน",
  "ปัญหาและความเสี่ยง",
  "วิธีแก้ไขและความรับผิดชอบ",
  "เรื่องที่ต้องการให้ Boss ตัดสินใจ",
  "🏁Department Module🏁",
];

/* ---------- แยกหัวข้อด้วยกฎ (สำเนาย่อจาก report-format.ts — ของจริงจะ export ฟังก์ชันจากไฟล์นั้น) ---------- */
const squash = (s: string) =>
  s.normalize("NFC").toLowerCase()
    .replace(/\{\{\/?[chs](?::[a-z]+)?\}\}/g, "")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[\s.,:;!?…·•*_~`'"“”‘’()[\]{}<>/\\|—–\-=+#]/g, "");
const stripLead = (l: string) => l.replace(/^\s*(?:[-–—•*▪◦>☐☑]+\s*)?(?:ข้อ\s*)?(?:\d+(?:[.．]\d+)*\s*[.):）\-–—]?\s*)?/u, "");
const names = (line: string) => line.split("|").map((p) => stripLead(p.replace(/[🔴🟡🟢🏁]/gu, "")).trim()).filter(Boolean);
const label = (line: string) => names(line)[0] ?? "";
const COLOR_OF: Record<string, Color> = { "🔴": "red", "🟡": "yellow", "🟢": "green" };

function splitTopics(text: string): Block[] {
  const keys = TOPICS.flatMap((t, i) => names(t).map((n) => ({ i, k: squash(n) }))).sort((a, b) => b.k.length - a.k.length);
  const out: Block[] = [];
  let cur: Block | null = null;
  const seen = new Set<number>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const head = squash(stripLead(line.replace(/[🔴🟡🟢🏁]/gu, "")));
    const hit = head ? keys.find((t) => !seen.has(t.i) && head.startsWith(t.k)) : undefined;
    if (hit) {
      seen.add(hit.i);
      let color: Color | null = null;
      for (const e of Object.keys(COLOR_OF)) if (line.includes(e)) color = COLOR_OF[e]!;
      cur = { topic: label(TOPICS[hit.i]!), color, content: "" };
      out.push(cur);
      const rest = line.replace(/^[^:：]*[:：]/, "");
      if (rest !== line && rest.trim()) cur.content += rest.trim() + "\n";
      continue;
    }
    if (cur) cur.content += line + "\n";
  }
  return out.map((b) => ({ ...b, content: b.content.replaceAll("**", "").trim() }));
}

/* ---------- ตัวช่วย ---------- */
const bkk = (at: string) => new Date(new Date(at + ":00Z").getTime() + 7 * 3600_000);
const ymd = (at: string) => bkk(at).toISOString().slice(0, 10);
const TH_M = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_D = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const thDay = (d: string) => { const x = new Date(d + "T00:00:00Z"); return `${TH_D[x.getUTCDay()]} ${x.getUTCDate()} ${TH_M[x.getUTCMonth() + 1]}`; };
const hm = (at: string) => bkk(at).toISOString().slice(11, 16);
const refsOf = (r: RefList): number[] => (Array.isArray(r) ? r.join(",") : String(r ?? "")).match(/\d+/g)?.map(Number) ?? [];
const clean = (s: string) => String(s ?? "").replace(/\s*\((?:#\d+[,\s]*)+\)\s*$/u, "").replace(/\s*\(#[^)]*\)\s*$/u, "");
const teamOf = (n: number) => LABELS[n]?.team ?? "ไม่ทราบทีม";
const whoOf = (n: number) => { const l = LABELS[n]; return l?.who ? `${l.who} · ${l.team}` : l?.team ?? ""; };
const isMorning = (r: Rep) => r.round.includes("Morning");
const DOT: Record<Color, string> = { red: "var(--tone-danger)", yellow: "#d39b00", green: "var(--tone-ok)" };
const COLOR_TH: Record<Color, string> = { red: "แดง", yellow: "เหลือง", green: "เขียว" };

const PARSED = REPORTS.map((r) => ({ ...r, day: ymd(r.at), team: teamOf(r.n), blocks: splitTopics(r.text) }));
const DAYS = [...new Set(PARSED.map((r) => r.day))].sort();
const TEAMS = [...new Set(PARSED.map((r) => r.team))].sort();

type Tab = "eve" | "morn" | "period" | "search" | "carry" | "ask" | "settings";
const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "eve", label: "สรุปเย็น", icon: Moon },
  { id: "morn", label: "สรุปเช้า", icon: Sun },
  { id: "period", label: "รายสัปดาห์/เดือน", icon: CalendarDays },
  { id: "search", label: "ค้นดูเอง", icon: Filter },
  { id: "carry", label: "เรื่องค้าง", icon: History },
  { id: "ask", label: "ถาม AI", icon: MessageSquare },
  { id: "settings", label: "ตั้งค่า", icon: Settings2 },
];

/* ---------- แบบใหม่: คน → สี → เรื่อง ---------- */
interface Short { n: number; oneLine: string; topics: { topic: string; short: string }[] }
const SHORT: Record<number, Short> = Object.fromEntries(((D.short ?? []) as Short[]).map((s) => [s.n, s]));
const RANK: Record<string, number> = { red: 0, yellow: 1, green: 2, none: 3 };
const LIGHT: Record<string, { dot: string; bg: string; ink: string; word: string }> = {
  red: { dot: "var(--tone-danger)", bg: "color-mix(in srgb, var(--tone-danger) 10%, var(--bg))", ink: "var(--tone-danger)", word: "มีปัญหา" },
  yellow: { dot: "#d39b00", bg: "color-mix(in srgb, #d39b00 12%, var(--bg))", ink: "#a67500", word: "ต้องติดตาม" },
  green: { dot: "var(--tone-ok)", bg: "color-mix(in srgb, var(--tone-ok) 10%, var(--bg))", ink: "var(--tone-ok)", word: "เรียบร้อย" },
  none: { dot: "var(--line)", bg: "var(--bg)", ink: "var(--ink-soft)", word: "ไม่ได้ใส่สี" },
};
/** สีของหัวข้อ = อีโมจิที่คนเขียนใส่ไว้บนบรรทัดหัวข้อนั้นเอง (ระบบอ่าน ไม่ใช่ AI เดา) */
function colorOfTopic(text: string, topic: string): Color | "none" {
  const key = squash(stripLead(topic));
  if (!key) return "none";
  for (const raw of text.split(/\r?\n/)) {
    if (!squash(stripLead(raw.replace(/[🔴🟡🟢🏁]/gu, ""))).startsWith(key.slice(0, 14))) continue;
    for (const e of Object.keys(COLOR_OF)) if (raw.includes(e)) return COLOR_OF[e]!;
    return "none";
  }
  return "none";
}
const shortTopic = (t: string) => stripLead(t).replace(/^BLUF.*$/i, "สรุปสั้น (BLUF)").slice(0, 40);

function Light({ c, size = 10 }: { c: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: LIGHT[c]!.dot }} />;
}

function PeopleBrief({ kind, open, B }: { kind: "eve" | "morn"; open: (n: number) => void; B: (s: string) => string }) {
  const day = kind === "eve" ? "2026-11-10" : "2026-11-11";
  const reps = PARSED.filter((r) => r.day === day && (kind === "eve" ? !isMorning(r) : isMorning(r)));
  const people = reps.map((r) => {
    const s = SHORT[r.n];
    const topics = (s?.topics ?? []).map((t) => ({ ...t, color: colorOfTopic(r.text, t.topic) }));
    const worst = topics.reduce<string>((w, t) => (RANK[t.color]! < RANK[w]! ? t.color : w), "none");
    return { r, s, topics, worst };
  }).sort((a, b) => RANK[a.worst]! - RANK[b.worst]!);
  const [openCard, setOpenCard] = useState<number | null>(null);
  const groups = (["red", "yellow", "green", "none"] as const).map((c) => ({ c, list: people.filter((p) => p.worst === c) }));
  const need = kind === "eve" ? D.eve.needBoss : D.morn.bossToday;
  const headline = kind === "eve" ? D.eve.headline : D.morn.headline;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {/* 1. ประโยคเดียว */}
      <Card className="flex flex-col gap-2 p-4">
        <p className="text-xs text-(--ink-soft)">{kind === "eve" ? "สรุปเย็น" : "สรุปเช้า"} · {thDay(day)} · ส่งรายงาน {reps.length} ฉบับ · ยังไม่ส่ง: (ของจริงขึ้นชื่อ)</p>
        <p className="text-[15px] leading-relaxed text-(--ink)">{clean(headline)}</p>
      </Card>

      {/* 2. ไฟจราจร: นับคนตามสี */}
      {kind === "eve" && (
        <div className="grid grid-cols-3 gap-2">
          {groups.slice(0, 3).map(({ c, list }) => (
            <div key={c} className="flex flex-col gap-1 rounded-(--radius) border border-(--line) p-3" style={{ background: LIGHT[c]!.bg }}>
              <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: LIGHT[c]!.ink }}><Light c={c} />{LIGHT[c]!.word}</span>
              <span className="text-2xl font-bold text-(--ink)">{list.length} <span className="text-sm font-normal text-(--ink-soft)">คน</span></span>
              <span className="line-clamp-2 text-[11px] text-(--ink-soft)">{list.map((p) => whoOf(p.r.n)).join(", ") || "—"}</span>
            </div>
          ))}
        </div>
      )}

      {/* 3. เรื่องที่รอ CEO */}
      {need.length > 0 && (
        <Card className="flex flex-col gap-2 border-l-4 p-4" style={{ borderLeftColor: "var(--brand-navy)" }}>
          <h2 className="text-sm font-semibold text-(--ink)">{kind === "eve" ? B("รอคุณ (Boss) ตัดสินใจ") : B("วันนี้คุณ (Boss) ควรดู")}</h2>
          {need.map((x: any, i: number) => (
            <div key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium text-(--ink)">{clean(x.title)}</span>
              <span className="text-xs text-(--ink-soft)">{x.who ?? ""}</span>
              <button type="button" onClick={() => open(refsOf(x.refs).at(-1)!)} className="ml-auto text-xs font-medium text-(--brand-navy) underline">ดูรายงาน</button>
            </div>
          ))}
        </Card>
      )}

      {/* 4. รายคน เรียงแดง → เหลือง → เขียว */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-(--ink)">รายคน</h2>
        <span className="flex flex-wrap gap-3 text-[11px] text-(--ink-soft)">
          {(["red", "yellow", "green", "none"] as const).map((c) => <span key={c} className="flex items-center gap-1"><Light c={c} size={8} />{LIGHT[c]!.word}</span>)}
        </span>
      </div>
      {people.map(({ r, s, topics, worst }) => {
        const expanded = openCard === r.n;
        const shown = expanded ? topics : topics.filter((t) => t.color === "red" || t.color === "yellow");
        const hidden = topics.length - shown.length;
        return (
          <Card key={r.n} className="overflow-hidden">
            <div className="flex items-start gap-3 p-4" style={{ background: LIGHT[worst]!.bg }}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: LIGHT[worst]!.dot === "var(--line)" ? "var(--ink-soft)" : LIGHT[worst]!.dot }}>
                {(LABELS[r.n]?.who || r.team).slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <b className="text-(--ink)">{LABELS[r.n]?.who || r.team}</b>
                  {LABELS[r.n]?.who && <span className="text-xs text-(--ink-soft)">{r.team}</span>}
                  <span className="text-xs text-(--ink-soft)">ส่ง {hm(r.at)}</span>
                  <span className="ml-auto text-xs font-semibold" style={{ color: LIGHT[worst]!.ink }}>{LIGHT[worst]!.word}</span>
                </div>
                <p className="mt-0.5 text-sm text-(--ink)">{s?.oneLine ?? ""}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {topics.map((t, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-full border border-(--line) bg-(--bg) px-2 py-0.5 text-[11px] text-(--ink-soft)">
                      <Light c={t.color} size={7} />{shortTopic(t.topic).slice(0, 18)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            {shown.length > 0 && (
              <div className="flex flex-col divide-y divide-(--line) border-t border-(--line)">
                {shown.map((t, i) => (
                  <div key={i} className="flex gap-3 px-4 py-2.5">
                    <span className="mt-1.5"><Light c={t.color} /></span>
                    <div className="min-w-0">
                      <p className="text-xs text-(--ink-soft)">{shortTopic(t.topic)}</p>
                      <p className="text-sm text-(--ink)">{t.short}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-3 border-t border-(--line) px-4 py-2 text-xs">
              {hidden > 0 && <button type="button" onClick={() => setOpenCard(r.n)} className="text-(--ink-soft) underline">ดูอีก {hidden} หัวข้อ</button>}
              {expanded && <button type="button" onClick={() => setOpenCard(null)} className="text-(--ink-soft) underline">ย่อ</button>}
              <button type="button" onClick={() => open(r.n)} className="ml-auto font-medium text-(--brand-navy) underline">อ่านรายงานเต็ม</button>
            </div>
          </Card>
        );
      })}

      {/* 5. ระบบตรวจยังไง */}
      <Card className="flex flex-col gap-2 bg-(--bg-soft) p-4 text-[13px] text-(--ink-soft)">
        <b className="text-(--ink)">สรุปนี้ได้มายังไง</b>
        <p>1. <b>สี</b> มาจากที่คนเขียนใส่ 🔴🟡🟢 หน้าหัวข้อเอง ระบบแค่อ่าน ไม่ได้ให้ AI เดา หัวข้อไหนไม่ใส่สีจะเป็นสีเทา</p>
        <p>2. <b>สีของคน</b> = สีที่แย่ที่สุดในรายงานของเขา มีแดงหัวข้อเดียวก็ขึ้นแดง</p>
        <p>3. <b>ข้อความสั้นๆ</b> AI ย่อจากเนื้อหาใต้แต่ละหัวข้อ ไม่เกินบรรทัดเดียว</p>
        <p>4. <b>เรื่องรอตัดสินใจ</b> AI หยิบจากหัวข้อ &ldquo;เรื่องที่ต้องการให้ Boss ตัดสินใจ&rdquo; ของทุกคน รวมเรื่องที่ค้างจากวันก่อน</p>
      </Card>
    </div>
  );
}

/* ---------- แบบที่ 3: เหมือนเลขาสรุปให้ — เรื่องก่อน คนทีหลัง, ใช้คำ 3 กอง แทนชื่อหัวข้อฟอร์ม ---------- */
type Bucket = "done" | "late" | "stuck" | "ask" | "plan";
const BUCKET: Record<Bucket, string> = { done: "เสร็จแล้ว", late: "ช้า / ค้าง", stuck: "ติดขัด / เสี่ยง", ask: "ขอให้คุณตัดสินใจ", plan: "จะทำ" };
function bucketOf(topic: string): Bucket | null {
  const t = topic.replace(/\s/g, "");
  if (/ตัดสินใจ|เสนอ|พิจารณา/.test(t)) return "ask";
  if (/ปัญหา|อุปสรรค|เสี่ยง/.test(t)) return "stuck";
  if (/ล่าช้า|ค้าง|ผิดแผน|ผิดพลาด/.test(t)) return "late";
  if (/ส่งงาน|ดำเนินการ|ทำงานอะไร|สรุปสถานะ/.test(t)) return "done";
  if (/แผน|BLUF|Deploy/i.test(t)) return "plan";
  return null;
}
const NONE = /^(ไม่มี|-|—|ไม่มีปัญหา.*|ไม่มีงาน.*)$/;
const personName = (n: number) => LABELS[n]?.who || teamOf(n);

function Avatar({ n, c, size = 32 }: { n: number; c: string; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center rounded-full border border-(--line) bg-(--bg-soft) font-bold leading-none text-(--brand-navy)" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {personName(n).slice(0, 1)}
      <span className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-(--bg)" style={{ width: size * 0.38, height: size * 0.38, background: LIGHT[c]!.dot === "var(--line)" ? "var(--ink-soft)" : LIGHT[c]!.dot }} />
    </span>
  );
}

function SecretaryBrief({ kind, open, B }: { kind: "eve" | "morn"; open: (n: number) => void; B: (s: string) => string }) {
  const day = kind === "eve" ? "2026-11-10" : "2026-11-11";
  const reps = PARSED.filter((r) => r.day === day && (kind === "eve" ? !isMorning(r) : isMorning(r)));
  const people = reps.map((r) => {
    const topics = (SHORT[r.n]?.topics ?? []).map((t) => ({ ...t, color: colorOfTopic(r.text, t.topic), bucket: bucketOf(t.topic) }));
    const worst = topics.reduce<string>((w, t) => (RANK[t.color]! < RANK[w]! ? t.color : w), "none");
    return { r, topics, worst, one: SHORT[r.n]?.oneLine ?? "" };
  }).sort((a, b) => RANK[a.worst]! - RANK[b.worst]!);
  const [who, setWho] = useState<number | null>(null);
  const [showDone, setShowDone] = useState(false);
  const E = D.eve, M = D.morn;
  const findN = (refs: RefList) => refsOf(refs).filter((n) => reps.some((r) => r.n === n)).at(-1) ?? refsOf(refs).at(-1)!;

  // รายการเรื่อง (ไม่ใช่รายคน) — แต่ละเรื่องติดชื่อคนที่ยกขึ้นมา
  type Item = { title: string; detail?: string; n: number; tag?: string; color?: string };
  // เรื่องเดียวกันต้องขึ้นที่เดียว: เทียบรายงานต้นทางร่วมกัน + คำเฉพาะร่วมกัน (HS2, CI, SL1 …)
  const words = (s: string) => new Set((s.match(/[A-Za-z0-9]{2,}/g) ?? []).map((w) => w.toLowerCase()));
  const sameStory = (a: { title: string; refs: number[] }, b: { title: string; refs: number[] }) => {
    const wa = words(a.title), wb = words(b.title);
    return a.refs.some((n) => b.refs.includes(n)) && [...wa].some((w) => wb.has(w));
  };
  const carrySrc = (kind === "eve" ? E.carry : []).filter((x: any) => x.daysOpen >= 2).map((x: any) => ({ ...x, refsN: refsOf(x.refs) }));
  const ageOf = (title: string, refs: number[]) => carrySrc.find((c: any) => sameStory({ title, refs }, { title: c.title, refs: c.refsN }))?.daysOpen as number | undefined;
  const used: any[] = [];
  const withAge = (title: string, refs: number[], fallback?: string) => {
    const d = ageOf(title, refs);
    if (d) used.push(carrySrc.find((c: any) => c.daysOpen === d && sameStory({ title, refs }, { title: c.title, refs: c.refsN })));
    return d ? `ค้างวันที่ ${d}` : fallback;
  };
  // 🔴 ต้องรู้ = เฉพาะหัวข้อที่ "คนเขียนใส่ 🔴 เอง" (สีตรงกับหัวกลุ่มเสมอ)
  const urgent: Item[] = kind === "eve"
    ? people.flatMap((p) => p.topics.filter((t) => t.color === "red" && !NONE.test(t.short.trim())).map((t) => {
        const story = E.red.find((x: any) => refsOf(x.refs).includes(p.r.n));
        const title = story ? clean(story.title) : t.short;
        return { title, detail: story ? clean(story.detail) : undefined, n: p.r.n, color: "red", tag: withAge(title, [p.r.n]) };
      }))
    : M.watch.slice(0, 3).map((x: any) => ({ title: clean(x.title), detail: clean(x.why), n: findN(x.refs), color: "yellow" }));
  // 👀 AI คิดว่าควรดู = AI เห็นว่าหนัก แต่คนเขียนไม่ได้ใส่แดง (แยกกลุ่ม สีจะได้ไม่ขัดกัน)
  const aiWatch: Item[] = kind === "eve"
    ? E.red.filter((x: any) => !urgent.some((u) => sameStory({ title: u.title, refs: [u.n] }, { title: clean(x.title), refs: refsOf(x.refs) })))
        .map((x: any) => ({ title: clean(x.title), detail: clean(x.detail), n: findN(x.refs), tag: withAge(clean(x.title), refsOf(x.refs)) }))
    : [];
  const asks: Item[] = (kind === "eve" ? E.needBoss : M.bossToday).map((x: any) => ({
    title: clean(x.title), detail: clean(x.detail ?? ""), n: findN(x.refs),
    tag: withAge(clean(x.title), refsOf(x.refs), x.since ? `ขอมา ${Math.round((Date.parse(day) - Date.parse(x.since)) / 864e5) + 1} วัน` : undefined),
  }));
  const carry: Item[] = carrySrc.filter((c: any) => !used.includes(c))
    .sort((a: any, b: any) => b.daysOpen - a.daysOpen)
    .map((x: any) => ({ title: clean(x.title), detail: `${x.who} · ${clean(x.todayStatus)}`, n: findN(x.refs), tag: `วันที่ ${x.daysOpen}` }));
  const done: Item[] = kind === "eve"
    ? E.done.map((x: any) => ({ title: clean(x.title), n: findN(x.refs) }))
    : M.todayFocus.map((x: any) => ({ title: clean(x.title), detail: x.who, n: findN(x.refs) }));

  const ItemRow = ({ it }: { it: Item }) => (
    <button type="button" onClick={() => setWho(it.n)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-(--bg-soft)">
      <Avatar n={it.n} c={people.find((p) => p.r.n === it.n)?.worst ?? "none"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-(--ink-soft)">{personName(it.n)}</span>
          {it.tag && <span className="ml-auto shrink-0 rounded-md bg-(--bg-soft) px-1.5 text-[11px] font-semibold text-(--tone-danger)">{it.tag}</span>}
        </div>
        <p className="text-[15px] font-medium leading-snug text-(--ink)">{it.title}</p>
        {it.detail && <p className="mt-0.5 text-[13px] leading-snug text-(--ink-soft)">{it.detail}</p>}
      </div>
    </button>
  );
  const Group = ({ icon, title, items, tone, hint }: { icon: string; title: string; items: Item[]; tone: string; hint?: string }) =>
    items.length === 0 ? null : (
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-1">
          <span className="text-base">{icon}</span>
          <h2 className="text-[15px] font-bold" style={{ color: tone }}>{title}</h2>
          <span className="text-sm text-(--ink-soft)">{items.length}</span>
          {hint && <span className="ml-auto text-[11px] text-(--ink-soft)">{hint}</span>}
        </div>
        <div className="divide-y divide-(--line)">{items.map((it, i) => <ItemRow key={i} it={it} />)}</div>
      </Card>
    );

  const sel = people.find((p) => p.r.n === who);
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
      {/* หัว: ใครส่ง + ประโยคเดียว */}
      <div className="flex flex-col gap-2 px-1">
        <p className="text-xs text-(--ink-soft)">{kind === "eve" ? "สรุปเย็น" : "สรุปเช้า"} · {thDay(day)}</p>
        <p className="text-lg font-semibold leading-snug text-(--ink)">{clean(kind === "eve" ? E.headline : M.headline).replace(/\s*\(#.*$/, "")}</p>
        <div className="flex items-center gap-2 text-xs text-(--ink-soft)">
          <span>ส่งแล้ว {reps.length} คน</span><span>·</span><span>ยังไม่ส่ง: <i>(ของจริงขึ้นชื่อ)</i></span>
        </div>
      </div>

      <Group icon="🔴" title={kind === "eve" ? "ต้องรู้" : "ระวังวันนี้"} items={urgent} tone="var(--tone-danger)" hint={kind === "morn" ? "เมื่อวานค้าง แต่แผนเช้าไม่พูดถึง" : undefined} />
      <Group icon="👀" title="AI คิดว่าควรดู" items={aiWatch} tone="#a67500" hint="คนเขียนไม่ได้ใส่แดง แต่น่าห่วง" />
      <Group icon="🙋" title={B(kind === "eve" ? "รอคุณตัดสินใจ" : "คุณควรดูวันนี้")} items={asks} tone="var(--brand-navy)" />
      <Group icon="⏳" title="ค้างหลายวัน" items={carry} tone="#a67500" />
      {kind === "eve" ? (
        <Card className="overflow-hidden">
          <button type="button" onClick={() => setShowDone(!showDone)} className="flex w-full items-center gap-2 px-4 py-3.5 text-left">
            <span className="text-base">✅</span>
            <h2 className="text-[15px] font-bold" style={{ color: "var(--tone-ok)" }}>เสร็จวันนี้</h2>
            <span className="text-sm text-(--ink-soft)">{done.length}</span>
            <span className="ml-auto text-xs text-(--ink-soft) underline">{showDone ? "ซ่อน" : "ดู"}</span>
          </button>
          {showDone && <div className="divide-y divide-(--line) border-t border-(--line)">{done.map((it, i) => <ItemRow key={i} it={it} />)}</div>}
        </Card>
      ) : (
        <Group icon="📋" title="งานหลักวันนี้" items={done} tone="var(--ink)" />
      )}

      {/* ทุกคน: แตะชื่อเพื่อดูของคนนั้น */}
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-(--ink)">ทุกคน</h2>
          <span className="flex gap-2.5 text-[11px] text-(--ink-soft)">
            {(["red", "yellow", "green", "none"] as const).map((c) => <span key={c} className="flex items-center gap-1"><Light c={c} size={7} />{LIGHT[c]!.word}</span>)}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {people.map((p) => (
            <button key={p.r.n} type="button" onClick={() => setWho(p.r.n)} className="flex flex-col items-center gap-1 rounded-(--radius) p-1.5 hover:bg-(--bg-soft)">
              <Avatar n={p.r.n} c={p.worst} size={40} />
              <span className="line-clamp-2 text-center text-[11px] leading-tight text-(--ink)">{personName(p.r.n)}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-(--ink-soft)">จุดสีข้างชื่อ = สีที่แย่ที่สุดที่คนนั้นใส่เองในรายงาน แตะชื่อเพื่อดูของคนนั้น</p>
      </Card>

      {/* รายละเอียดของคนที่แตะ: 3 กองที่คุ้นเคย */}
      {sel && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/30 sm:items-center" onClick={() => setWho(null)}>
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-(--bg) shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-(--line) px-4 py-3">
              <Avatar n={sel.r.n} c={sel.worst} size={40} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-(--ink)">{personName(sel.r.n)} {LABELS[sel.r.n]?.who && <span className="text-xs font-normal text-(--ink-soft)">{sel.r.team}</span>}</p>
                <p className="text-xs" style={{ color: LIGHT[sel.worst]!.ink }}>{LIGHT[sel.worst]!.word} · ส่ง {hm(sel.r.at)}</p>
              </div>
              <button type="button" onClick={() => setWho(null)} className="rounded-full p-1.5 hover:bg-(--bg-soft)" aria-label="ปิด"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex flex-col gap-3 overflow-y-auto p-4">
              <p className="text-[15px] text-(--ink)">{sel.one}</p>
              {(["stuck", "late", "ask", "done", "plan"] as Bucket[]).map((b) => {
                const rows = sel.topics.filter((t) => t.bucket === b && !NONE.test(t.short.trim()));
                if (!rows.length) return null;
                return (
                  <div key={b} className="flex flex-col gap-1">
                    <p className="text-xs font-semibold text-(--ink-soft)">{BUCKET[b]}</p>
                    {rows.map((t, i) => (
                      <div key={i} className="flex gap-2 text-sm text-(--ink)"><span className="mt-1.5"><Light c={t.color} size={8} /></span><span>{t.short}</span></div>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="border-t border-(--line) p-3">
              <Button className="w-full bg-(--brand-navy)" onClick={() => { const n = sel.r.n; setWho(null); open(n); }}>อ่านรายงานเต็ม แล้วคอมเมนต์ตอบ</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- ชิ้นส่วน UI ---------- */
function Chip({ n, open }: { n: number; open: (n: number) => void }) {
  return (
    <button type="button" onClick={() => open(n)}
      className="rounded-md bg-(--app-pale) px-1.5 py-0.5 font-mono text-[11px] font-medium text-(--brand-navy) hover:brightness-95">
      #{n}
    </button>
  );
}
function Refs({ r, open }: { r: RefList; open: (n: number) => void }) {
  const list = refsOf(r);
  if (!list.length) return null;
  return <span className="inline-flex flex-wrap gap-1">{list.map((n) => <Chip key={n} n={n} open={open} />)}</span>;
}
function Section({ title, icon: Icon, tone, count, children, note }: { title: string; icon?: React.ElementType; tone?: string; count?: number; children: React.ReactNode; note?: string }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4" style={{ color: tone ?? "var(--ink-soft)" }} />}
        <h2 className="text-sm font-semibold text-(--ink)">{title}</h2>
        {count != null && <span className="rounded-full bg-(--bg-soft) px-2 text-xs text-(--ink-soft)">{count}</span>}
        {note && <span className="ml-auto text-[11px] text-(--ink-soft)">{note}</span>}
      </div>
      <div className="flex flex-col divide-y divide-(--line)">{children}</div>
    </Card>
  );
}
function Row({ title, detail, refs, open, badge }: { title: string; detail?: string; refs?: RefList; open: (n: number) => void; badge?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start gap-2">
        <span className="min-w-0 flex-1 text-sm font-medium text-(--ink)">{clean(title)}</span>
        {badge}
      </div>
      {detail && <p className="text-[13px] leading-relaxed text-(--ink-soft)">{clean(detail)}</p>}
      {refs != null && <Refs r={refs} open={open} />}
    </div>
  );
}
function Age({ days }: { days: number }) {
  const hot = days >= 3;
  return (
    <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
      style={{ background: hot ? "color-mix(in srgb, var(--tone-danger) 14%, transparent)" : "color-mix(in srgb, #d39b00 16%, transparent)", color: hot ? "var(--tone-danger)" : "#a67500" }}>
      {days} วัน
    </span>
  );
}
function Headline({ kicker, text, foot }: { kicker: string; text: string; foot?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-(--radius) bg-(--brand-navy) p-4 text-white">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide opacity-80"><Sparkles className="h-3.5 w-3.5" />{kicker}</span>
      <p className="text-[15px] leading-relaxed">{clean(text)}</p>
      {foot}
    </div>
  );
}
function Coverage({ read, total, missing }: { read: number; total: number; missing: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-xs text-(--ink-soft)">
      <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" style={{ color: "var(--tone-ok)" }} />AI อ่านแล้ว {read}/{total} ฉบับ</span>
      <span>ยังไม่ส่ง: {missing}</span>
      <span className="ml-auto">สี/หัวข้อ นับโดยระบบ · ภาพรวม เขียนโดย AI</span>
    </div>
  );
}
function Stat({ v, l, tone }: { v: number | string; l: string; tone?: string }) {
  return (
    <div className="flex flex-col rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2">
      <span className="text-xl font-bold" style={{ color: tone ?? "var(--ink)" }}>{v}</span>
      <span className="text-[11px] text-(--ink-soft)">{l}</span>
    </div>
  );
}
function ColorCounts({ list }: { list: Block[] }) {
  const c = { red: 0, yellow: 0, green: 0 };
  list.forEach((b) => { if (b.color) c[b.color] += 1; });
  return (
    <span className="inline-flex gap-2 text-xs">
      {(["red", "yellow", "green"] as Color[]).map((k) => (
        <span key={k} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: DOT[k] }} />{c[k]}</span>
      ))}
    </span>
  );
}

/* ---------- หน้าจอ ---------- */
export function BriefLab({ boss }: { boss: string }) {
  const [tab, setTab] = useState<Tab>("eve");
  const [src, setSrc] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 2200); };
  const open = (n: number) => setSrc(n);
  const B = (s: string) => s.replace(/Boss|บอส/g, boss);

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex items-start gap-2 rounded-(--radius) border border-dashed border-(--line) bg-(--bg-soft) px-3 py-2 text-xs text-(--ink-soft)">
        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>ตัวอย่างทดลอง: ใช้รายงานจริงในห้อง daily-report วันที่ 7–11 พ.ย. ({REPORTS.length} ฉบับ) ข้อความที่ AI เขียนเป็นผลจริงจาก gpt-6-sol ส่วนปุ่มส่ง/บันทึกยังไม่ทำงานจริง · ของจริงจะเป็นแท็บ &ldquo;สรุป&rdquo; ในห้องรายงาน และแจ้งเตือนถึง{boss}</span>
      </div>

      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="มุมมอง">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${tab === t.id ? "border-(--brand-navy) bg-(--brand-navy) text-white" : "border-(--line) bg-(--bg) text-(--ink-soft) hover:bg-(--bg-soft)"}`}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </nav>

      {tab === "eve" && <SecretaryBrief kind="eve" open={open} B={B} />}
      {tab === "morn" && <SecretaryBrief kind="morn" open={open} B={B} />}
      {tab === ("old" as Tab) && <PeopleBrief kind="eve" open={open} B={B} />}      {tab === "period" && <Period open={open} B={B} />}
      {tab === "search" && <SearchView open={open} say={say} />}
      {tab === "carry" && <Carry open={open} />}
      {tab === "ask" && <Ask open={open} say={say} B={B} />}
      {tab === "settings" && <SettingsView boss={boss} say={say} />}

      {src != null && <Source n={src} close={() => setSrc(null)} say={say} />}
      {toast && <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-(--radius) bg-(--ink) px-4 py-2 text-sm text-(--bg) shadow-lg">{toast}</div>}
    </div>
  );
}

function Evening({ open, B }: { open: (n: number) => void; B: (s: string) => string }) {
  const e = D.eve;
  const day = "2026-11-10";
  const reps = PARSED.filter((r) => r.day === day && !isMorning(r));
  const blocks = reps.flatMap((r) => r.blocks);
  const reds = reps.flatMap((r) => r.blocks.filter((b) => b.color === "red").map((b) => ({ r, b })));
  const daysSince = (s: string) => Math.round((Date.parse(day) - Date.parse(s)) / 864e5) + 1;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Headline kicker={`สรุปเย็น · ${thDay(day)} · ส่งถึง${B("Boss")} 20:35`} text={e.headline} />
        <Coverage read={reps.length} total={reps.length} missing="— (ของจริงแสดงชื่อจากสมาชิกห้อง)" />
        <Section title={B("รอ Boss ตัดสินใจ")} icon={Clock} tone="var(--brand-navy)" count={e.needBoss.length} note="กด # เพื่อไปคอมเมนต์ตอบในห้อง">
          {e.needBoss.map((x: any, i: number) => <Row key={i} title={x.title} detail={`${x.who} · ${x.detail}`} refs={x.refs} open={open} badge={<Age days={daysSince(x.since)} />} />)}
        </Section>
        <Section title="สีแดงในรายงานวันนี้" icon={AlertTriangle} tone="var(--tone-danger)" count={reds.length} note="ระบบนับจาก 🔴 ครบทุกจุด">
          {reds.length ? reds.map(({ r, b }, i) => <Row key={i} title={`${b.topic}`} detail={`${whoOf(r.n)} · ${b.content.slice(0, 160)}`} refs={[r.n]} open={open} />)
            : <p className="text-sm text-(--ink-soft)">ไม่มีหัวข้อไหนใส่ 🔴 วันนี้</p>}
        </Section>
        <Section title="เรื่องสำคัญที่ AI จับได้" icon={Sparkles} tone="var(--tone-danger)" count={e.red.length}>
          {e.red.map((x: any, i: number) => <Row key={i} title={x.title} detail={`${x.who} · ${x.detail}`} refs={x.refs} open={open} />)}
        </Section>
        <Section title="เสร็จวันนี้" icon={CheckCircle2} tone="var(--tone-ok)" count={e.done.length}>
          {e.done.map((x: any, i: number) => <Row key={i} title={x.title} detail={x.who} refs={x.refs} open={open} />)}
        </Section>
      </div>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat v={e.needBoss.length} l={B("รอ Boss")} tone="var(--brand-navy)" />
          <Stat v={blocks.filter((b) => b.color === "red").length} l="หัวข้อสีแดง" tone="var(--tone-danger)" />
          <Stat v={e.carry.length} l="ค้างข้ามวัน" tone="#a67500" />
        </div>
        <Section title="รายทีม" note="ระบบ+AI">
          {e.teams.map((t: any, i: number) => (
            <div key={i} className="flex gap-2 py-2 first:pt-0 last:pb-0">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DOT[(t.status === "yellow" ? "yellow" : t.status) as Color] ?? "var(--ink-soft)" }} />
              <div className="min-w-0 flex-1 text-[13px]"><b className="text-(--ink)">{t.team}</b> <span className="text-(--ink-soft)">{clean(t.oneLine)}</span><div className="mt-1"><Refs r={t.refs} open={open} /></div></div>
            </div>
          ))}
        </Section>
        <Section title="หัวข้อตามฟอร์ม (ระบบนับ)">
          {TOPICS.map((t) => {
            const l = label(t);
            const list = blocks.filter((b) => b.topic === l);
            return (
              <div key={l} className="flex items-center justify-between gap-2 py-1.5 text-[13px] first:pt-0 last:pb-0">
                <span className="min-w-0 truncate text-(--ink)">{l}</span>
                {l.includes("Department") ? <span className="text-xs text-(--ink-soft)">{list.length} ฉบับ</span> : <ColorCounts list={list} />}
              </div>
            );
          })}
        </Section>
      </div>
    </div>
  );
}

function Morning({ open, B }: { open: (n: number) => void; B: (s: string) => string }) {
  const m = D.morn;
  const reps = PARSED.filter((r) => r.day === "2026-11-11" && isMorning(r));
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Headline kicker={`สรุปเช้า · ${thDay("2026-11-11")} · ส่งถึง${B("Boss")} 09:35`} text={m.headline} />
        <Coverage read={reps.length} total={reps.length} missing="— (ของจริงแสดงชื่อจากสมาชิกห้อง)" />
        <Section title={B("Boss ควรดูวันนี้")} icon={Clock} tone="var(--brand-navy)" count={m.bossToday.length}>
          {m.bossToday.map((x: any, i: number) => <Row key={i} title={x.title} detail={x.detail} refs={x.refs} open={open} />)}
        </Section>
        <Section title="เมื่อวานค้าง แต่แผนเช้าไม่มีใครพูดถึง" icon={AlertTriangle} tone="#d39b00" count={m.watch.length} note="AI เทียบกับรายงานเย็นเมื่อวาน">
          {m.watch.map((x: any, i: number) => <Row key={i} title={x.title} detail={x.why} refs={x.refs} open={open} />)}
        </Section>
        <Section title="งานหลักวันนี้" icon={CheckCircle2} count={m.todayFocus.length}>
          {m.todayFocus.map((x: any, i: number) => <Row key={i} title={x.title} detail={x.who} refs={x.refs} open={open} />)}
        </Section>
      </div>
      <Section title="แผนรายทีม">
        {m.teams.map((t: any, i: number) => <Row key={i} title={t.team + (t.headcount ? ` (${t.headcount})` : "")} detail={t.plan} refs={t.refs} open={open} />)}
      </Section>
    </div>
  );
}

function Period({ open, B }: { open: (n: number) => void; B: (s: string) => string }) {
  const [mode, setMode] = useState<"week" | "month">("week");
  const w = D.week;
  const perDay = DAYS.map((d) => {
    const bl = PARSED.filter((r) => r.day === d).flatMap((r) => r.blocks);
    return { d, red: bl.filter((b) => b.color === "red").length, yellow: bl.filter((b) => b.color === "yellow").length, green: bl.filter((b) => b.color === "green").length, n: PARSED.filter((r) => r.day === d).length };
  });
  const max = Math.max(...perDay.map((x) => x.red + x.yellow + x.green), 1);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["week", "month"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setMode(k)}
            className={`rounded-full border px-3 py-1 text-sm ${mode === k ? "border-(--brand-navy) bg-(--brand-navy) text-white" : "border-(--line) bg-(--bg) text-(--ink-soft)"}`}>
            {k === "week" ? "รายสัปดาห์" : "รายเดือน"}
          </button>
        ))}
        <span className="flex items-center gap-1 rounded-full border border-(--line) bg-(--bg) px-3 py-1 text-sm text-(--ink)">
          <CalendarDays className="h-4 w-4 text-(--ink-soft)" />{mode === "week" ? "7 – 11 พ.ย. 2569" : "รอบ 26 ต.ค. – 25 พ.ย. 2569"}
        </span>
        <span className="text-xs text-(--ink-soft)">เลือกช่วงวันเองได้ · รายเดือนตั้งให้ตรงรอบเงินเดือน 26–25 ได้</span>
      </div>
      {mode === "month" && (
        <div className="rounded-(--radius) border border-dashed border-(--line) bg-(--bg-soft) px-3 py-2 text-xs text-(--ink-soft)">
          ตัวอย่างมีรายงานจริงแค่ 5 วัน เดือนจริงจะรวมทุกสัปดาห์: AI สรุปรายวันเก็บไว้ แล้วรวมเป็นสัปดาห์และเดือน จึงไม่ต้องอ่านรายงาน 300 ฉบับรวดเดียว
        </div>
      )}
      <Headline kicker={`${mode === "week" ? "สรุปสัปดาห์" : "สรุปเดือน"} · จาก ${w.numbers?.reports ?? REPORTS.length} รายงาน · ส่งถึง${B("Boss")} ${mode === "week" ? "เสาร์ 08:00" : "26 พ.ย. 08:00"}`} text={w.headline} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-(--ink)">สีในรายงานรายวัน (ระบบนับ)</h2>
            <span className="text-[11px] text-(--ink-soft)">กดแท่งเพื่อเปิดวันนั้น</span>
          </div>
          <div className="flex h-40 items-end gap-3">
            {perDay.map((x) => (
              <div key={x.d} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-md" style={{ height: `${((x.red + x.yellow + x.green) / max) * 120}px` }}>
                  <div style={{ flex: x.green, background: DOT.green }} />
                  <div style={{ flex: x.yellow, background: DOT.yellow }} />
                  <div style={{ flex: x.red, background: DOT.red }} />
                </div>
                <span className="text-[11px] text-(--ink-soft)">{thDay(x.d).split(" ").slice(0, 2).join(" ")}</span>
                <span className="text-[10px] text-(--ink-soft)">{x.n} ฉบับ</span>
              </div>
            ))}
          </div>
        </Card>
        <Section title="ทีม: สัปดาห์นี้เป็นยังไง" note="AI">
          {w.teams.map((t: any, i: number) => (
            <Row key={i} title={t.team} detail={t.summary} refs={t.refs} open={open}
              badge={<span className="shrink-0 rounded-md bg-(--bg-soft) px-1.5 py-0.5 text-[11px] text-(--ink-soft)">{t.trend}</span>} />
          ))}
        </Section>
        <Section title={B("ขอให้ Boss ตัดสินใจ")} icon={Clock} tone="var(--brand-navy)" count={w.needBoss.length}>
          {w.needBoss.map((x: any, i: number) => (
            <Row key={i} title={x.title} detail={x.who} refs={x.refs} open={open}
              badge={<span className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: x.status === "ยังรอ" ? "color-mix(in srgb, var(--tone-danger) 14%, transparent)" : "var(--bg-soft)", color: x.status === "ยังรอ" ? "var(--tone-danger)" : "var(--ink-soft)" }}>{x.status}</span>} />
          ))}
        </Section>
        <Section title="เรื่องที่วนกลับมาหลายวัน" icon={History} tone="#d39b00" count={w.recurring.length}>
          {w.recurring.map((x: any, i: number) => <Row key={i} title={x.title} detail={x.who} refs={x.refs} open={open} badge={<Age days={x.days} />} />)}
        </Section>
        <Section title="ความเสี่ยง" icon={AlertTriangle} tone="var(--tone-danger)" count={w.risks.length}>
          {w.risks.map((x: any, i: number) => <Row key={i} title={x.title} detail={x.detail} refs={x.refs} open={open} />)}
        </Section>
        <Section title="ผลงานเด่น" icon={CheckCircle2} tone="var(--tone-ok)" count={w.wins.length}>
          {w.wins.map((x: any, i: number) => <Row key={i} title={x.title} detail={x.who} refs={x.refs} open={open} />)}
        </Section>
      </div>
      <Section title={B("สัปดาห์หน้า Boss ควรตามอะไร")} icon={Lightbulb} tone="var(--brand-navy)">
        {w.nextWeek.map((x: any, i: number) => <Row key={i} title={x.title} detail={x.why} refs={x.refs} open={open} />)}
      </Section>
    </div>
  );
}

function SearchView({ open, say }: { open: (n: number) => void; say: (t: string) => void }) {
  const [from, setFrom] = useState(DAYS[0]!);
  const [to, setTo] = useState(DAYS[DAYS.length - 1]!);
  const [round, setRound] = useState<"all" | "m" | "e">("e");
  const [teams, setTeams] = useState<string[]>([]);
  const [colors, setColors] = useState<Color[]>(["red", "yellow"]);
  const [topic, setTopic] = useState<string>("");
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const out: { r: (typeof PARSED)[number]; b: Block }[] = [];
    for (const r of PARSED) {
      if (r.day < from || r.day > to) continue;
      if (round === "m" && !isMorning(r)) continue;
      if (round === "e" && isMorning(r)) continue;
      if (teams.length && !teams.includes(r.team)) continue;
      for (const b of r.blocks) {
        if (topic && b.topic !== topic) continue;
        if (colors.length && !(b.color && colors.includes(b.color))) continue;
        if (q && !(b.content + b.topic).toLowerCase().includes(q.toLowerCase())) continue;
        out.push({ r, b });
      }
    }
    return out;
  }, [from, to, round, teams, colors, topic, q]);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const pill = (on: boolean) => `rounded-full border px-2.5 py-1 text-xs ${on ? "border-(--brand-navy) bg-(--brand-navy) text-white" : "border-(--line) bg-(--bg) text-(--ink-soft)"}`;
  const inputCls = "h-9 rounded-(--radius) border border-(--line) bg-(--bg) px-2 text-sm text-(--ink)";
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Card className="flex flex-col gap-4 p-4 lg:sticky lg:top-4 lg:self-start">
        <div className="flex items-center gap-2 text-sm font-semibold text-(--ink)"><Filter className="h-4 w-4" />ตัวกรอง</div>
        <label className="flex flex-col gap-1 text-xs text-(--ink-soft)">ช่วงวัน
          <div className="flex items-center gap-1">
            <input id="f-from" type="date" value={from} min={DAYS[0]} max={to} onChange={(e) => setFrom(e.target.value)} className={inputCls + " min-w-0 flex-1"} />
            <span>–</span>
            <input id="f-to" type="date" value={to} min={from} max={DAYS[DAYS.length - 1]} onChange={(e) => setTo(e.target.value)} className={inputCls + " min-w-0 flex-1"} />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <button type="button" className={pill(false)} onClick={() => { setFrom("2026-11-10"); setTo("2026-11-10"); }}>เมื่อวาน</button>
            <button type="button" className={pill(false)} onClick={() => { setFrom(DAYS[0]!); setTo(DAYS[DAYS.length - 1]!); }}>7 วัน</button>
            <button type="button" className={pill(false)} onClick={() => say("ของจริง: เลือกรอบเดือน 26–25 หรือเดือนปฏิทินได้")}>เดือนนี้</button>
          </div>
        </label>
        <div className="flex flex-col gap-1 text-xs text-(--ink-soft)">รอบ
          <div className="flex gap-1">{([["all", "ทั้งหมด"], ["m", "เช้า"], ["e", "เย็น"]] as const).map(([k, l]) => <button key={k} type="button" className={pill(round === k)} onClick={() => setRound(k)}>{l}</button>)}</div>
        </div>
        <div className="flex flex-col gap-1 text-xs text-(--ink-soft)">ทีม / คน
          <div className="flex flex-wrap gap-1">{TEAMS.map((t) => <button key={t} type="button" className={pill(teams.includes(t))} onClick={() => setTeams(toggle(teams, t))}>{t}</button>)}</div>
        </div>
        <div className="flex flex-col gap-1 text-xs text-(--ink-soft)">สี
          <div className="flex gap-1">{(["red", "yellow", "green"] as Color[]).map((c) => (
            <button key={c} type="button" className={pill(colors.includes(c)) + " inline-flex items-center gap-1"} onClick={() => setColors(toggle(colors, c))}>
              <span className="h-2 w-2 rounded-full" style={{ background: DOT[c] }} />{COLOR_TH[c]}
            </button>
          ))}</div>
        </div>
        <label className="flex flex-col gap-1 text-xs text-(--ink-soft)">หัวข้อ (ตามฟอร์มของรอบ)
          <select id="f-topic" value={topic} onChange={(e) => setTopic(e.target.value)} className={inputCls}>
            <option value="">ทุกหัวข้อ</option>
            {TOPICS.map((t) => <option key={t} value={label(t)}>{label(t)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-(--ink-soft)">คำค้น
          <div className="relative"><Search className="absolute left-2 top-2.5 h-4 w-4" /><input id="f-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="เช่น HS2, VAT" className={inputCls + " w-full pl-8"} /></div>
        </label>
      </Card>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-(--ink)"><b>{hits.length}</b> หัวข้อ จาก <b>{new Set(hits.map((h) => h.r.n)).size}</b> รายงาน</span>
          <ColorCounts list={hits.map((h) => h.b)} />
          <span className="text-[11px] text-(--ink-soft)">ระบบกรองตามกฎ ไม่ใช้ AI จึงครบทุกฉบับ ไม่เสียเงิน</span>
          <Button size="sm" className="ml-auto bg-(--brand-navy)" onClick={() => say("ของจริง: AI สรุปเฉพาะผลที่กรองนี้ ครั้งละประมาณ ฿0.5–2")}>
            <Sparkles className="mr-1 h-4 w-4" />ให้ AI สรุปผลที่กรองนี้
          </Button>
        </div>
        {hits.length === 0 && <Card className="p-6 text-center text-sm text-(--ink-soft)">ไม่มีหัวข้อที่ตรงกับตัวกรอง</Card>}
        {hits.map(({ r, b }, i) => (
          <Card key={i} className="flex flex-col gap-1.5 p-3.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-(--ink-soft)">
              {b.color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: DOT[b.color] }} />}
              <b className="text-(--ink)">{b.topic}</b>
              <span>· {whoOf(r.n)}</span>
              <span>· {thDay(r.day)} {hm(r.at)} {isMorning(r) ? "(เช้า)" : "(เย็น)"}</span>
              <span className="ml-auto"><Chip n={r.n} open={open} /></span>
            </div>
            <p className="line-clamp-4 whitespace-pre-line text-[13px] leading-relaxed text-(--ink)">{b.content || "—"}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Carry({ open }: { open: (n: number) => void }) {
  const list = [...D.eve.carry].sort((a: any, b: any) => b.daysOpen - a.daysOpen);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-(--ink-soft)">AI จำว่าเรื่องไหนพูดถึงมาหลายวันแล้วยังไม่จบ เรียงจากค้างนานสุด เรื่องจะหายไปเองเมื่อรายงานบอกว่าเสร็จ หรือมีคอมเมนต์ปิดเรื่องในห้อง</p>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-(--line) bg-(--bg-soft) text-left text-xs text-(--ink-soft)">
              <th className="px-3 py-2.5">เรื่อง</th><th className="px-3 py-2.5">ทีม</th><th className="px-3 py-2.5">เริ่ม</th><th className="px-3 py-2.5">ค้าง</th><th className="px-3 py-2.5">ล่าสุด</th><th className="px-3 py-2.5">ที่มา</th>
            </tr></thead>
            <tbody className="divide-y divide-(--line)">
              {list.map((x: any, i: number) => (
                <tr key={i} className="align-top">
                  <td className="px-3 py-2.5 font-medium text-(--ink)">{x.title}</td>
                  <td className="px-3 py-2.5 text-(--ink-soft)">{x.who}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-(--ink-soft)">{thDay(x.firstSeen)}</td>
                  <td className="px-3 py-2.5"><Age days={x.daysOpen} /></td>
                  <td className="px-3 py-2.5 text-(--ink-soft)">{clean(x.todayStatus)}</td>
                  <td className="px-3 py-2.5"><Refs r={x.refs} open={open} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Ask({ open, say, B }: { open: (n: number) => void; say: (t: string) => void; B: (s: string) => string }) {
  const SUGGEST = ["สัปดาห์นี้ทีมช่างค้างอะไรบ้าง", "มีอะไรเกี่ยวกับเงินที่ต้องรู้ไหม", "ใครยังไม่ส่งรายงาน 3 วันติด", "HS2 เกิดอะไรขึ้นตั้งแต่ต้น"];
  const ans: string = D.qa.a;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <p className="text-sm text-(--ink-soft)">ถามเป็นภาษาคน AI ตอบจากรายงานจริงในช่วงวันที่เลือกเท่านั้น และบอกเลขรายงานทุกข้อ</p>
      <div className="flex flex-wrap gap-1.5">{SUGGEST.map((s) => <button key={s} type="button" onClick={() => say("ตัวอย่างนี้ตอบจริงไว้ 1 คำถาม (ด้านล่าง)")} className="rounded-full border border-(--line) bg-(--bg) px-3 py-1 text-xs text-(--ink)">{s}</button>)}</div>
      <div className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-sm bg-(--brand-navy) px-4 py-2.5 text-sm text-white">{D.qa.q}</div></div>
      <div className="flex gap-2">
        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--app-pale)"><Sparkles className="h-4 w-4 text-(--brand-navy)" /></span>
        <Card className="flex min-w-0 flex-col gap-2 p-4 text-sm leading-relaxed text-(--ink)">
          {ans.split("\n").filter(Boolean).map((line, i) => {
            const parts = line.replace(/^\s*-\s*/, "").split(/(\*\*[^*]+\*\*)/g);
            return (
              <div key={i} className="flex gap-2">
                <span className="text-(--ink-soft)">•</span>
                <span className="min-w-0">
                  {parts.map((p, j) => (p.startsWith("**") ? <b key={j}>{p.slice(2, -2)}</b> : <span key={j}>{p.replace(/\(#[\d,\s#]+\)/g, "")}</span>))}{" "}
                  <Refs r={line.match(/\(#[\d,\s#]+\)/)?.[0] ?? ""} open={open} />
                </span>
              </div>
            );
          })}
          <span className="text-[11px] text-(--ink-soft)">gpt-6-sol · {D.qa.thb.toFixed(2)} บาท · ช่วง 7–11 พ.ย.</span>
        </Card>
      </div>
      <div className="sticky bottom-20 flex gap-2 rounded-full border border-(--line) bg-(--bg) p-1.5 shadow-sm">
        <input id="ask" placeholder={B("ถามอะไรก็ได้เกี่ยวกับรายงาน เช่น เรื่องไหนรอ Boss นานสุด")} className="min-w-0 flex-1 bg-transparent px-3 text-sm text-(--ink) outline-none" />
        <Button size="sm" className="rounded-full bg-(--brand-navy)" onClick={() => say("ของจริง: ส่งคำถามให้ AI ครั้งละประมาณ ฿0.3–1.5")}><Send className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

function SettingsView({ boss, say }: { boss: string; say: (t: string) => void }) {
  const [sections, setSections] = useState({ need: true, red: true, carry: true, morningGap: true, teams: true, done: true });
  const [heads, setHeads] = useState(true);
  const [line, setLine] = useState(false);
  const Toggle = ({ on, set, id }: { on: boolean; set: (v: boolean) => void; id: string }) => (
    <button id={id} type="button" role="switch" aria-checked={on} onClick={() => set(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-(--brand-navy)" : "bg-(--line)"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
  const SetRow = ({ t, d, children }: { t: string; d?: string; children: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0"><p className="text-sm font-medium text-(--ink)">{t}</p>{d && <p className="text-xs text-(--ink-soft)">{d}</p>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
  const box = "h-9 rounded-(--radius) border border-(--line) bg-(--bg) px-2 text-sm text-(--ink)";
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="ใครได้รับสรุป" icon={Bell}>
        <SetRow t={boss} d="ทุกห้อง ทุกทีม"><span className="text-xs font-semibold text-(--brand-navy)">ได้รับเสมอ</span></SetRow>
        <SetRow t="หัวหน้าแผนก" d="ได้สรุปเฉพาะทีมของตัวเอง ไม่เห็นทีมอื่น"><Toggle id="s-heads" on={heads} set={setHeads} /></SetRow>
        <SetRow t="เพิ่มคนอื่น" d="เลือกรายคน และเลือกว่าเห็นทีมไหน"><Button size="sm" variant="outline" onClick={() => say("ของจริง: เลือกคน + ทีมที่เห็น")}>+ เพิ่มคน</Button></SetRow>
      </Section>
      <Section title="ส่งเมื่อไรและทางไหน" icon={Clock}>
        <SetRow t="สรุปเช้า" d="หลังปิดรอบเช้า 09:30"><input id="s-m" className={box} defaultValue="09:35" /></SetRow>
        <SetRow t="สรุปเย็น" d="หลังปิดรอบเย็น 20:30"><input id="s-e" className={box} defaultValue="20:35" /></SetRow>
        <SetRow t="สรุปสัปดาห์"><select id="s-w" className={box} defaultValue="sat"><option value="sat">เสาร์ 08:00</option><option value="mon">จันทร์ 08:00</option><option value="off">ไม่ส่ง</option></select></SetRow>
        <SetRow t="สรุปเดือน" d="ตรงรอบเงินเดือน 26–25"><select id="s-mo" className={box} defaultValue="26"><option value="26">วันที่ 26 08:00</option><option value="1">วันที่ 1 08:00</option><option value="off">ไม่ส่ง</option></select></SetRow>
        <SetRow t="แจ้งเตือนในแอป"><span className="text-xs text-(--ink-soft)">เปิดเสมอ</span></SetRow>
        <SetRow t="ส่ง LINE ด้วย" d="ส่งหัวข้อสั้นๆ + ลิงก์มาที่หน้านี้"><Toggle id="s-line" on={line} set={setLine} /></SetRow>
      </Section>
      <Section title="ในสรุปมีหัวข้ออะไรบ้าง" icon={Sparkles}>
        {([["need", `รอ ${boss} ตัดสินใจ`], ["red", "สีแดง (ระบบนับ)"], ["carry", "เรื่องค้างข้ามวัน"], ["morningGap", "แผนเช้าลืมเรื่องค้าง"], ["teams", "รายทีม 1 บรรทัด"], ["done", "งานที่เสร็จ"]] as const).map(([k, l]) => (
          <SetRow key={k} t={l}><Toggle id={`s-${k}`} on={sections[k]} set={(v) => setSections({ ...sections, [k]: v })} /></SetRow>
        ))}
      </Section>
      <Section title="หัวข้อที่ AI และตัวกรองใช้" icon={Filter} note="อ่านจากตั้งค่ารอบ">
        <p className="pb-3 text-xs text-(--ink-soft)">ไม่ต้องตั้งซ้ำ ระบบอ่านหัวข้อจาก <b>ตั้งค่าห้อง › รอบส่งรายงาน</b> แก้ฟอร์มเมื่อไร สรุปและตัวกรองใช้หัวข้อใหม่ทันที รายงานเก่าจะอ่านด้วยฟอร์มตอนที่ส่ง (ค้นย้อนหลังไม่หาย)</p>
        {TOPICS.map((t) => (
          <div key={t} className="flex flex-col py-2 text-[13px]">
            <span className="text-(--ink)">{label(t)}</span>
            {names(t).length > 1 && <span className="text-[11px] text-(--ink-soft)">ชื่อเรียกอื่น: {names(t).slice(1).join(" · ")}</span>}
          </div>
        ))}
        <div className="pt-3"><Button size="sm" variant="outline" onClick={() => say("ของจริง: เปิดหน้าแก้ไขรอบในตั้งค่าห้อง")}><ExternalLink className="mr-1 h-4 w-4" />แก้หัวข้อในตั้งค่ารอบ</Button></div>
      </Section>
      <Section title="AI และค่าใช้จ่าย" icon={Settings2}>
        <SetRow t="รุ่น AI"><select id="s-model" className={box} defaultValue="sol"><option value="sol">gpt-6-sol (แนะนำ)</option><option value="luna">gpt-6-luna (ประหยัด)</option></select></SetRow>
        <SetRow t="เพดานต่อเดือน" d="เกินแล้วหยุดสรุป AI แต่ตัวกรองและการนับสียังใช้ได้"><input id="s-cap" className={box + " w-24"} defaultValue="฿300" /></SetRow>
        <SetRow t="ใช้ไปเดือนนี้"><span className="text-sm font-semibold text-(--ink)">฿0 / ฿300</span></SetRow>
      </Section>
    </div>
  );
}

function Source({ n, close, say }: { n: number; close: () => void; say: (t: string) => void }) {
  const r = PARSED.find((x) => x.n === n);
  if (!r) return null;
  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/30" onClick={close}>
      <div className="flex h-full w-full max-w-md flex-col bg-(--bg) shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-(--line) px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-(--ink)">รายงาน #{n} · {whoOf(n)}</p>
            <p className="text-xs text-(--ink-soft)">{thDay(r.day)} {hm(r.at)} · {isMorning(r) ? "รอบเช้า" : "รอบเย็น"}</p>
          </div>
          <button type="button" onClick={close} className="rounded-full p-1.5 hover:bg-(--bg-soft)" aria-label="ปิด"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto whitespace-pre-wrap px-4 py-3 text-[13px] leading-relaxed text-(--ink)">{r.text}</div>
        <div className="border-t border-(--line) p-3">
          <Button className="w-full bg-(--brand-navy)" onClick={() => say(`ของจริง: เปิดห้อง daily-report ที่รายงาน #${n} เพื่อคอมเมนต์ตอบ`)}>
            <MessageSquare className="mr-1.5 h-4 w-4" />ไปที่รายงานนี้ในห้อง เพื่อคอมเมนต์ตอบ
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------- แท็บ "สรุป" ในห้องรายงานจริง (ตัวอย่าง — page.tsx ของห้องเรียกใช้เฉพาะตอน dev) ---------- */
type RoomView = "eve" | "morn" | "period" | "search" | "ask";
const ROOM_VIEWS: { id: RoomView; label: string }[] = [
  { id: "eve", label: "เย็นนี้" },
  { id: "morn", label: "เช้านี้" },
  { id: "period", label: "สัปดาห์ / เดือน" },
  { id: "search", label: "ค้นหา" },
  { id: "ask", label: "ถาม AI" },
];
export function BriefRoomTab({ boss = "Boss" }: { boss?: string }) {
  const [view, setView] = useState<RoomView>("eve");
  const [src, setSrc] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 2200); };
  const open = (n: number) => setSrc(n);
  const B = (s: string) => s.replace(/Boss|บอส/g, boss);
  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg-soft)]">
      <div className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--bg)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none]">
          {ROOM_VIEWS.map((v) => (
            <button key={v.id} type="button" onClick={() => setView(v.id)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${view === v.id ? "bg-[var(--brand-navy)] text-white" : "text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"}`}>
              {v.label}
            </button>
          ))}
          <button type="button" onClick={() => say("ของจริง: ตั้งค่าอยู่ที่ ตั้งค่าห้อง › แท็บ \"สรุป\" (ใครได้รับ เวลา LINE รุ่น AI)")}
            className="ml-auto shrink-0 rounded-full p-1.5 text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]" aria-label="ตั้งค่าสรุป">
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-3 py-4 pb-28">
        {view === "eve" && <SecretaryBrief kind="eve" open={open} B={B} />}
        {view === "morn" && <SecretaryBrief kind="morn" open={open} B={B} />}
        {view === "period" && <Period open={open} B={B} />}
        {view === "search" && <SearchView open={open} say={say} />}
        {view === "ask" && <Ask open={open} say={say} B={B} />}
      </div>
      {src != null && <Source n={src} close={() => setSrc(null)} say={say} />}
      {toast && <div className="fixed bottom-24 left-1/2 z-[90] -translate-x-1/2 rounded-[var(--radius)] bg-[var(--ink)] px-4 py-2 text-sm text-[var(--bg)] shadow-lg">{toast}</div>}
    </div>
  );
}

/** ใช้ร่วมกับ brief-post.tsx (ตัวอย่างแบบโพสต์ปักหมุด) */
export const briefInternals = { PARSED, SHORT, D, colorOfTopic, RANK, NONE, refsOf, clean, isMorning, thDay, personName, LIGHT, Source, bucketOf, hm };
