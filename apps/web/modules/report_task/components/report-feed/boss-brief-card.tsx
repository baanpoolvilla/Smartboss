"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Send, Settings2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useReportFeedStore, type ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { todayStatusEntries } from "@/modules/report_task/lib/report-feed-compliance";
import { localDateStr } from "@/modules/report_task/lib/now";
import { BRIEF_KINDS, MODEL_PRICES_USD, type BossBrief, type BossBriefView, type BriefColor, type BriefKind } from "@/modules/report_task/lib/boss-brief/types";

/**
 * การ์ด "รอบนี้มีอะไร" บนสุดของหน้าโพสต์ในห้องรายงาน — เห็นเฉพาะ CEO (12/11/2569)
 * หัวการ์ด → กล่องนับ 4 ประเภท → แตะกล่อง = รายการของประเภทนั้น (จุดสี · ใคร · เรื่องอะไร) ไม่เกิน 5 บรรทัด
 * แตะบรรทัด = ไปที่โพสต์ของคนนั้นในห้อง (คอมเมนต์ตอบได้เลย) · ถาม AI ต่อได้ในการ์ด
 */

const DOT: Record<BriefColor, string> = { red: "var(--chart-red, #d6453d)", yellow: "#d39b00", green: "var(--brand-green, #1f9d55)", none: "var(--line)" };
const TH_M = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const thDay = (d: string) => `${Number(d.slice(8, 10))} ${TH_M[Number(d.slice(5, 7))]}`;
const baht = (n: number) => (n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString("th-TH"));

/** อยู่ในแท็บ "สรุป" ของห้อง (12/11/2569 "อยากได้เป็นแท็บสรุป ไม่เอาหัวแบบนี้ เดี๋ยวงง") — ไม่ย่อ/ไม่จำกัดความสูง ไม่เว้นขอบนอก */
export function BossBriefCard({ topic, onJumpToPost }: { topic: ReportTopic; onJumpToPost: (postId: string) => void }) {
  const [view, setView] = useState<BossBriefView | null>(null);
  const [briefId, setBriefId] = useState<string | null>(null);
  const [kind, setKind] = useState<BriefKind>("stuck");
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

  const usageLine = `เดือนนี้ใช้ไป ฿${baht(view.usage.thb)} / ฿${view.usage.capThb.toLocaleString("th-TH")}`;

  if (!brief) {
    return (
      <div className={`${shell} flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm text-[var(--ink-soft)]`}>
        <Sparkles className="h-4 w-4 text-[var(--brand-navy)]" />
        <span>สรุปจะขึ้นที่นี่ 5 นาทีหลังปิดรอบ ({view.roundsWithTopics.map((r) => `${r.label} ${r.time}`).join(" · ")})</span>
        <span className="ml-auto text-xs">{usageLine}</span>
        <button type="button" onClick={() => setPanel(panel === "settings" ? "none" : "settings")} className="rounded-full p-1 hover:bg-[var(--bg-soft)]" aria-label="ตั้งค่าสรุป"><Settings2 className="h-4 w-4" /></button>
        {panel === "settings" && <SettingsPanel view={view} topicId={topic.id} busy={busy} post={post} close={() => setPanel("none")} />}
      </div>
    );
  }

  const list = brief.items[kind];
  const reds = (k: BriefKind) => brief.items[k].filter((i) => i.color === "red").length;
  const roundName = `รอบ ${brief.roundLabel} · ${thDay(brief.day)}`;

  return (
    <div className={shell} data-testid="boss-brief-card">
      {/* หัว */}
      <div className="flex items-start gap-3 px-4 pt-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-navy)] text-white"><Sparkles className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <b className="text-[15px] text-[var(--ink)]">สรุป{roundName}</b>
            <span className="text-xs text-[var(--ink-soft)]">
              ส่งแล้ว {brief.postCount} คน{missing && missing.length > 0 ? ` · ยังไม่ส่ง: ${missing.join(", ")}` : ""}
            </span>
            <span className="ml-auto flex items-center gap-1">
              {view.briefs.length > 1 &&
                view.briefs.slice(0, 3).map((b) => (
                  <button key={b.id} type="button" onClick={() => { setBriefId(b.id); setMore(false); }}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] ${b.id === brief.id ? "border-[var(--brand-navy)] bg-[var(--brand-navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"}`}>
                    {b.roundLabel}{b.day !== localDateStr(new Date()) ? ` (${thDay(b.day)})` : ""}
                  </button>
                ))}
            </span>
          </div>
          {brief.headline && <p className="mt-1 text-[14px] leading-snug text-[var(--ink)]">{brief.headline}</p>}
        </div>
      </div>

      {(
        <>
          {/* กล่องนับ 4 ประเภท */}
          <div className="grid grid-cols-2 gap-2 px-4 pt-3 sm:grid-cols-4">
            {BRIEF_KINDS.map((k) => {
              const on = kind === k.id;
              const red = reds(k.id);
              return (
                <button key={k.id} type="button" onClick={() => { setKind(k.id); setMore(false); }}
                  className={`flex flex-col items-start gap-0.5 rounded-lg border-2 px-3 py-2 text-left transition-colors ${on ? "border-[var(--brand-navy)] bg-[var(--bg-soft)]" : "border-[var(--line)] hover:bg-[var(--bg-soft)]"}`}>
                  <span className="text-xs text-[var(--ink-soft)]">{k.icon} {k.label}</span>
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold text-[var(--ink)]">{brief.items[k.id].length}</span>
                    <span className="text-xs text-[var(--ink-soft)]">เรื่อง</span>
                    {red > 0 && <span className="rounded bg-[var(--bg-soft)] px-1 text-[11px] font-semibold" style={{ color: DOT.red }}>🔴 {red}</span>}
                  </span>
                </button>
              );
            })}
          </div>

          {/* รายการของประเภทที่เลือก */}
          <div className="px-4 pb-2 pt-3">
            {list.length === 0 && <p className="py-2 text-sm text-[var(--ink-soft)]">{BRIEF_KINDS.find((k) => k.id === kind)!.empty}</p>}
            <div className="flex flex-col divide-y divide-[var(--line)]">
              {(more ? list : list.slice(0, 5)).map((it, i) => (
                <button key={`${it.postId}-${i}`} type="button" onClick={() => onJumpToPost(it.postId)} className="flex items-start gap-2.5 py-2 text-left hover:bg-[var(--bg-soft)]">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DOT[it.color] }} />
                  <span className="min-w-0 flex-1 text-[14px] leading-snug text-[var(--ink)]"><b>{it.name}</b> · {it.text}</span>
                </button>
              ))}
            </div>
            {list.length > 5 && (
              <button type="button" onClick={() => setMore(!more)} className="mt-1 text-xs text-[var(--ink-soft)] underline">
                {more ? "ย่อ" : `ดูอีก ${list.length - 5} เรื่อง`}
              </button>
            )}
            {brief.aiSkipped && (
              <p className="mt-2 text-[11px] text-[var(--ink-soft)]">
                {brief.aiSkipped === "cap" ? "ถึงเพดานค่าใช้จ่ายของเดือนนี้ — แสดงข้อความจริงตัดสั้นแทนใจความย่อ" : "AI ย่อไม่สำเร็จรอบนี้ — แสดงข้อความจริงตัดสั้นแทน"}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--line)] px-4 py-2 text-xs text-[var(--ink-soft)]">
            <span>จุดสี = สีที่คนเขียนใส่เอง · แตะบรรทัดเพื่อไปที่โพสต์</span>
            <span className="ml-auto">{usageLine}</span>
            <button type="button" onClick={() => setPanel(panel === "ask" ? "none" : "ask")} className="font-medium text-[var(--brand-navy)] hover:underline">
              💬 ถาม AI{brief.qa.length ? ` (${brief.qa.length})` : ""}
            </button>
            <button type="button" onClick={() => setPanel(panel === "settings" ? "none" : "settings")} className="rounded-full p-1 hover:bg-[var(--bg-soft)]" aria-label="ตั้งค่าสรุป"><Settings2 className="h-4 w-4" /></button>
          </div>

          {panel === "ask" && (
            <div className="flex flex-col gap-2 border-t border-[var(--line)] bg-[var(--bg-soft)] px-4 py-3 text-[13px]">
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
            </div>
          )}
          {panel === "settings" && <SettingsPanel view={view} topicId={topic.id} busy={busy} post={post} close={() => setPanel("none")} />}
        </>
      )}
    </div>
  );
}

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
  const [cap, setCap] = useState(String(view.settings.monthlyCapThb));
  const [sum, setSum] = useState(view.settings.summaryModel);
  const [ask, setAsk] = useState(view.settings.askModel);
  const box = "h-8 rounded-md border border-[var(--line)] bg-white px-2 text-sm";
  return (
    <div className="flex w-full flex-col gap-2 border-t border-[var(--line)] bg-[var(--bg-soft)] px-4 py-3 text-[13px] text-[var(--ink)]">
      <div className="flex items-center justify-between">
        <b>ตั้งค่าสรุป (เห็นเฉพาะคุณ)</b>
        <button type="button" onClick={close} aria-label="ปิด" className="rounded-full p-1 hover:bg-white"><X className="h-4 w-4" /></button>
      </div>
      <p className="text-xs text-[var(--ink-soft)]">
        เดือนนี้ใช้ไป <b className="text-[var(--ink)]">฿{baht(view.usage.thb)}</b> จาก {view.usage.calls} ครั้ง · ถึงเพดานแล้ว AI หยุดย่อ แต่การ์ดยังนับประเภทและสีให้
      </p>
      <label className="flex items-center justify-between gap-3">
        <span>เพดานต่อเดือน (บาท){view.usage.planMaxThb != null && <span className="block text-[11px] text-[var(--ink-soft)]">แพ็กเกจของคุณตั้งได้สูงสุด ฿{view.usage.planMaxThb.toLocaleString("th-TH")}</span>}</span>
        <input id="boss-brief-cap" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ""))} className={`${box} w-24 text-right`} />
      </label>
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
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" disabled={busy} onClick={async () => { await post({ action: "settings", monthlyCapThb: Number(cap || 0), summaryModel: sum, askModel: ask }); close(); }}
          className="rounded-full bg-[var(--brand-navy)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50">บันทึก</button>
        <button type="button" disabled={busy} onClick={() => post({ action: "toggleRoom", topicId, on: false })}
          className="ml-auto rounded-full border border-[var(--line)] bg-white px-3 py-1 text-xs text-[var(--ink-soft)] hover:text-[var(--ink)]">ปิดสรุปในห้องนี้</button>
      </div>
    </div>
  );
}
