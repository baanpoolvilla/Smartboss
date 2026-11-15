"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AI_USAGE_LABEL, MODEL_PRICES_USD, THB_PER_USD, type AiUsageKind } from "@/modules/report_task/lib/boss-brief/types";
import type { AiSettingsView } from "@/modules/report_task/lib/boss-brief/ai-settings";

/**
 * หน้าตั้งค่า AI (15/11/2569) — รวมทุกอย่างเรื่อง AI ไว้ที่เดียว ให้ Boss เห็นชัดว่าเงินออกกับอะไร เมื่อไร และปรับได้ตรงไหน
 * ข้อมูลทั้งหมดมาจาก /api/ai-settings (เฉพาะบริษัทที่ล็อกอิน)
 */
const RED = "var(--chart-red, #d6453d)";
const YELLOW = "#d39b00";
const baht = (n: number) => (n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString("th-TH"));
const card = "rounded-xl border border-[var(--line)] bg-white p-4 sm:p-5";
const h2 = "text-[15px] font-semibold text-[var(--ink)]";
const soft = "text-[12.5px] text-[var(--ink-soft)]";
const input = "h-10 rounded-lg border border-[var(--line)] bg-white px-3 text-sm";
const navyBtn = "rounded-full bg-[var(--brand-navy)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
const ghostBtn = "rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[var(--bg-soft)] disabled:opacity-50";

const MODEL_NOTE: Record<string, string> = {
  "gpt-6-luna": "ถูกมาก แต่ตอบตื้นกว่า อาจพลาดเรื่องสำคัญ",
  "gpt-6.1-terra": "คุ้มที่สุด (แนะนำ) — สรุป 1 รอบราว ฿0.6–1.2 · ถาม 1 ครั้งราว ฿0.2–0.5",
  "gpt-6-sol": "แม่นที่สุด แต่แพงขึ้นราว 2 เท่า",
};
const KIND_ORDER: AiUsageKind[] = ["summary", "ask", "range", "image"];

function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-[var(--brand-navy)]" : "bg-[var(--line)]"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function DailyChart({ month, byDay }: { month: string; byDay: Record<string, number> }) {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y!, m!, 0).getDate();
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const rows = Array.from({ length: days }, (_, i) => {
    const d = `${month}-${String(i + 1).padStart(2, "0")}`;
    return { d, n: i + 1, thb: byDay[d] ?? 0, future: d > today };
  });
  const max = Math.max(...rows.map((r) => r.thb), 0);
  const [hover, setHover] = useState<number | null>(null);
  const h = hover !== null ? rows[hover] : null;
  if (max === 0) return <p className={soft}>ยังไม่มีการใช้เดือนนี้</p>;
  return (
    <div>
      <div className="mb-1 flex h-5 items-center justify-between text-[12px] text-[var(--ink-soft)]">
        <span>สูงสุดต่อวัน ฿{baht(max)}</span>
        {h && <span className="font-medium text-[var(--ink)]">วันที่ {h.n} · {h.future ? "ยังไม่ถึง" : `฿${baht(h.thb)}`}</span>}
      </div>
      <div className="flex h-28 items-end gap-[2px] border-b border-[var(--line)]" onMouseLeave={() => setHover(null)}>
        {rows.map((r, i) => (
          <div key={r.d} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} title={`วันที่ ${r.n} · ฿${baht(r.thb)}`}>
            <div
              className="w-full rounded-t-[4px]"
              style={{
                height: r.thb > 0 ? `${Math.max(4, (r.thb / max) * 100)}%` : 0,
                background: "var(--brand-navy)",
                opacity: hover === null || hover === i ? 1 : 0.45,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-[var(--ink-soft)]">
        {[1, 5, 10, 15, 20, 25, days].map((n) => <span key={n}>{n}</span>)}
      </div>
    </div>
  );
}

export function AiSettingsPage() {
  const [view, setView] = useState<AiSettingsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [cap, setCap] = useState("");
  const [proj, setProj] = useState("");
  const [key, setKey] = useState("");

  const load = useCallback(async () => {
    const r = await fetch("/api/ai-settings", { cache: "no-store" });
    const v = (await r.json()) as AiSettingsView & { error?: string };
    if (!r.ok) return toast.error(v.error ?? "โหลดไม่สำเร็จ");
    setView(v);
    setCap(String(v.capThb));
    setProj(v.billing?.orgProjectId ?? "");
  }, []);
  useEffect(() => void load(), [load]);

  const post = async (body: Record<string, unknown>, okMsg = "บันทึกแล้ว") => {
    setBusy(true);
    try {
      const r = await fetch("/api/ai-settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json()) as (AiSettingsView & { error?: string; ok?: boolean; message?: string; view?: AiSettingsView });
      if (!r.ok) return toast.error(j.error ?? "บันทึกไม่สำเร็จ"), null;
      const v = j.view ?? j;
      setView(v);
      setCap(String(v.capThb));
      if (j.message) (j.ok ? toast.success : toast.error)(j.message);
      else toast.success(okMsg);
      return j;
    } finally {
      setBusy(false);
    }
  };

  if (!view) return <div className="flex items-center gap-2 p-6 text-sm text-[var(--ink-soft)]"><Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด…</div>;
  if (!view.allowed) return <div className={card}><p className="text-sm">ฟีเจอร์ AI ใช้ได้กับแพ็กเกจ PRO ขึ้นไป</p></div>;

  const u = view.usage;
  const pct = view.capThb > 0 ? Math.min(100, (u.thb / view.capThb) * 100) : 100;
  const barColor = pct >= 90 ? RED : pct >= 70 ? YELLOW : "var(--brand-navy)";
  const capNum = Number(cap || 0);
  const ro = !view.canEdit;
  const onRooms = view.rooms.filter((r) => r.on);
  const fmtTime = (iso: string) => new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-10" data-testid="ai-settings">
      {ro && <p className="rounded-lg bg-[var(--bg-soft)] px-3 py-2 text-[13px] text-[var(--ink-soft)]">ดูได้อย่างเดียว — ตั้งค่าได้เฉพาะ Boss</p>}

      {/* 1. เดือนนี้ */}
      <section className={card}>
        <h2 className={h2}>ค่า AI เดือนนี้</h2>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
          <p className="text-[var(--ink)]">
            ใช้ไปแล้ว <b className="text-[26px] tabular-nums" style={{ color: pct >= 90 ? RED : undefined }}>฿{baht(u.thb)}</b>
            <span className={soft}> จากเพดาน ฿{view.capThb.toLocaleString("th-TH")} · {u.calls.toLocaleString("th-TH")} ครั้ง</span>
          </p>
          <p className={soft}>ถ้าใช้แบบนี้ทั้งเดือน ≈ <b className="text-[var(--ink)]">฿{baht(u.projectedThb)}</b>{u.projectedThb > view.capThb && <span style={{ color: RED }}> (เกินเพดาน AI จะหยุดก่อนสิ้นเดือน)</span>}</p>
        </div>
        <span className="mt-2 block h-2.5 overflow-hidden rounded-full bg-[var(--line)]">
          <span className="block h-full rounded-full" style={{ width: `${Math.max(pct, 2)}%`, background: barColor }} />
        </span>
        <div className="mt-3 grid gap-1 rounded-lg bg-[var(--bg-soft)] px-3 py-2 text-[12.5px] text-[var(--ink-soft)]">
          <span>
            ยอดจริงจาก OpenAI:{" "}
            {u.actualUsd !== undefined ? (
              <>
                <b className="text-[var(--ink)]">${u.actualUsd.toFixed(2)}</b> (≈ ฿{baht(u.actualUsd * THB_PER_USD)}) · อัปเดตล่าสุด {fmtTime(u.actualSyncedAt!)}
              </>
            ) : (
              "ยังไม่ได้เชื่อม (ผู้ให้บริการตั้งค่า)"
            )}
          </span>
          <span>ระบบนับเอง: <b className="text-[var(--ink)]">฿{baht(u.trackedThb)}</b> — เพดานใช้ตัวเลขที่สูงกว่าเสมอ</span>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1.4fr]">
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-[var(--ink)]">ใช้กับอะไร</p>
            <ul className="divide-y divide-[var(--line)] text-[13.5px]">
              {KIND_ORDER.map((k) => (
                <li key={k} className="flex items-center justify-between py-1.5">
                  <span className="text-[var(--ink)]">{AI_USAGE_LABEL[k]}</span>
                  <span className="tabular-nums text-[var(--ink)]">฿{baht(u.byKind[k] ?? 0)}</span>
                </li>
              ))}
            </ul>
            {Object.keys(u.byKind).length === 0 && u.trackedThb > 0 && <p className={`${soft} mt-1`}>ยอดก่อนวันที่ 15 พ.ย. ไม่ได้แยกประเภท</p>}
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-[var(--ink)]">รายวัน</p>
            <DailyChart month={view.month} byDay={u.byDay} />
          </div>
        </div>
      </section>

      {/* 2. เพดาน */}
      <section className={card}>
        <h2 className={h2}>เพดานเงินต่อเดือน</h2>
        <p className={`${soft} mt-1`}>
          ถึงเพดานแล้ว AI หยุดทันที ไม่มีเงินออกเพิ่ม (ห้องรายงานยังนับว่าใครส่ง/ไม่ส่งให้ตามปกติ) · ตั้งได้ไม่เกิน ฿{view.planMaxThb.toLocaleString("th-TH")} ตามแพ็กเกจ
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm">฿</span>
          <input
            aria-label="เพดานต่อเดือน (บาท)"
            inputMode="numeric"
            value={cap}
            disabled={ro}
            onChange={(e) => setCap(e.target.value.replace(/\D/g, "").slice(0, 5))}
            className={`${input} w-28 text-right`}
            style={capNum > view.planMaxThb ? { borderColor: RED } : undefined}
          />
          <span className="text-sm">ต่อเดือน</span>
          <button type="button" className={navyBtn} disabled={ro || busy || capNum === view.capThb} onClick={() => post({ action: "settings", monthlyCapThb: Math.min(capNum, view.planMaxThb) })}>
            บันทึก
          </button>
        </div>
        {capNum > view.planMaxThb && <p className="mt-1 text-xs" style={{ color: RED }}>เกินที่แพ็กเกจให้ จะบันทึกเป็น ฿{view.planMaxThb.toLocaleString("th-TH")}</p>}
        <p className={`${soft} mt-2`}>ใช้ทั่วไป: สรุปเช้า+เย็นทุกวัน 1 ห้อง ราว ฿40–70 ต่อเดือน · ถาม AI วันละ 5 ครั้ง ราว ฿30–75 ต่อเดือน</p>
      </section>

      {/* 3. ห้องที่สรุป */}
      <section className={card}>
        <h2 className={h2}>ห้องรายงานที่ให้ AI สรุป</h2>
        <p className={`${soft} mt-1`}>
          เปิดอยู่ {onRooms.length} ห้อง · AI สรุปหลังปิดรอบ 5 นาที แล้วแจ้งเตือนในแอป · ถ้ามีคนส่งหรือแก้รายงานตามมา สรุปใหม่ให้อีกไม่เกิน 2 ครั้ง ภายใน 3 ชั่วโมงหลังปิดรอบ
        </p>
        {view.rooms.length === 0 ? (
          <p className={`${soft} mt-3`}>ยังไม่มีห้องรายงานที่ตั้งรอบส่งไว้</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {view.rooms.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[var(--ink)]">{r.name}</span>
                  <span className="block text-[12px] text-[var(--ink-soft)]">{r.rounds}</span>
                </span>
                <Switch
                  label={`สรุปห้อง ${r.name}`}
                  on={r.on}
                  disabled={ro || busy}
                  onChange={(v) => post({ action: "rooms", topicIds: v ? [...onRooms.map((x) => x.id), r.id] : onRooms.map((x) => x.id).filter((x) => x !== r.id) }, v ? `เปิดสรุปห้อง ${r.name} แล้ว` : `ปิดสรุปห้อง ${r.name} แล้ว`)}
                />
              </li>
            ))}
          </ul>
        )}
        <p className={`${soft} mt-2`}>รายงานรายสัปดาห์/รายเดือน AI อ่านรูปให้ด้วย (ไม่เกิน 2 รูปต่อโพสต์) · รูปหน้างานในรายงานรายวันไม่อ่าน เพื่อไม่ให้เสียเงิน</p>
      </section>

      {/* 4. รุ่น AI */}
      <section className={card}>
        <h2 className={h2}>รุ่น AI</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {([["detailModel", "ใช้สรุปหลังปิดรอบ / สรุปรวม"], ["askModel", "ใช้ตอบคำถาม (น้อง SmartBoss และปุ่มถามในการ์ดสรุป)"]] as const).map(([field, label]) => (
            <label key={field} className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-[var(--ink)]">{label}</span>
              <select
                className={input}
                value={view.settings[field]}
                disabled={ro || busy}
                onChange={(e) => post({ action: "settings", [field]: e.target.value })}
              >
                {Object.entries(MODEL_PRICES_USD).map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}
              </select>
              <span className="text-[12px] text-[var(--ink-soft)]">{MODEL_NOTE[view.settings[field]] ?? ""}</span>
            </label>
          ))}
        </div>
      </section>

      {/* 5. ผู้ช่วย */}
      <section className={card}>
        <div className="flex items-center gap-3">
          <img src="/brand/smartboss-ai-128.png" alt="" className="h-11 w-11 shrink-0" />
          <span className="min-w-0 flex-1">
            <h2 className={h2}>ผู้ช่วย AI (น้อง SmartBoss)</h2>
            <span className={soft}>ปุ่มตุ๊กตามุมซ้ายล่างทุกหน้า ถามได้ทุกเรื่องของบริษัท (ไม่อ่านแชทส่วนตัว ไม่เห็นเลขบัญชีธนาคาร) · เห็นเฉพาะ Boss · เสียเงินเฉพาะตอนถาม</span>
          </span>
          <Switch
            label="เปิดผู้ช่วย AI"
            on={view.settings.assistantEnabled !== false}
            disabled={ro || busy}
            onChange={(v) => post({ action: "settings", assistantEnabled: v }, v ? "เปิดผู้ช่วย AI แล้ว (รีเฟรชหน้าเพื่อให้ตุ๊กตาขึ้น)" : "ปิดผู้ช่วย AI แล้ว")}
          />
        </div>
      </section>

      {/* 6. ประวัติ */}
      <section className={card}>
        <h2 className={h2}>ใช้ AI ล่าสุด</h2>
        {view.log.length === 0 ? (
          <p className={`${soft} mt-2`}>ยังไม่มีประวัติ (เริ่มเก็บตั้งแต่ 15 พ.ย. 2569)</p>
        ) : (
          <div className="mt-2 max-h-80 overflow-y-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-white text-left text-[12px] text-[var(--ink-soft)]">
                <tr><th className="py-1.5 font-medium">เวลา</th><th className="font-medium">ใช้กับ</th><th className="hidden font-medium sm:table-cell">รุ่น</th><th className="text-right font-medium">เงิน</th></tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {view.log.map((l, i) => (
                  <tr key={`${l.at}-${i}`}>
                    <td className="py-1.5 tabular-nums text-[var(--ink-soft)]">{fmtTime(l.at)}</td>
                    <td className="text-[var(--ink)]">{AI_USAGE_LABEL[l.kind] ?? l.kind}</td>
                    <td className="hidden text-[var(--ink-soft)] sm:table-cell">{l.model ? MODEL_PRICES_USD[l.model]?.label ?? l.model : "—"}</td>
                    <td className="text-right tabular-nums text-[var(--ink)]">฿{l.thb.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 7. ผู้ให้บริการ */}
      {view.billing && (
        <section className={`${card} border-dashed`}>
          <h2 className={h2}>การเชื่อม OpenAI ของบริษัทนี้ <span className="text-[12px] font-normal text-[var(--ink-soft)]">· เห็นเฉพาะผู้ดูแลระบบสูงสุด</span></h2>
          <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[9rem_1fr]">
            <dt className="text-[var(--ink-soft)]">คีย์ที่ใช้อยู่</dt>
            <dd className="text-[var(--ink)]">
              {{ org: `คีย์ของบริษัทนี้ (ลงท้าย ${view.billing.orgKeyHint})`, "platform-brief": "คีย์กลางของฟีเจอร์นี้ (OPENAI_BRIEF_API_KEY)", "platform-main": "คีย์กลางเดิม (OPENAI_API_KEY) — ยอดจริงจะรวม AI อื่นด้วย", none: "ยังไม่มีคีย์ — AI ใช้ไม่ได้" }[view.billing.source]}
            </dd>
            <dt className="text-[var(--ink-soft)]">Project ที่ดึงยอดจริง</dt>
            <dd className="font-mono text-[12.5px] text-[var(--ink)]">{view.billing.projectId ?? "ยังไม่ได้ตั้ง"}</dd>
            <dt className="text-[var(--ink-soft)]">Admin key</dt>
            <dd className="text-[var(--ink)]">{view.billing.adminKey ? "ตั้งแล้ว (ดึงยอดจริงทุก 3 ชั่วโมง)" : "ยังไม่ได้ตั้ง OPENAI_ADMIN_KEY ในเซิร์ฟเวอร์ — ดึงยอดจริงไม่ได้"}</dd>
          </dl>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-medium">Project ID ของบริษัทนี้</span>
              <input className={`${input} font-mono`} placeholder="proj_… (เว้นว่าง = ใช้ของกลาง)" value={proj} onChange={(e) => setProj(e.target.value.trim())} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-medium">API key ของบริษัทนี้</span>
              <input className={`${input} font-mono`} type="password" autoComplete="off" placeholder={view.billing.orgKeyHint ? `ตั้งไว้แล้ว ลงท้าย ${view.billing.orgKeyHint} (เว้นว่าง = คงเดิม)` : "sk-… (เว้นว่าง = ใช้คีย์กลาง)"} value={key} onChange={(e) => setKey(e.target.value)} />
            </label>
          </div>
          <p className={`${soft} mt-1.5`}>คีย์ถูกเข้ารหัสก่อนเก็บ และไม่แสดงกลับบนหน้าจอ</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={navyBtn} disabled={busy} onClick={async () => { if (await post({ action: "billing", projectId: proj, apiKey: key || undefined })) setKey(""); }}>บันทึก</button>
            <button type="button" className={ghostBtn} disabled={busy} onClick={() => post({ action: "test" })}>ทดสอบการเชื่อมต่อ</button>
            <button type="button" className={ghostBtn} disabled={busy} onClick={() => post({ action: "sync" })}>ดึงยอดจริงตอนนี้</button>
            {view.billing.orgKeyHint && (
              <button type="button" className={ghostBtn} disabled={busy} onClick={() => { if (confirm("ล้างคีย์ของบริษัทนี้ แล้วกลับไปใช้คีย์กลาง?")) void post({ action: "billing", clearKey: true }, "ล้างคีย์แล้ว"); }}>ล้างคีย์ของบริษัท</button>
            )}
          </div>
        </section>
      )}

      <p className={`${soft} text-center`}>
        ดูสรุปรายงานได้ที่ <Link href="/chat-report/report-feed" className="text-[var(--brand-navy)] underline">ห้องรายงาน</Link>
      </p>
    </div>
  );
}
