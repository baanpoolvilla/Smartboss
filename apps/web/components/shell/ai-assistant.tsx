"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { AiText } from "@/modules/report_task/components/report-feed/ai-text";
import { SOURCE_LABEL, type BriefQa } from "@/modules/report_task/lib/boss-brief/types";

/**
 * น้อง SmartBoss — ผู้ช่วย AI ลอยมุมซ้ายล่างทุกหน้า เฉพาะ Boss (13/11/2569)
 * ผู้ใช้: "เอาไว้มุมซ้ายทุกหน้า กดไปก็คุยแชทกับ AI แต่เป็นข้อมูลแต่ละบริษัทเอง คำนวณได้ หาได้ พาไปได้ คิดแผนได้"
 * API ตอบ allowed=false (ไม่ใช่ Boss / แพ็กเกจไม่ถึง) = ไม่แสดงอะไรเลย
 * จอคอมฯ: กล่องแชทมุมซ้ายล่าง · มือถือ: เต็มจอ ปุ่มอยู่เหนือแถบเมนูล่าง
 */

const MASCOT = "/brand/smartboss-ai-128.png";
const MASCOT_ANIM = "/brand/smartboss-ai-anim.webp";
const SUGGEST = ["วันนี้มีอะไรที่ฉันต้องรู้บ้าง", "งานไหนเลยกำหนดแล้วบ้าง ของใคร", "เดือนนี้ค่าซ่อมรวมเท่าไร บ้านไหนมากสุด", "ช่วยวางแผนงานสัปดาห์หน้าจากงานที่ค้างอยู่"];
const baht = (n: number) => (n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString("th-TH"));

type View = { allowed: boolean; messages: BriefQa[]; usage: { thb: number; capThb: number } };

export function AiAssistant() {
  const [view, setView] = useState<View | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const [greet, setGreet] = useState(false);
  const path = usePathname();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/ai-assistant", { cache: "no-store" });
      if (r.ok) setView((await r.json()) as View);
    } catch {
      /* ออฟไลน์ — ไม่แสดงปุ่ม */
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // ทักทายครั้งแรกของวัน (ฟองคำพูด 5 วิ) — จำในเครื่องว่าวันนี้ทักแล้ว
  useEffect(() => {
    if (!view?.allowed) return;
    const today = new Date().toDateString();
    let seen = "";
    try { seen = localStorage.getItem("sb-ai-greet") ?? ""; } catch { /* โหมดส่วนตัว — ทักทุกครั้งก็ได้ */ }
    if (seen === today) return;
    const t1 = setTimeout(() => setGreet(true), 1500);
    const t2 = setTimeout(() => setGreet(false), 6500);
    try { localStorage.setItem("sb-ai-greet", today); } catch { /* ไม่เป็นไร */ }
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [view?.allowed]);
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [open, view?.messages.length, asking]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", k);
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  if (!view?.allowed) return null;

  async function send(text: string) {
    const question = text.trim();
    if (!question || asking) return;
    setAsking(question);
    setQ("");
    try {
      const r = await fetch("/api/ai-assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ask", question, path }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "ไม่สำเร็จ");
      setView((v) => (v ? { ...v, messages: j.messages } : v));
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ไม่สำเร็จ");
      setQ(question);
    } finally {
      setAsking(null);
    }
  }
  async function clear() {
    await fetch("/api/ai-assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "clear" }) });
    setView((v) => (v ? { ...v, messages: [] } : v));
  }
  // กดลิงก์บนมือถือ = ปิดแชทให้เห็นหน้าที่พาไป · จอคอมฯ เปิดค้างไว้คุยต่อได้
  const onNavigate = () => {
    if (window.matchMedia("(max-width: 1023px)").matches) setOpen(false);
  };

  return (
    <>
      {!open && (
        <div className="sb-float fixed left-[max(12px,env(safe-area-inset-left))] z-[60] bottom-[calc(84px+env(safe-area-inset-bottom))] lg:bottom-[max(16px,env(safe-area-inset-bottom))]">
          {/* ฟองคำพูด: ทักครั้งแรกของวัน / ชี้เมาส์ */}
          {(greet || hover) && (
            <div key={greet ? "greet" : "hover"} className="sb-bubble pointer-events-none absolute bottom-[64px] left-1 whitespace-nowrap rounded-2xl rounded-bl-md bg-white px-3 py-1.5 text-[12.5px] font-medium text-[var(--ink)] shadow-lg ring-1 ring-[var(--line)]">
              {greet ? "สวัสดีครับ มีอะไรให้ช่วยไหม 👋" : "คุยกับ AI ไหมครับ?"}
            </div>
          )}
          <button
            type="button"
            onClick={() => { setGreet(false); setOpen(true); }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            aria-label="คุยกับผู้ช่วย AI"
            data-testid="ai-assistant-open"
            className="sb-mascot-btn relative grid h-[60px] w-[60px] place-items-center rounded-full bg-white shadow-lg ring-1 ring-[var(--line)] transition-shadow hover:shadow-xl"
          >
            {/* วงแสงกระเพื่อม = กดได้ */}
            <span aria-hidden="true" className="sb-ping pointer-events-none absolute inset-0 rounded-full bg-[var(--brand-green,#22c55e)]/35" />
            <img src={MASCOT_ANIM} alt="" aria-hidden="true" width={52} height={52} className="sb-life relative h-[52px] w-[52px] rounded-full" />
          </button>
        </div>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="ผู้ช่วย AI"
          data-testid="ai-assistant"
          className="fixed inset-0 z-[70] flex flex-col bg-[var(--bg-soft)] pt-[env(safe-area-inset-top)] lg:inset-auto lg:bottom-4 lg:left-4 lg:h-[min(640px,calc(100vh-32px))] lg:w-[400px] lg:overflow-hidden lg:rounded-2xl lg:border lg:border-[var(--line)] lg:pt-0 lg:shadow-2xl"
        >
          <header className="flex items-center gap-2.5 border-b border-[var(--line)] bg-white px-3 py-2">
            <img src={MASCOT} alt="" aria-hidden="true" width={36} height={36} className="h-9 w-9 rounded-full" />
            <div className="min-w-0 flex-1">
              <b className="block text-[14px] leading-tight text-[var(--ink)]">ผู้ช่วย SmartBoss</b>
              <span className="block truncate text-[11.5px] text-[var(--ink-soft)]">รู้ข้อมูลบริษัทของคุณ · หา คำนวณ พาไป ช่วยคิดแผน</span>
            </div>
            {view.messages.length > 0 && (
              <button type="button" onClick={clear} aria-label="ล้างแชท" title="ล้างแชท" className="rounded-full p-1.5 text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} aria-label="ปิด" className="rounded-full p-1.5 text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]">
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 text-[13.5px]">
            {view.messages.length === 0 && !asking && (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <img src={MASCOT_ANIM} alt="" aria-hidden="true" width={110} height={110} className="h-[110px] w-[110px]" />
                <p className="text-[15px] font-semibold text-[var(--ink)]">สวัสดีครับ ให้ช่วยอะไรดี</p>
                <p className="max-w-[30ch] text-[12.5px] text-[var(--ink-soft)]">ถามได้ทุกเรื่องในบริษัท ทั้งรายงาน งาน ใบซ่อม สั่งซื้อ คำขอเงิน ลงเวลา ลา เงินเดือน</p>
                <div className="mt-1 flex w-full flex-col gap-1.5">
                  {SUGGEST.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-left text-[13px] text-[var(--ink)] hover:border-[var(--brand-navy)]">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {view.messages.map((m, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-md bg-[var(--brand-navy)] px-3 py-2 text-white">{m.q}</p>
                </div>
                <div className="flex items-start gap-2">
                  <img src={MASCOT} alt="" aria-hidden="true" width={28} height={28} className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-white ring-1 ring-[var(--line)]" />
                  <div className="min-w-0 max-w-[88%] rounded-2xl rounded-tl-md border border-[var(--line)] bg-white px-3 py-2">
                    <AiText text={m.a} onNavigate={onNavigate} />
                    {(m.sources?.length ?? 0) > 0 && (
                      <p className="mt-1.5 border-t border-[var(--line)] pt-1 text-[11px] text-[var(--ink-soft)]">ค้นจาก: {m.sources!.map((x) => SOURCE_LABEL[x] ?? x).join(" · ")}</p>
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
                <div className="flex items-center gap-2 text-[12.5px] text-[var(--ink-soft)]">
                  <img src={MASCOT_ANIM} alt="" aria-hidden="true" width={40} height={40} className="sb-think h-10 w-10 shrink-0" />
                  กำลังค้นข้อมูลและคิด ~10 วินาที
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form
            className="flex items-end gap-2 border-t border-[var(--line)] bg-white px-3 py-2 pb-[max(8px,env(safe-area-inset-bottom))]"
            onSubmit={(e) => {
              e.preventDefault();
              void send(q);
            }}
          >
            <textarea
              ref={inputRef}
              id="ai-assistant-input"
              rows={1}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(q);
                }
              }}
              placeholder="พิมพ์คำถาม เช่น เดือนนี้ใครลาเยอะสุด"
              className="max-h-28 min-h-[40px] min-w-0 flex-1 resize-none rounded-2xl border border-[var(--line)] bg-[var(--bg-soft)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-navy)] [@media(pointer:coarse)]:text-base"
            />
            <button type="submit" disabled={!!asking || !q.trim()} aria-label="ส่ง" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--brand-navy)] text-white disabled:opacity-40">
              <Send className="h-4 w-4" />
            </button>
          </form>
          <p className="bg-white px-3 pb-1.5 text-[10.5px] text-[var(--ink-soft)]">
            ใช้ไปเดือนนี้ ฿{baht(view.usage.thb)} / ฿{view.usage.capThb.toLocaleString("th-TH")} · ไม่อ่านแชทส่วนตัว
          </p>
        </div>
      )}
    </>
  );
}
