"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, MessageCircleQuestion, Send, Settings2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useReportFeedStore, type ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { todayStatusEntries } from "@/modules/report_task/lib/report-feed-compliance";
import { localDateStr } from "@/modules/report_task/lib/now";
import { safeLocalStorage } from "@/modules/report_task/lib/safe-storage";
import { BRIEF_KINDS, MODEL_PRICES_USD, type BossBrief, type BossBriefView, type BriefColor, type BriefKind } from "@/modules/report_task/lib/boss-brief/types";

/**
 * การ์ด "รอบนี้มีอะไร" บนสุดของแท็บสรุปในห้องรายงาน — เห็นเฉพาะ CEO (12/11/2569)
 * หัวการ์ด → กล่องนับ 4 ประเภท → แตะกล่อง = รายการของประเภทนั้น (จุดสี · ใคร · เรื่องอะไร) 3 บรรทัดแรก
 * แตะบรรทัด = ไปที่โพสต์ของคนนั้นในห้อง (คอมเมนต์ตอบได้เลย) · ถาม AI ต่อได้ในการ์ด
 */

const DOT: Record<BriefColor, string> = { red: "var(--chart-red, #d6453d)", yellow: "#d39b00", green: "var(--brand-green, #1f9d55)", none: "var(--line)" };
const TH_M = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const thDay = (d: string) => `${Number(d.slice(8, 10))} ${TH_M[Number(d.slice(5, 7))]}`;
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

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/report-task/boss-brief?topicId=${encodeURIComponent(topic.id)}`, { cache: "no-store" });
      if (res.ok) setView((await res.json()) as BossBriefView);
    } catch {
      /* ออฟไลน์ชั่วคราว — ลองใหม่รอบหน้า */
    }
  }, [topic.id]);

  useEffect(() => {
    setView(null);
    setBriefId(null);
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const topics = useReportFeedStore((s) => s.topics);
  const posts = useReportFeedStore((s) => s.posts);
  const exemptions = useReportComplianceExemptions();
  const brief: BossBrief | null = view?.briefs.find((b) => b.id === briefId) ?? view?.briefs[0] ?? null;
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

  // ปุ่มล่างการ์ด — ใหญ่ อ่านง่าย (12/11/2569 "ที่วงมันแปลกๆเล็กๆทั้งที่มันเป็นอะไรที่สำคัญ")
  const settingsBtn = (
    <button type="button" onClick={() => setPanel(panel === "settings" ? "none" : "settings")} aria-expanded={panel === "settings"} aria-label="ตั้งค่าสรุป"
      className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border px-3 py-2 text-left sm:ml-auto sm:max-w-xs transition-colors ${panel === "settings" ? "border-[var(--brand-navy)] bg-[var(--bg-soft)]" : "border-[var(--line)] hover:bg-[var(--bg-soft)]"}`}>
      <Settings2 className="h-4 w-4 shrink-0 text-[var(--brand-navy)]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2 text-[13px]">
          <b className="font-semibold text-[var(--ink)]">ตั้งค่า</b>
          <span className="truncate text-[12px] tabular-nums text-[var(--ink-soft)]">ใช้ไป <b className="text-[var(--ink)]">฿{baht(view.usage.thb)}</b> / ฿{view.usage.capThb.toLocaleString("th-TH")}</span>
        </span>
        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
          <span className="block h-full rounded-full" style={{ width: `${Math.max(pct, 2)}%`, background: pct >= 90 ? DOT.red : pct >= 70 ? DOT.yellow : "var(--brand-navy)" }} />
        </span>
      </span>
    </button>
  );

  if (!brief) {
    return (
      <div className={shell}>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm text-[var(--ink-soft)] sm:px-4">
          <Sparkles className="h-4 w-4 text-[var(--brand-navy)]" />
          <span className="min-w-0 flex-1">สรุปจะขึ้นที่นี่ 5 นาทีหลังปิดรอบ ({roundsText})</span>
        </div>
        <div className="flex gap-2 border-t border-[var(--line)] px-3 py-2 sm:px-4">{settingsBtn}</div>
        {panel === "settings" && <SettingsPanel view={view} topicId={topic.id} busy={busy} post={post} close={() => setPanel("none")} />}
      </div>
    );
  }

  const list = brief.items[kind];
  const SHOW = 3;
  const reds = (k: BriefKind) => brief.items[k].filter((i) => i.color === "red").length;
  const roundName = `รอบ ${brief.roundLabel} · ${thDay(brief.day)}`;

  return (
    <div className={shell} data-testid="boss-brief-card">
      {/* หัว: ชื่อรอบ + ใครยังไม่ส่ง + สลับรอบ · ภาพรวม 1 ประโยค */}
      <div className="px-3 pt-2.5 sm:px-4 sm:pt-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Sparkles className="h-4 w-4 shrink-0 text-[var(--brand-navy)]" />
          <b className="text-[14px] text-[var(--ink)] sm:text-[15px]">สรุป{roundName}</b>
          <span className="text-xs text-[var(--ink-soft)]">
            ส่งแล้ว {brief.postCount} คน{missing && missing.length > 0 ? ` · ยังไม่ส่ง: ${missing.join(", ")}` : ""}
          </span>
          {view.briefs.length > 1 && (
            <span className="ml-auto flex items-center gap-1">
              {view.briefs.slice(0, 3).map((b) => (
                <button key={b.id} type="button" onClick={() => { setBriefId(b.id); setMore(false); }}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] ${b.id === brief.id ? "border-[var(--brand-navy)] bg-[var(--brand-navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"}`}>
                  {b.roundLabel}{b.day !== localDateStr(new Date()) ? ` (${thDay(b.day)})` : ""}
                </button>
              ))}
            </span>
          )}
        </div>
        {brief.headline && <p className="mt-1 text-[13px] leading-snug text-[var(--ink)] sm:text-[14px]">{brief.headline}</p>}
        <div role="tablist" aria-label="ดูสรุปแบบ" className="mt-2 inline-flex rounded-lg bg-[var(--bg-soft)] p-0.5 text-[13px]">
          {([["person", `รายคน (${brief.people.length})`], ["kind", "ตามเรื่อง"]] as const).map(([m, label]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${mode === m ? "bg-[var(--brand-navy)] text-white" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === "person" && (
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

      {mode === "kind" && (<>
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
        <button type="button" onClick={() => setPanel(panel === "ask" ? "none" : "ask")} aria-expanded={panel === "ask"}
          className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-semibold transition-colors ${panel === "ask" ? "border-[var(--brand-navy)] bg-[var(--brand-navy)] text-white" : "border-[var(--brand-navy)] text-[var(--brand-navy)] hover:bg-[var(--bg-soft)]"}`}>
          <MessageCircleQuestion className="h-4 w-4" /> ถาม AI{brief.qa.length ? ` (${brief.qa.length})` : ""}
        </button>
        {settingsBtn}
      </div>

      {panel === "ask" && (
        <div className="flex flex-col gap-2 border-t border-[var(--line)] bg-[var(--bg-soft)] px-3 py-3 text-[13px] sm:px-4">
          {brief.qa.map((x, i) => (
            <div key={i} className="flex flex-col gap-1">
              <p className="font-medium text-[var(--ink)]">คุณ: {x.q}</p>
              <p className="whitespace-pre-line text-[var(--ink)]">{x.a.replaceAll("**", "")}</p>
            </div>
          ))}
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!question.trim() || busy) return;
              const r = await post({ action: "ask", briefId: brief.id, question });
              if (r) setQuestion("");
            }}
          >
            <input id="boss-brief-ask" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="ถามจากรายงาน เช่น ทีมช่างค้างอะไรบ้าง"
              className="min-w-0 flex-1 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-sm outline-none [@media(pointer:coarse)]:text-base" />
            <button type="submit" disabled={busy || !question.trim()} className="flex items-center gap-1 rounded-full bg-[var(--brand-navy)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} ถาม
            </button>
          </form>
          <p className="text-[11px] text-[var(--ink-soft)]">ตอบจากรายงานรอบนี้ + 3 วันก่อนหน้า · ถาม 1 ครั้ง ≈ ฿0.4</p>
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
        <p className="text-[11px] text-[var(--ink-soft)]">ประมาณการ: สรุป 1 รอบ ≈ ฿0.05 · ถาม AI 1 ครั้ง ≈ ฿0.4 → ห้องเดียววันละรอบ ≈ ฿2/เดือน</p>
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
