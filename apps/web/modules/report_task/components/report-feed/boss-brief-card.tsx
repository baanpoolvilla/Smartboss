"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Send, Settings2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useReportFeedStore, type ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { todayStatusEntries } from "@/modules/report_task/lib/report-feed-compliance";
import { localDateStr } from "@/modules/report_task/lib/now";
import { safeLocalStorage } from "@/modules/report_task/lib/safe-storage";
import { BriefDetailView, briefIcon } from "./boss-brief-detail";
import { AiText } from "./ai-text";
import { BRIEF_KINDS, MODEL_PRICES_USD, SOURCE_LABEL, type BossBrief, type BossBriefView, type BriefColor, type BriefKind } from "@/modules/report_task/lib/boss-brief/types";

/**
 * การ์ด "รอบนี้มีอะไร" บนสุดของแท็บสรุปในห้องรายงาน — เห็นเฉพาะ CEO (12/11/2569)
 * หัวการ์ด → กล่องนับ 4 ประเภท → แตะกล่อง = รายการของประเภทนั้น (จุดสี · ใคร · เรื่องอะไร) 3 บรรทัดแรก
 * แตะบรรทัด = ไปที่โพสต์ของคนนั้นในห้อง (คอมเมนต์ตอบได้เลย) · ถาม AI ต่อได้ในการ์ด
 */

const DOT: Record<BriefColor, string> = { red: "var(--chart-red, #d6453d)", yellow: "#d39b00", green: "var(--brand-green, #1f9d55)", none: "var(--line)" };
/** น้อง SmartBoss — หน้าตาของผู้ช่วย AI (public/brand) · รูปนิ่งสำหรับปุ่ม/รูปโปรไฟล์ · รูปขยับตอนชวนถาม/กำลังคิด */
const MASCOT = "/brand/smartboss-ai-128.png";
const MASCOT_ANIM = "/brand/smartboss-ai-anim.webp";
const TH_M = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const thDay = (d: string) => `${Number(d.slice(8, 10))} ${TH_M[Number(d.slice(5, 7))]}`;
const TH_WD = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const thWeekday = (d: string) => TH_WD[new Date(`${d}T12:00:00`).getDay()];
const addDays = (d: string, n: number) => localDateStr(new Date(Date.parse(`${d}T12:00:00`) + n * 86_400_000));
const baht = (n: number) => (n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString("th-TH"));

/** อยู่ในแท็บ "สรุป" ของห้อง (12/11/2569 "อยากได้เป็นแท็บสรุป ไม่เอาหัวแบบนี้ เดี๋ยวงง") — ไม่ย่อ/ไม่จำกัดความสูง ไม่เว้นขอบนอก */
const SHORT: Record<BriefKind, string> = { stuck: "ปัญหา", late: "ล่าช้า", ask: "รอคุณ", done: "เสร็จ" };

export function BossBriefCard({ topic, onJumpToPost }: { topic: ReportTopic; onJumpToPost: (postId: string) => void }) {
  const [view, setView] = useState<BossBriefView | null>(null);
  const [briefId, setBriefId] = useState<string | null>(null);
  const [kind, setKind] = useState<BriefKind>("stuck");
  // รายคน = ใครเจออะไร งานไหน ยังไง คนละบรรทัด (12/11/2569 "อยากได้แบบสรุปมาให้เลยใครเจออะไรยังไงงานไหน")
  const [mode, setModeState] = useState<"kind" | "person">(() => (safeLocalStorage.getItem("boss-brief-mode") === "kind" ? "kind" : "person"));
  const setMode = (m: "kind" | "person") => {
    setModeState(m);
    setMore(false);
    try { safeLocalStorage.setItem("boss-brief-mode", m); } catch { /* ไม่เป็นไร */ }
  };
  const [more, setMore] = useState(false);
  const [panel, setPanel] = useState<"none" | "ask" | "settings">("none");
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  // คำถามที่กำลังรอคำตอบ — โชว์เป็นฟองของเราทันที ไม่ต้องรอ AI
  const [asking, setAsking] = useState<string | null>(null);
  // ทีละวัน (เลือกวัน + รอบ) / สรุปรวมหลายวัน (13/11/2569 "ดูหลายวันก็เลือกดูได้" + "ต้องมีสรุปรวมสิ")
  const [span, setSpan] = useState<"day" | "range">("day");
  const [rangeId, setRangeId] = useState<string | null>(null);
  const [waitingRange, setWaitingRange] = useState<string | null>(null);
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [rangeSel, setRangeSel] = useState("7 วันล่าสุด");
  const [from, setFrom] = useState(() => addDays(localDateStr(new Date()), -6));
  const [to, setTo] = useState(() => localDateStr(new Date()));

  // สรุปที่กำลังดู — ส่งให้เซิร์ฟเวอร์คืนแบบเต็มอันเดียว (รายการวันอื่นมาแบบย่อ) ลดข้อมูลที่โหลดทุกนาที
  const shownRef = useRef<string | null>(null);
  const load = useCallback(async () => {
    try {
      const id = shownRef.current;
      const res = await fetch(`/api/report-task/boss-brief?topicId=${encodeURIComponent(topic.id)}${id ? `&briefId=${encodeURIComponent(id)}` : ""}`, { cache: "no-store" });
      if (res.ok) setView((await res.json()) as BossBriefView);
    } catch {
      /* ออฟไลน์ชั่วคราว — ลองใหม่รอบหน้า */
    }
  }, [topic.id]);

  useEffect(() => {
    setView(null);
    setBriefId(null);
    setRangeId(null);
    setSpan("day");
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const topics = useReportFeedStore((s) => s.topics);
  const posts = useReportFeedStore((s) => s.posts);
  const exemptions = useReportComplianceExemptions();
  const dayBrief: BossBrief | null = view?.briefs.find((b) => b.id === briefId) ?? view?.briefs[0] ?? null;
  const rangeBrief: BossBrief | null = view?.ranges?.find((b) => b.id === rangeId) ?? null;
  // เปิดแท็บสรุปรวม: มีที่เคยสรุปไว้ = เปิดอันล่าสุดเลย · ไม่มี = เลือก 7 วันล่าสุดไว้ รอกดสรุป
  const openRange = () => {
    setSpan("range");
    const last = view?.ranges?.[0];
    if (last && !rangeId) {
      setRangeId(last.id);
      setRangeSel(`r:${last.id}`);
      setFrom(last.rangeFrom!);
      setTo(last.day);
    }
  };
  const shownLight: BossBrief | null = span === "range" ? rangeBrief : dayBrief;
  shownRef.current = shownLight?.id ?? null;
  // แสดงได้เมื่อได้แบบเต็มของอันนั้นแล้ว · ยังไม่ได้ = ขอใหม่ (ระหว่างนั้นการ์ดโชว์ "กำลังโหลด")
  const brief: BossBrief | null = shownLight && view?.current?.id === shownLight.id ? view.current : null;
  const needFull = !!shownLight && view?.current?.id !== shownLight.id;
  useEffect(() => {
    if (needFull) void load();
  }, [needFull, shownLight?.id, load]);
  const pending = (view?.rangePending?.length ?? 0) > 0;
  // สรุปรวมทำเบื้องหลัง ~1 นาที — ถามซ้ำทุก 4 วิระหว่างรอ แล้วเปิดผลให้เองเมื่อเสร็จ
  useEffect(() => {
    if (!pending && !waitingRange) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [pending, waitingRange, load]);
  useEffect(() => {
    if (!waitingRange || !view) return;
    if (view.ranges?.some((r) => r.id === waitingRange)) {
      setRangeId(waitingRange);
      setRangeSel(`r:${waitingRange}`);
      setWaitingRange(null);
    } else {
      const f = view.rangeFailed?.find((x) => x.id === waitingRange);
      if (f) {
        toast.error(f.error);
        setWaitingRange(null);
      }
    }
  }, [view, waitingRange]);
  const days = useMemo(() => [...new Set((view?.briefs ?? []).map((b) => b.day))].sort((a, b) => b.localeCompare(a)), [view]);
  // "เปิดคนนี้" ใช้ครั้งเดียว — ไม่งั้นโหลดซ้ำทุกนาทีแล้วแผ่นที่ปิดไปเด้งกลับมา
  // ล้างหลังสรุปแบบเต็มของวันนั้นโหลดมาแล้วเท่านั้น (ไม่งั้นแผ่นไม่เปิดเพราะยังไม่มีข้อมูล)
  const fullId = view?.current?.id;
  useEffect(() => {
    if (!openUser || !fullId || fullId !== shownRef.current) return;
    const t = setTimeout(() => setOpenUser(null), 0);
    return () => clearTimeout(t);
  }, [openUser, fullId]);
  const missing = useMemo(() => {
    if (!brief || brief.day !== localDateStr(new Date())) return null;
    return todayStatusEntries(topics.filter((t) => t.id === topic.id), posts, exemptions)
      .filter((e) => e.roundId === brief.roundId && e.status === "missing")
      .map((e) => e.userName);
  }, [brief, topics, posts, exemptions, topic.id]);

  if (!view?.allowed || view.roundsWithTopics.length === 0) return null;
  const enabled = view.settings.topicIds.includes(topic.id);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/report-task/boss-brief", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "ไม่สำเร็จ");
      await load();
      return json;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ไม่สำเร็จ");
      return null;
    } finally {
      setBusy(false);
    }
  }

  const shell = "rounded-xl border border-[var(--line)] bg-white shadow-sm";

  // ยังไม่เปิดในห้องนี้ — แถบบาง ๆ ให้ Boss เปิดเอง
  if (!enabled) {
    return (
      <div className={`${shell} flex flex-wrap items-center gap-2 px-4 py-2.5`}>
        <Sparkles className="h-4 w-4 text-[var(--brand-navy)]" />
        <span className="text-sm text-[var(--ink)]">ให้ AI สรุปรายงานห้องนี้ให้คุณหลังปิดรอบ ({view.roundsWithTopics.map((r) => `${r.label} ${r.time}`).join(" · ")})</span>
        <button type="button" disabled={busy} onClick={() => post({ action: "toggleRoom", topicId: topic.id, on: true })}
          className="ml-auto rounded-full bg-[var(--brand-navy)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
          เปิดสรุป
        </button>
      </div>
    );
  }

  const pct = view.usage.capThb > 0 ? Math.min(100, (view.usage.thb / view.usage.capThb) * 100) : 100;
  const roundsText = view.roundsWithTopics.map((r) => `${r.label} ${r.time}`).join(" · ");

  // ตั้งค่า = ปุ่มเล็กบนหัวการ์ด บอกค่าใช้จ่ายเดือนนี้ (13/11/2569 "กินพื้นที่ทั้งหน้า ลกมาก") — เดิมเป็นแถบใหญ่ท้ายการ์ด
  const settingsBtn = (
    <button type="button" onClick={() => setPanel(panel === "settings" ? "none" : "settings")} aria-expanded={panel === "settings"} aria-label="ตั้งค่าสรุป" title="ตั้งค่า และค่า AI เดือนนี้"
      className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[12px] tabular-nums transition-colors ${panel === "settings" ? "border-[var(--brand-navy)] bg-[var(--bg-soft)]" : "border-[var(--line)] hover:bg-[var(--bg-soft)]"}`}>
      <Settings2 className="h-3.5 w-3.5 text-[var(--brand-navy)]" />
      <b style={{ color: pct >= 90 ? DOT.red : "var(--ink)" }}>฿{baht(view.usage.thb)}</b>
      <span className="text-[var(--ink-soft)]">/{view.usage.capThb.toLocaleString("th-TH")}</span>
    </button>
  );

  if (!shownLight && span === "day" && !(view.ranges?.length)) {
    return (
      <div className={shell}>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm text-[var(--ink-soft)] sm:px-4">
          <Sparkles className="h-4 w-4 text-[var(--brand-navy)]" />
          <span className="min-w-0 flex-1">สรุปจะขึ้นที่นี่ 5 นาทีหลังปิดรอบ ({roundsText})</span>
          <button type="button" onClick={() => openRange()} className="rounded-full border border-[var(--brand-navy)] px-3 py-1 text-xs font-medium text-[var(--brand-navy)]">สรุปรวมหลายวัน</button>
          {settingsBtn}
        </div>
        {panel === "settings" && <SettingsPanel view={view} topicId={topic.id} busy={busy} post={post} close={() => setPanel("none")} />}
      </div>
    );
  }

  const today = localDateStr(new Date());
  const pickDay = (d: string) => {
    const same = view.briefs.find((b) => b.day === d && b.roundId === dayBrief?.roundId);
    setBriefId((same ?? view.briefs.find((b) => b.day === d))?.id ?? null);
    setOpenUser(null);
    setMore(false);
  };
  const runRange = async (f: string, t: string) => {
    const r = (await post({ action: "range", topicId: topic.id, from: f, to: t })) as { id: string; status: "done" | "pending" } | null;
    if (!r) return;
    setFrom(f);
    setTo(t);
    if (r.status === "done") { setRangeId(r.id); setRangeSel(`r:${r.id}`); }
    else setWaitingRange(r.id);
  };
  const postsIn = (f: string, t: string) =>
    posts.filter((p) => p.topicId === topic.id && !p.excludeFromSubmission && (() => { const d = localDateStr(new Date(p.createdAt)); return d >= f && d <= t; })()).length;
  const estimate = (f: string, t: string) => Math.max(1, Math.round(Math.min(postsIn(f, t), 150) * 0.06 + 1.8));
  const monday = addDays(today, -((new Date(`${today}T12:00:00`).getDay() + 6) % 7));
  const presets: [string, string, string][] = [
    ["7 วันล่าสุด", addDays(today, -6), today],
    ["สัปดาห์นี้", monday, today],
    ["30 วันล่าสุด", addDays(today, -29), today],
    ["เดือนนี้", `${today.slice(0, 8)}01`, today],
  ];
  const tabBtn = (on: boolean) => `rounded-md px-3 py-1 font-medium transition-colors ${on ? "bg-[var(--brand-navy)] text-white" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"}`;
  const chip = (on: boolean) => `rounded-full border px-2.5 py-1 text-[12px] ${on ? "border-[var(--brand-navy)] bg-[var(--brand-navy)] font-semibold text-white" : "border-[var(--line)] text-[var(--ink)] hover:bg-[var(--bg-soft)]"}`;
  const kindWord = (b: BossBrief) =>
    b.rangeFrom
      ? `${b.postCount} รายงาน`
      : b.detail?.roundKind === "plan"
      ? "แผนงานของวันนี้"
      : b.detail?.period === "weekly"
      ? "ผลงานของสัปดาห์นี้"
      : b.detail?.period === "monthly"
      ? "ผลงานของเดือนนี้"
      : b.detail
      ? "ผลงานของวันนี้"
      : "";

  const savedFor = (f: string, t: string) => view.ranges?.find((r) => r.rangeFrom === f && r.day === t) ?? null;
  // ช่วงที่เลือก: preset / สรุปที่เคยทำ / เลือกเอง — ช่วงที่เคยสรุปแล้วเปิดเลย ไม่ต้องกดสรุปซ้ำ
  const pickRange = (v: string) => {
    setRangeSel(v);
    if (v.startsWith("r:")) { setRangeId(v.slice(2)); return; }
    if (v === "custom") { setRangeId(savedFor(from, to)?.id ?? null); return; }
    const p = presets.find(([label]) => label === v);
    if (!p) return;
    setFrom(p[1]);
    setTo(p[2]);
    setRangeId(savedFor(p[1], p[2])?.id ?? null);
  };
  const needRun = !(rangeBrief && rangeBrief.rangeFrom === from && rangeBrief.day === to);
  const field = "h-8 rounded-md border border-[var(--line)] bg-white px-2 text-[13px]";

  const picker = (
    <div className="px-3 pt-2.5 sm:px-4 sm:pt-3">
      <div className="flex items-center gap-2">
        <div role="tablist" aria-label="ดูสรุปแบบ" className="inline-flex shrink-0 rounded-lg bg-[var(--bg-soft)] p-0.5 text-[13px]">
          <button type="button" role="tab" aria-selected={span === "day"} onClick={() => setSpan("day")} className={tabBtn(span === "day")}>ทีละวัน</button>
          <button type="button" role="tab" aria-selected={span === "range"} onClick={() => openRange()} className={tabBtn(span === "range")} data-testid="boss-brief-range-tab">สรุปรวม</button>
        </div>
        {settingsBtn}
      </div>

      {span === "day" && dayBrief && (() => {
        const i = days.indexOf(dayBrief.day);
        const rounds = view.briefs.filter((b) => b.day === dayBrief.day).sort((a, b) => a.roundTime.localeCompare(b.roundTime));
        return (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="boss-brief-daypicker">
            <div className="inline-flex items-center rounded-lg border border-[var(--line)] bg-white">
              <button type="button" aria-label="วันก่อนหน้า" disabled={i >= days.length - 1} onClick={() => pickDay(days[i + 1]!)}
                className="rounded-l-lg p-1 text-[var(--ink)] hover:bg-[var(--bg-soft)] disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
              <span className="px-1 text-center text-[13px] font-semibold text-[var(--ink)]">
                {dayBrief.day === today ? "วันนี้" : `วัน${thWeekday(dayBrief.day)}`} {thDay(dayBrief.day)}
              </span>
              <button type="button" aria-label="วันถัดไป" disabled={i <= 0} onClick={() => pickDay(days[i - 1]!)}
                className="rounded-r-lg p-1 text-[var(--ink)] hover:bg-[var(--bg-soft)] disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
            </div>
            {rounds.length > 1 && rounds.map((b) => (
              <button key={b.id} type="button" aria-pressed={b.id === dayBrief.id} onClick={() => { setBriefId(b.id); setOpenUser(null); setMore(false); }} className={chip(b.id === dayBrief.id)}>
                {briefIcon(b)} {b.roundLabel}
              </button>
            ))}
          </div>
        );
      })()}

      {span === "range" && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="boss-brief-rangepicker">
          <select id="boss-brief-range" aria-label="เลือกช่วงวัน" value={rangeSel} onChange={(e) => pickRange(e.target.value)} className={`${field} min-w-0 max-w-full font-medium text-[var(--ink)]`}>
            <optgroup label="ช่วงวัน">
              {presets.map(([label, f, t]) => (
                <option key={label} value={label}>{label} ({thDay(f)}–{thDay(t)}){savedFor(f, t) ? " ✓" : ""}</option>
              ))}
              <option value="custom">เลือกช่วงเอง…</option>
            </optgroup>
            {(view.ranges?.length ?? 0) > 0 && (
              <optgroup label="สรุปไว้แล้ว (เปิดได้เลย ไม่เสียเงิน)">
                {view.ranges.map((r) => <option key={r.id} value={`r:${r.id}`}>{thDay(r.rangeFrom!)} – {thDay(r.day)} ✓</option>)}
              </optgroup>
            )}
          </select>
          {rangeSel === "custom" && (
            <>
              <input id="boss-brief-from" type="date" aria-label="ตั้งแต่วันที่" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setRangeId(savedFor(e.target.value, to)?.id ?? null); }} className={field} />
              <span className="text-[var(--ink-soft)]">–</span>
              <input id="boss-brief-to" type="date" aria-label="ถึงวันที่" value={to} min={from} max={today} onChange={(e) => { setTo(e.target.value); setRangeId(savedFor(from, e.target.value)?.id ?? null); }} className={field} />
            </>
          )}
          {pending || waitingRange ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ink-soft)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังสรุป ~1 นาที</span>
          ) : (
            needRun && (
              <button type="button" disabled={busy || !from || !to || from > to} onClick={() => runRange(from, to)} data-testid="boss-brief-range-run"
                className="h-8 rounded-full bg-[var(--brand-navy)] px-3 text-[12px] font-semibold text-white disabled:opacity-50">
                สรุป ≈฿{estimate(from, to)}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );

  if (!brief) {
    return (
      <div className={shell} data-testid="boss-brief-card">
        {picker}
        {needFull ? (
          <p className="flex items-center gap-2 px-3 py-3 text-[13px] text-[var(--ink-soft)] sm:px-4"><Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดสรุป…</p>
        ) : (
          <div className="pb-2.5" />
        )}
        {panel === "settings" && <SettingsPanel view={view} topicId={topic.id} busy={busy} post={post} close={() => setPanel("none")} />}
      </div>
    );
  }

  const list = brief.items[kind];
  const SHOW = 3;
  const reds = (k: BriefKind) => brief.items[k].filter((i) => i.color === "red").length;
  const roundName = brief.rangeFrom ? `รวม ${thDay(brief.rangeFrom)} – ${thDay(brief.day)}` : `รอบ ${brief.roundLabel} · ${thDay(brief.day)}`;

  return (
    <div className={shell} data-testid="boss-brief-card">
      {picker}
      {/* ชื่อสรุป + ส่งแล้ว/ยังไม่ส่ง · ภาพรวม 1 ประโยค */}
      <div className="px-3 pt-2 sm:px-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <b className="text-[14px] text-[var(--ink)] sm:text-[15px]">
            {briefIcon(brief)} สรุป{roundName}
            {kindWord(brief) && <span className="font-normal text-[var(--ink-soft)]"> · {kindWord(brief)}</span>}
          </b>
          {!brief.rangeFrom && (
            <span className="text-xs text-[var(--ink-soft)]">
              ส่งแล้ว {brief.postCount} คน{missing && missing.length > 0 ? ` · ยังไม่ส่ง: ${missing.join(", ")}` : ""}
            </span>
          )}
        </div>
        {brief.headline && <p className="mt-1 text-[13px] leading-snug text-[var(--ink)] sm:text-[14px]">{brief.headline}</p>}
        {!brief.detail && <div role="tablist" aria-label="ดูสรุปแบบ" className="mt-2 inline-flex rounded-lg bg-[var(--bg-soft)] p-0.5 text-[13px]">
          {([["person", `รายคน (${brief.people.length})`], ["kind", "ตามเรื่อง"]] as const).map(([m, label]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${mode === m ? "bg-[var(--brand-navy)] text-white" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"}`}>
              {label}
            </button>
          ))}
        </div>}
      </div>

      {brief.detail && (
        <div className="pt-2">
          <BriefDetailView
            brief={brief}
            onJumpToPost={onJumpToPost}
            others={view.briefs}
            openUserId={openUser}
            onOpenOther={(id, uid) => { setSpan("day"); setBriefId(id); setOpenUser(uid); }}
          />
        </div>
      )}

      {!brief.detail && mode === "person" && (
        <div className="px-3 pb-1 pt-1.5 sm:px-4" data-testid="boss-brief-people">
          <div className="flex flex-col divide-y divide-[var(--line)]">
            {brief.people.map((pp) => (
              <button key={pp.postId} type="button" onClick={() => onJumpToPost(pp.postId)} title="ไปที่รายงานของคนนี้" className="flex items-start gap-2 py-1.5 text-left hover:bg-[var(--bg-soft)] sm:gap-2.5">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DOT[pp.worst] }} />
                <span className="min-w-0 flex-1 text-[13px] leading-snug text-[var(--ink)] sm:text-[14px]"><b>{pp.name}</b> · {pp.oneLine}</span>
                <span className="shrink-0 pt-0.5 text-xs text-[var(--ink-faint,var(--ink-soft))]">›</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!brief.detail && mode === "kind" && (<>
      {/* 4 ประเภท — แถวเดียว ทั้งคอมและมือถือ (12/11/2569 "ยังกินพื้นที่เยอะไป") */}
      <div className="grid grid-cols-4 gap-1.5 px-3 pt-2.5 sm:gap-2 sm:px-4">
        {BRIEF_KINDS.map((k) => {
          const on = kind === k.id;
          const red = reds(k.id);
          return (
            <button key={k.id} type="button" onClick={() => { setKind(k.id); setMore(false); }} aria-pressed={on} aria-label={`${k.label} ${brief.items[k.id].length} เรื่อง`}
              className={`flex flex-col items-center rounded-lg border-2 px-1 py-1 text-center transition-colors sm:flex-row sm:gap-2 sm:px-3 sm:py-1.5 sm:text-left ${on ? "border-[var(--brand-navy)] bg-[var(--bg-soft)]" : "border-[var(--line)] hover:bg-[var(--bg-soft)]"}`}>
              <span className="flex items-baseline gap-1">
                <span className="text-[13px]">{k.icon}</span>
                <span className="text-lg font-bold leading-tight text-[var(--ink)] sm:text-xl">{brief.items[k.id].length}</span>
                {red > 0 && <span className="text-[10px] font-semibold sm:text-[11px]" style={{ color: DOT.red }}>🔴{red}</span>}
              </span>
              <span className="text-[11px] leading-tight text-[var(--ink-soft)] sm:hidden">{SHORT[k.id]}</span>
              <span className="hidden truncate text-xs text-[var(--ink-soft)] sm:inline">{k.label}</span>
            </button>
          );
        })}
      </div>

      {/* รายการของประเภทที่เลือก — 3 บรรทัดแรก ที่เหลือกดดูอีก */}
      <div className="px-3 pb-1 pt-1.5 sm:px-4">
        {list.length === 0 && <p className="py-2 text-sm text-[var(--ink-soft)]">{BRIEF_KINDS.find((k) => k.id === kind)!.empty}</p>}
        <div className="flex flex-col divide-y divide-[var(--line)]">
          {(more ? list : list.slice(0, SHOW)).map((it, i) => (
            <button key={`${it.postId}-${i}`} type="button" onClick={() => onJumpToPost(it.postId)} title="ไปที่โพสต์นี้" className="flex items-start gap-2 py-1.5 text-left hover:bg-[var(--bg-soft)] sm:gap-2.5">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DOT[it.color] }} />
              <span className="min-w-0 flex-1 text-[13px] leading-snug text-[var(--ink)] sm:text-[14px]"><b>{it.name}</b> · {it.text}</span>
            </button>
          ))}
        </div>
        {list.length > SHOW && (
          <button type="button" onClick={() => setMore(!more)} className="py-1 text-xs font-medium text-[var(--brand-navy)]">
            {more ? "ย่อ" : `ดูอีก ${list.length - SHOW} เรื่อง`}
          </button>
        )}
        {brief.aiSkipped && (
          <p className="mt-1 text-[11px] text-[var(--ink-soft)]">
            {brief.aiSkipped === "cap" ? "ถึงเพดานค่าใช้จ่ายของเดือนนี้ — แสดงข้อความจริงตัดสั้นแทนใจความย่อ" : "AI ย่อไม่สำเร็จรอบนี้ — แสดงข้อความจริงตัดสั้นแทน"}
          </p>
        )}
      </div>

      </>)}

      {/* ปุ่มหลัก 2 ปุ่ม */}
      <div className="flex gap-2 border-t border-[var(--line)] px-3 py-2 sm:px-4">
        {/* ปุ่มคุยกับ AI = น้อง SmartBoss (13/11/2569 "อยากให้มองรู้ว่าคุยกับมันได้ เป็นตัวตุ๊กตาของ smartboss") */}
        <button type="button" onClick={() => setPanel(panel === "ask" ? "none" : "ask")} aria-expanded={panel === "ask"} data-testid="boss-brief-ask-btn"
          className={`flex min-w-0 items-center gap-2 rounded-full border-2 py-1 pl-1 pr-4 text-left transition-colors ${panel === "ask" ? "border-[var(--brand-navy)] bg-[var(--brand-navy)] text-white" : "border-[var(--brand-navy)] bg-white text-[var(--brand-navy)] hover:bg-[var(--bg-soft)]"}`}>
          <img src={MASCOT} alt="" aria-hidden="true" width={36} height={36} className="h-9 w-9 shrink-0 rounded-full bg-white" />
          <span className="min-w-0">
            <b className="block text-[13px] leading-tight">คุยกับ AI{brief.qa.length ? ` (${brief.qa.length})` : ""}</b>
            <span className={`block truncate text-[11px] leading-tight ${panel === "ask" ? "text-white/80" : "text-[var(--ink-soft)]"}`}>ถามอะไรก็ได้เกี่ยวกับบริษัท</span>
          </span>
        </button>
      </div>

      {panel === "ask" && (
        // แชทถาม-ตอบ (13/11/2569 "อยากให้แยกแชท และคำถามชัดเจน") — คำถาม = ฟองขวาสีน้ำเงิน · คำตอบ = ฟองซ้ายสีขาว + ป้าย AI + ค้นจากอะไร
        <div className="flex flex-col gap-2 border-t border-[var(--line)] bg-[var(--bg-soft)] px-3 py-3 text-[13px] sm:px-4" data-testid="boss-brief-chat">
          {brief.qa.length === 0 && !asking && (
            <div className="flex flex-col items-center gap-1 py-1 text-center">
              <img src={MASCOT_ANIM} alt="" aria-hidden="true" width={88} height={88} className="h-[88px] w-[88px]" />
              <p className="text-[13px] font-semibold text-[var(--ink)]">สวัสดีครับ ถามอะไรเกี่ยวกับบริษัทได้เลย</p>
              <p className="text-[12px] text-[var(--ink-soft)]">เช่น "เดือนนี้ใครสายบ่อย" "สระ HS2 เสียกี่ครั้ง" "งานไหนเลยกำหนด"</p>
            </div>
          )}
          {brief.qa.map((x, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-md bg-[var(--brand-navy)] px-3 py-2 text-white">{x.q}</p>
              </div>
              <div className="flex items-start gap-2">
                <img src={MASCOT} alt="" aria-hidden="true" width={28} height={28} className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-white ring-1 ring-[var(--line)]" />
                <div className="min-w-0 max-w-[90%] rounded-2xl rounded-tl-md border border-[var(--line)] bg-white px-3 py-2">
                  <AiText text={x.a} />
                  {(x.sources?.length ?? 0) > 0 && (
                    <p className="mt-1.5 border-t border-[var(--line)] pt-1 text-[11px] text-[var(--ink-soft)]">ค้นจาก: {x.sources!.map((s) => SOURCE_LABEL[s] ?? s).join(" · ")}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
          {asking && (
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-md bg-[var(--brand-navy)] px-3 py-2 text-white opacity-80">{asking}</p>
              </div>
              <div className="flex items-center gap-2 text-[12px] text-[var(--ink-soft)]">
                <img src={MASCOT_ANIM} alt="" aria-hidden="true" width={40} height={40} className="sb-think h-10 w-10 shrink-0" />
                กำลังค้นข้อมูลและตอบ ~10 วินาที
              </div>
            </div>
          )}
          <form
            className="mt-1 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const q = question.trim();
              if (!q || busy) return;
              setAsking(q);
              setQuestion("");
              const r = await post({ action: "ask", briefId: brief.id, question: q });
              setAsking(null);
              if (!r) setQuestion(q);
            }}
          >
            <input id="boss-brief-ask" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="ถามอะไรก็ได้ เช่น เดือนนี้ใครสายบ่อย, สระ HS2 เสียกี่ครั้ง"
              className="min-w-0 flex-1 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-sm outline-none [@media(pointer:coarse)]:text-base" />
            <button type="submit" disabled={busy || !question.trim()} className="flex items-center gap-1 rounded-full bg-[var(--brand-navy)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} ถาม
            </button>
          </form>
          <p className="text-[11px] text-[var(--ink-soft)]">ตอบจากข้อมูลทั้งบริษัท: รายงานทุกห้อง แชทกลุ่ม งาน ใบซ่อม สั่งซื้อ คำขอเงิน ลงเวลา ลา เงินเดือน คะแนน (ไม่อ่านแชทส่วนตัว) · ถาม 1 ครั้ง ≈ ฿1–3</p>
        </div>
      )}
      {panel === "settings" && <SettingsPanel view={view} topicId={topic.id} busy={busy} post={post} close={() => setPanel("none")} />}
    </div>
  );
}

/**
 * ตั้งค่า (12/11/2569 "เรื่องการตั้งค่าละ มันจะทำยังไง") แยก 3 ส่วนให้รู้ว่าอะไรมีผลแค่ไหน:
 * ① ห้องนี้ (เปิด/ปิดสรุปเฉพาะห้องนี้) ② เงินทั้งบริษัท (ใช้ไป + เพดาน ไม่เกินแพ็กเกจ) ③ ขั้นสูง (รุ่น AI — ซ่อนไว้)
 */
function SettingsPanel({
  view,
  topicId,
  busy,
  post,
  close,
}: {
  view: BossBriefView;
  topicId: string;
  busy: boolean;
  post: (b: Record<string, unknown>) => Promise<unknown>;
  close: () => void;
}) {
  const planMax = view.usage.planMaxThb ?? 5000;
  const [cap, setCap] = useState(String(Math.min(view.settings.monthlyCapThb, planMax)));
  const [sum, setSum] = useState(view.settings.summaryModel);
  const [ask, setAsk] = useState(view.settings.askModel);
  const [advanced, setAdvanced] = useState(false);
  const capNum = Number(cap || 0);
  const overMax = capNum > planMax;
  const dirty = capNum !== Math.min(view.settings.monthlyCapThb, planMax) || sum !== view.settings.summaryModel || ask !== view.settings.askModel;
  const pct = view.usage.capThb > 0 ? Math.min(100, (view.usage.thb / view.usage.capThb) * 100) : 100;
  const box = "h-9 rounded-md border border-[var(--line)] bg-white px-2 text-sm";
  const section = "flex flex-col gap-2 rounded-lg border border-[var(--line)] bg-white p-3";
  const otherRooms = view.settings.topicIds.filter((t) => t !== topicId).length;
  return (
    <div className="flex flex-col gap-2.5 border-t border-[var(--line)] bg-[var(--bg-soft)] px-3 py-3 text-[13px] text-[var(--ink)] sm:px-4" data-testid="boss-brief-settings">
      <div className="flex items-center justify-between">
        <b className="text-[14px]">ตั้งค่าสรุปให้ Boss</b>
        <button type="button" onClick={close} aria-label="ปิด" className="rounded-full p-1 hover:bg-white"><X className="h-4 w-4" /></button>
      </div>

      <div className={section}>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">ห้องนี้</p>
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1">
            สรุปห้องนี้ให้ฉันหลังปิดรอบ
            <span className="block text-xs text-[var(--ink-soft)]">{view.roundsWithTopics.map((r) => `${r.label} ${r.time}`).join(" · ")} · ขึ้นหลังปิดรอบ 5 นาที แจ้งเตือนในแอป</span>
          </span>
          <button type="button" disabled={busy} onClick={() => post({ action: "toggleRoom", topicId, on: false })}
            className="shrink-0 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--ink-soft)] hover:text-[var(--ink)] disabled:opacity-50">
            ปิดสรุปห้องนี้
          </button>
        </div>
      </div>

      <div className={section}>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">ค่า AI ของบริษัท (รวมทุกห้อง{otherRooms > 0 ? ` · เปิดอยู่อีก ${otherRooms} ห้อง` : ""})</p>
        <div className="flex items-baseline justify-between gap-2">
          <span>เดือนนี้ใช้ไป <b className="text-[18px] tabular-nums">฿{baht(view.usage.thb)}</b> <span className="text-xs text-[var(--ink-soft)]">({view.usage.calls} ครั้ง)</span></span>
          <span className="text-xs tabular-nums text-[var(--ink-soft)]">เพดาน ฿{view.usage.capThb.toLocaleString("th-TH")}</span>
        </div>
        <span className="block h-2 overflow-hidden rounded-full bg-[var(--line)]">
          <span className="block h-full rounded-full" style={{ width: `${Math.max(pct, 2)}%`, background: pct >= 90 ? DOT.red : pct >= 70 ? DOT.yellow : "var(--brand-navy)" }} />
        </span>
        <label className="flex items-center justify-between gap-3 pt-1">
          <span>
            เพดานต่อเดือน (บาท)
            <span className="block text-[11px] text-[var(--ink-soft)]">ตั้งได้ไม่เกิน ฿{planMax.toLocaleString("th-TH")} ตามแพ็กเกจ · ถึงแล้ว AI หยุดย่อ แต่ยังนับประเภทและสีให้</span>
          </span>
          <input id="boss-brief-cap" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, "").slice(0, 5))}
            className={`${box} w-24 shrink-0 text-right ${overMax ? "border-[var(--chart-red)]" : ""}`} />
        </label>
        {overMax && <p className="text-xs" style={{ color: DOT.red }}>เกินที่แพ็กเกจให้ จะบันทึกเป็น ฿{planMax.toLocaleString("th-TH")}</p>}
        <p className="text-[11px] text-[var(--ink-soft)]">ประมาณการ: สรุปละเอียด 1 รอบ ≈ ฿1.5–2.5 · ถาม AI 1 ครั้ง ≈ ฿0.4 → เช้า+เย็นทุกวัน ≈ ฿110–130/เดือน</p>
      </div>

      <div className={section}>
        <button type="button" onClick={() => setAdvanced(!advanced)} className="flex items-center justify-between text-left">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">ขั้นสูง · รุ่น AI</span>
          <span className="text-xs text-[var(--brand-navy)]">{advanced ? "ซ่อน" : "แสดง"}</span>
        </button>
        {advanced && (
          <>
            <label className="flex items-center justify-between gap-3">ย่อสรุปหลังปิดรอบ
              <select id="boss-brief-sum" value={sum} onChange={(e) => setSum(e.target.value)} className={box}>
                {Object.entries(MODEL_PRICES_USD).map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}
              </select>
            </label>
            <label className="flex items-center justify-between gap-3">ตอบคำถาม
              <select id="boss-brief-askm" value={ask} onChange={(e) => setAsk(e.target.value)} className={box}>
                {Object.entries(MODEL_PRICES_USD).map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}
              </select>
            </label>
            <p className="text-[11px] text-[var(--ink-soft)]">ค่าเริ่มต้นเหมาะแล้ว: ย่อสรุปใช้รุ่นประหยัด ตอบคำถามใช้รุ่นแม่นที่สุด รุ่นแพงขึ้น = ค่าใช้จ่ายต่อครั้งสูงขึ้น 10–20 เท่า</p>
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={close} className="rounded-full px-3 py-1.5 text-xs text-[var(--ink-soft)] hover:text-[var(--ink)]">ยกเลิก</button>
        <button type="button" disabled={busy || !dirty} onClick={async () => { const r = await post({ action: "settings", monthlyCapThb: Math.min(capNum, planMax), summaryModel: sum, askModel: ask }); if (r) { toast.success("บันทึกแล้ว"); close(); } }}
          className="rounded-full bg-[var(--brand-navy)] px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50">บันทึก</button>
      </div>
    </div>
  );
}
