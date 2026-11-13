"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { BossBrief, BriefColor, BriefDetail } from "@/modules/report_task/lib/boss-brief/types";

/**
 * สรุปละเอียดในแท็บสรุป (13/11/2569 ผู้ใช้: "boss เข้ามาแล้วรู้ว่าคนนี้ทำอะไร กลุ่มไหนเป็นยังไง ติดอะไร รออะไรจากเรา อะไรด่วน/อันตราย")
 * แบบอ่านน้อย (ผู้ใช้: "boss จะอ่านเยอะกว่าเดิมไหม ดูรก ดูถี่"): ภาพรวม 1 ประโยค → "เรื่องที่คุณต้องรู้" รายการเดียว ≤5 บรรทัด ไม่ซ้ำ
 * (🚨 ด่วน / 🙋 รอคุณ / ⏳ ค้าง) → "ทุกคน" แค่ชื่อ + จุดสี จัดตามทีม · รายละเอียดทั้งหมดอยู่ในแผ่นรายคน (แตะชื่อ/แตะเรื่อง)
 */

const DOT: Record<BriefColor, string> = { red: "var(--chart-red, #d6453d)", yellow: "#d39b00", green: "var(--brand-green, #1f9d55)", none: "var(--line)" };
const COLOR_WORD: Record<BriefColor, string> = { red: "มีปัญหา", yellow: "มีเรื่องต้องตาม", green: "ไม่มีอะไรติด", none: "" };
const TH_M = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const thDay = (d: string) => `${Number(d.slice(8, 10))} ${TH_M[Number(d.slice(5, 7))]}`;
const daysBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000));

/** ไอคอนรอบ: ☀️ แผนเช้า · 🌙 ผลงานรายวัน · 📅 รายสัปดาห์ · 🗓️ รายเดือน · 📊 สรุปรวม */
export function briefIcon(b: BossBrief): string {
  const d = b.detail;
  if (b.rangeFrom) return "📊";
  if (d?.period === "weekly") return "📅";
  if (d?.period === "monthly") return "🗓️";
  if (d) return d.roundKind === "plan" ? "☀️" : "🌙";
  return Number(b.roundTime.slice(0, 2)) < 12 ? "☀️" : "🌙";
}

type MustKnow = { key: string; kind: "urgent" | "decide" | "carry"; title: string; why?: string; postId: string; name: string; tag: string };

/**
 * เรื่องที่ Boss ต้องรู้ — รวม ด่วน → รอคุณ → ค้าง เป็นรายการเดียว ไม่ซ้ำ (13/11/2569 ผู้ใช้: "boss จะอ่านเยอะกว่าเดิมไหม ทำไมมันดูรก ดูถี่จัง")
 * เรื่องเดียวกันมักโผล่หลายหมวด (เช่น สินเชื่อ SL1 ทั้งด่วน+ค้าง) → เก็บแค่หมวดที่สำคัญกว่า
 * ซ้ำ = คนเดียวกัน (โพสต์เดียวกัน) และมีคำอังกฤษ/รหัสเดียวกัน (SL1, HS2, CI) หรือขึ้นต้นเหมือนกัน
 */
function mustKnow(brief: BossBrief): MustKnow[] {
  const d = brief.detail as BriefDetail;
  const codes = (t: string) => new Set((t.match(/[A-Za-z][A-Za-z0-9]+|\d+[A-Za-z]+[A-Za-z0-9]*/g) ?? []).map((x) => x.toLowerCase()));
  const out: MustKnow[] = [];
  const dup = (postId: string, title: string) => {
    const c = codes(title);
    return out.some((o) => {
      if (o.postId !== postId) return false;
      for (const x of codes(o.title)) if (c.has(x)) return true;
      return o.title.replace(/\s/g, "").slice(0, 10) === title.replace(/\s/g, "").slice(0, 10);
    });
  };
  for (const u of d.urgent) if (!dup(u.postId, u.title)) out.push({ key: `u${out.length}`, kind: "urgent", title: u.title, why: u.why, postId: u.postId, name: u.name, tag: u.level === "ด่วนมาก" ? "ด่วนมาก" : "ด่วน" });
  for (const x of d.decisions) if (!dup(x.postId, x.what)) {
    const age = daysBetween(x.since, brief.day);
    out.push({ key: `d${out.length}`, kind: "decide", title: x.what, postId: x.postId, name: x.name, tag: age > 0 ? `รอคุณ ${age} วัน` : "รอคุณ" });
  }
  for (const x of d.carry) if (!dup(x.postId, x.what)) out.push({ key: `c${out.length}`, kind: "carry", title: x.what, postId: x.postId, name: x.name, tag: x.since ? `ค้าง ${daysBetween(x.since, brief.day)} วัน` : "ค้าง" });
  return out;
}

const TAG_STYLE: Record<MustKnow["kind"], React.CSSProperties> = {
  urgent: { background: "#fdeeee", color: "var(--chart-red, #d6453d)" },
  decide: { background: "var(--brand-navy)", color: "#fff" },
  carry: { background: "#fdf4e3", color: "#a86a00" },
};
const TAG_ICON: Record<MustKnow["kind"], string> = { urgent: "🚨", decide: "🙋", carry: "⏳" };

export function BriefDetailView({
  brief,
  onJumpToPost,
  others = [],
  openUserId = null,
  onOpenOther,
}: {
  brief: BossBrief;
  onJumpToPost: (postId: string) => void;
  /** สรุปรอบอื่นของห้องนี้ (ทุกวันที่เก็บไว้) — ใช้ทำ "วันอื่นๆ ของคนนี้" ในแผ่นรายคน */
  others?: BossBrief[];
  /** เปิดแผ่นของคนนี้ทันที (มาจากกด "วันอื่นๆ" ในอีกสรุปหนึ่ง) */
  openUserId?: string | null;
  onOpenOther?: (briefId: string, userId: string) => void;
}) {
  const d = brief.detail as BriefDetail;
  const [open, setOpen] = useState<string | null>(() => (openUserId ? brief.people.find((p) => p.userId === openUserId)?.postId ?? null : null));
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (openUserId) setOpen(brief.people.find((p) => p.userId === openUserId)?.postId ?? null);
  }, [openUserId, brief]);
  const items = mustKnow(brief);
  const SHOW = 5;
  const shown = more ? items : items.slice(0, SHOW);
  const tap = (postId: string) => (d.people[postId] ? setOpen(postId) : onJumpToPost(postId));
  const colorOf = (p: BossBrief["people"][number]) => d.people[p.postId]?.color ?? p.worst;
  // คนจัดเป็นทีม (ทีมที่มีคนสีแดงขึ้นก่อน) — ชื่อ + จุดสี ไม่มีข้อความยาว แตะชื่อ = รายละเอียด
  const groups = new Map<string, BossBrief["people"]>();
  for (const p of brief.people) {
    const t = d.people[p.postId]?.team || "ไม่ระบุทีม";
    groups.set(t, [...(groups.get(t) ?? []), p]);
  }
  const RANKC: Record<BriefColor, number> = { red: 0, yellow: 1, green: 2, none: 3 };
  const teams = [...groups.entries()]
    .map(([team, ps]) => ({ team, ps: [...ps].sort((a, b) => RANKC[colorOf(a)] - RANKC[colorOf(b)]) }))
    .sort((a, b) => RANKC[colorOf(a.ps[0]!)] - RANKC[colorOf(b.ps[0]!)]);

  return (
    <div className="flex flex-col gap-2 px-3 pb-2 pt-1 sm:px-4" data-testid="boss-brief-detail">
      {brief.compact && (
        <p className="rounded-lg bg-[var(--bg-soft)] px-3 py-1.5 text-[12px] text-[var(--ink-soft)]">สรุปนี้เก่ากว่า 12 เดือน ระบบเก็บแบบย่อไว้ · แตะชื่อคนเพื่อไปที่รายงานต้นทาง</p>
      )}
      <section className="overflow-hidden rounded-lg border border-[var(--line)] bg-white" data-testid="boss-brief-mustknow">
        <h4 className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-1.5 text-[13px] font-semibold text-[var(--ink)]">
          เรื่องที่คุณต้องรู้ <span className="text-xs font-normal text-[var(--ink-soft)]">{items.length ? `${items.length} เรื่อง` : ""}</span>
        </h4>
        {items.length === 0 && <p className="px-3 py-2 text-[13px] text-[var(--ink-soft)]">ไม่มีเรื่องด่วน ไม่มีเรื่องรอคุณ ✓</p>}
        <div className="divide-y divide-[var(--line)]">
          {shown.map((it) => (
            <button key={it.key} type="button" onClick={() => tap(it.postId)} className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-[var(--bg-soft)]">
              <span className="mt-0.5 shrink-0 whitespace-nowrap rounded-full px-1.5 text-[11px] font-semibold" style={TAG_STYLE[it.kind]}>
                {TAG_ICON[it.kind]} {it.tag}
              </span>
              <span className="min-w-0 flex-1 text-[13px] leading-snug text-[var(--ink)]">
                {it.title} <span className="text-[var(--ink-soft)]">· {it.name}</span>
              </span>
            </button>
          ))}
        </div>
        {items.length > SHOW && (
          <button type="button" onClick={() => setMore(!more)} className="w-full border-t border-[var(--line)] px-3 py-1 text-left text-xs font-medium text-[var(--brand-navy)]">
            {more ? "ย่อ" : `ดูอีก ${items.length - SHOW} เรื่อง`}
          </button>
        )}
      </section>

      <section className="rounded-lg border border-[var(--line)] bg-white px-3 py-2" data-testid="boss-brief-all">
        <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-[13px]">
          <b className="font-semibold text-[var(--ink)]">ทุกคน ({brief.people.length})</b>
          <span className="text-[11px] text-[var(--ink-soft)]">แตะชื่อเพื่อดูว่าทำอะไร ติดอะไร</span>
        </div>
        <div className="flex flex-col gap-1">
          {teams.map(({ team, ps }) => (
            <div key={team} className="flex flex-wrap items-center gap-1">
              <span className="mr-0.5 text-[11.5px] text-[var(--ink-soft)]">{team}</span>
              {ps.map((p) => (
                <button key={p.postId} type="button" onClick={() => (d.people[p.postId] ? setOpen(p.postId) : onJumpToPost(p.postId))} title={p.oneLine}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5 text-[12px] text-[var(--ink)] hover:border-[var(--brand-navy)]">
                  <i className="inline-block h-2 w-2 rounded-full" style={{ background: DOT[colorOf(p)] }} />
                  {p.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>

      {open && (
        <PersonSheet
          brief={brief}
          postId={open}
          onClose={() => setOpen(null)}
          onJumpToPost={onJumpToPost}
          others={others}
          onOpenOther={onOpenOther ? (id, uid) => { setOpen(null); onOpenOther(id, uid); } : undefined}
        />
      )}
    </div>
  );
}

function PersonSheet({
  brief,
  postId,
  onClose,
  onJumpToPost,
  others,
  onOpenOther,
}: {
  brief: BossBrief;
  postId: string;
  onClose: () => void;
  onJumpToPost: (id: string) => void;
  others: BossBrief[];
  onOpenOther?: (briefId: string, userId: string) => void;
}) {
  const d = brief.detail as BriefDetail;
  const info = d.people[postId];
  const person = brief.people.find((p) => p.postId === postId);
  const plan = d.roundKind === "plan";
  const range = d.roundKind === "range";
  const mine = mustKnow(brief).filter((it) => it.postId === postId);
  // วันอื่นๆ ของคนนี้ในห้องเดียวกัน (13/11/2569 "ข้อมูลคนนั้นวันนั้น วันอื่นๆเป็นยังไง") — ใหม่สุดก่อน
  const history = person
    ? others
        .filter((b) => b.id !== brief.id && !b.rangeFrom && (!range || (b.day >= brief.rangeFrom! && b.day <= brief.day)))
        .flatMap((b) => {
          const pp = b.people.find((x) => x.userId === person.userId);
          return pp ? [{ b, pp, color: b.detail?.people[pp.postId]?.color ?? pp.worst }] : [];
        })
        .sort((x, y) => y.b.day.localeCompare(x.b.day) || y.b.roundTime.localeCompare(x.b.roundTime))
    : [];
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  if (!info || !person || typeof document === "undefined") return null;
  const list = (items: string[]) =>
    items.length ? (
      <ul className="list-disc space-y-0.5 pl-5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    ) : (
      <p className="text-[var(--ink-soft)]">ไม่มี</p>
    );
  const block = (title: string, body: React.ReactNode, color?: string) => (
    <div>
      <h5 className="mb-0.5 text-[12px] font-semibold" style={{ color: color ?? "var(--ink-soft)" }}>{title}</h5>
      {body}
    </div>
  );
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose} data-testid="boss-brief-person">
      <div role="dialog" aria-modal="true" aria-label={`รายละเอียดของ ${person.name}`} onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full flex-col gap-3 overflow-y-auto rounded-t-2xl bg-white px-4 pt-3 text-[13.5px] text-[var(--ink)] pb-[max(16px,env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-2xl">
        <div className="flex items-center gap-2">
          <i className="inline-block h-3 w-3 rounded-full" style={{ background: DOT[info.color] }} />
          <b className="text-[16px]">{person.name}</b>
          <span className="text-xs text-[var(--ink-soft)]">{[info.team, COLOR_WORD[info.color]].filter(Boolean).join(" · ")}</span>
          <button type="button" onClick={onClose} aria-label="ปิด" className="ml-auto rounded-full p-1 text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]"><X className="h-5 w-5" /></button>
        </div>
        {person.oneLine && <p className="rounded-lg bg-[var(--bg-soft)] px-3 py-2">{person.oneLine}</p>}
        {mine.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {mine.map((it) => (
              <div key={it.key} className="rounded-lg border border-[var(--line)] px-3 py-1.5">
                <span className="mr-1.5 whitespace-nowrap rounded-full px-1.5 text-[11px] font-semibold" style={TAG_STYLE[it.kind]}>{TAG_ICON[it.kind]} {it.tag}</span>
                <b className="font-medium">{it.title}</b>
                {it.why && <p className="mt-0.5 text-[12.5px] text-[var(--ink-soft)]">{it.why}</p>}
              </div>
            ))}
          </div>
        )}
        {block(plan ? "วันนี้จะทำอะไร" : range ? "งานหลักในช่วงนี้" : d.period === "weekly" ? "ทำอะไรสัปดาห์นี้" : d.period === "monthly" ? "ทำอะไรเดือนนี้" : "ทำอะไรวันนี้", list(info.did))}
        {block(plan ? "ความเสี่ยง / ติดอะไร" : "ติดอะไร / ปัญหา", list(info.stuck), DOT.red)}
        {block(
          "รออะไร จากใคร",
          info.waiting.length ? (
            <ul className="list-disc space-y-0.5 pl-5">
              {info.waiting.map((w, i) => (
                <li key={i}>{w.what}{w.from && <span className="text-[var(--ink-soft)]"> — รอ {w.from}</span>}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[var(--ink-soft)]">ไม่มี</p>
          ),
          "#a86a00"
        )}
        {!plan && !range && block(d.period === "weekly" ? "สัปดาห์หน้าจะทำ" : d.period === "monthly" ? "เดือนหน้าจะทำ" : "พรุ่งนี้จะทำ", list(info.next))}
        {history.length > 0 && (
          <div data-testid="boss-brief-person-history">
            <h5 className="mb-1 text-[12px] font-semibold text-[var(--ink-soft)]">{range ? "แต่ละวันในช่วงนี้" : "วันอื่นๆ"} ของ {person.name} ({history.length})</h5>
            <div className="flex flex-col divide-y divide-[var(--line)] rounded-lg border border-[var(--line)]">
              {history.slice(0, 20).map(({ b, pp, color }) => (
                <button key={b.id} type="button" onClick={() => (onOpenOther ? onOpenOther(b.id, pp.userId) : onJumpToPost(pp.postId))}
                  className="flex items-start gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--bg-soft)]">
                  <i className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DOT[color] }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] text-[var(--ink-soft)]">{briefIcon(b)} {thDay(b.day)} · {b.roundLabel}</span>
                    <span className="block text-[13px] leading-snug">{pp.oneLine || "—"}</span>
                  </span>
                  <span className="shrink-0 pt-1 text-xs text-[var(--ink-soft)]">›</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <button type="button" onClick={() => { onClose(); onJumpToPost(postId); }}
          className="rounded-lg bg-[var(--brand-navy)] py-2.5 text-[13px] font-semibold text-white">
          ไปที่รายงานของ {person.name} ในห้อง
        </button>
      </div>
    </div>,
    document.body
  );
}
