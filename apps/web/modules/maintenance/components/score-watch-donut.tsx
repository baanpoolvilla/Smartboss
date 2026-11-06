"use client";

/**
 * โดนัทใบงานที่ยังไม่ปิด — กดแถวหรือสีเพื่อดูว่าเป็นใบไหน (ผู้ใช้ 5/11/2569 "อยากให้รู้ว่าคืองานไหน")
 * โหลดรายการตอนกดเท่านั้น แดชบอร์ดไม่ต้องดึงทุกใบทุกครั้ง · เห็นเท่าที่มีสิทธิ์ ตรงกับตัวเลข
 */
import { useEffect, useState, useTransition } from "react";
import { arrivedByBack } from "@/lib/nav-stack";
import Link from "next/link";
import { ChevronRight, Search, TrendingDown } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "./dialog";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";
import type { ScoreWatch, ScoreWatchDockRow, ScoreWatchGroup, ScoreWatchRow } from "@/modules/maintenance/data/score-watch";
import { loadScoreWatchDocksAction, loadScoreWatchRowsAction } from "@/app/(shell)/maintenance/score-watch-actions";

const SEARCH_FROM = 9;
type Open = ScoreWatchGroup | "docks";

/**
 * กดเข้าใบจากหน้าต่างแล้วย้อนกลับ: หน้าต่างกลุ่มเดิม (คำค้นเดิม) เปิดให้ต่อ จะได้ไล่ดูใบถัดไปได้
 * เข้าแดชบอร์ดด้วยวิธีอื่น (กดเมนู / เปิดใหม่) ไม่เปิดเอง (ผู้ใช้ 6/11/2569 "ปรับให้เหมาะสม ไม่สับสน")
 */
const REOPEN_KEY = "sb-score-watch-reopen";
const REOPEN_MAX_MS = 30 * 60_000;
function rememberOpen(key: Open, query: string) {
  try {
    sessionStorage.setItem(REOPEN_KEY, JSON.stringify({ key, query, at: Date.now() }));
  } catch {
    // โหมดส่วนตัว — ไม่เปิดค้างก็ใช้งานได้ปกติ
  }
}
function takeRemembered(): { key: Open; query: string } | null {
  try {
    const raw = sessionStorage.getItem(REOPEN_KEY);
    sessionStorage.removeItem(REOPEN_KEY);
    const v = raw ? (JSON.parse(raw) as { key: Open; query: string; at: number }) : null;
    return v && Date.now() - v.at < REOPEN_MAX_MS ? v : null;
  } catch {
    return null;
  }
}

const INFO: Record<ScoreWatchGroup, { label: string; color: string; desc: string; empty: string }> = {
  late: { label: "เลยกำหนด", color: "#DC2626", desc: "เลยวันส่งแล้วยังไม่ปิด ระบบหักคะแนนคนที่ยังไม่เสร็จ", empty: "ไม่มีใบงานเลยกำหนดแล้ว" },
  soon: { label: "ใกล้ครบกำหนด (≤ 3 วัน)", color: "#F59E0B", desc: "ครบกำหนดภายใน 3 วัน ปิดก่อนวันส่งจะไม่โดนหัก", empty: "ไม่มีใบงานในกลุ่มนี้แล้ว" },
  later: { label: "ยังไม่ถึงกำหนด", color: "#16A34A", desc: "เหลือเวลามากกว่า 3 วัน เรียงจากใกล้กำหนดที่สุด", empty: "ไม่มีใบงานในกลุ่มนี้แล้ว" },
  none: { label: "ไม่ได้ตั้งวันครบกำหนด", color: "#94A3B8", desc: "ใบเหล่านี้ไม่มีวันส่ง ระบบจึงไม่เตือนตามวันและไม่หักคะแนน", empty: "ไม่มีใบงานในกลุ่มนี้แล้ว" },
};

function dueChip(days: number | null): { text: string; bg: string; fg: string } {
  if (days === null) return { text: "ไม่มีวันส่ง", bg: "#F1F5F9", fg: "#475569" };
  if (days < 0) return { text: `เลย ${-days} วัน`, bg: "#FEF2F2", fg: "#DC2626" };
  const soon = { bg: "#FFF7E6", fg: "#B45309" };
  if (days === 0) return { text: "วันนี้", ...soon };
  if (days === 1) return { text: "พรุ่งนี้", ...soon };
  if (days === 2) return { text: "อีก 2 วัน", ...soon };
  return { text: `อีก ${days} วัน`, bg: "#ECFDF3", fg: "#15803D" };
}

function OrderRow({ r, onOpen }: { r: ScoreWatchRow; onOpen: () => void }) {
  const chip = dueChip(r.days);
  const meta = [r.place, r.who ? `${r.who}${r.extra > 0 ? ` +${r.extra}` : ""}` : null, r.dueText ? `ครบ ${r.dueText}` : null].filter(Boolean).join(" · ");
  return (
    <Link href={`/maintenance/work-orders/${r.id}`} onClick={onOpen} data-testid="watch-row" className="flex items-center gap-2.5 border-b border-(--line) px-1 py-2.5 last:border-0 hover:bg-(--bg-soft)">
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-(--ink)">
          <span className="min-w-0 break-words">{r.title}</span>
          {r.isPm && <span className="shrink-0 rounded-md bg-[#E0E7FF] px-1.5 text-[10px] font-semibold text-[#3730A3]">PM</span>}
        </span>
        <span className="mt-0.5 block text-xs text-(--ink-soft) break-words">
          <span className="font-semibold text-[#0F766E]">{r.code}</span>
          {meta && ` · ${meta}`}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: chip.bg, color: chip.fg }}>
          {chip.text}
        </span>
        {r.waived ? (
          <span className="whitespace-nowrap text-[11px] font-medium text-(--ink-soft)">คืนคะแนนแล้ว</span>
        ) : r.docked !== null ? (
          <span className="whitespace-nowrap text-[11px] font-bold text-[#DC2626]">หักแล้ว −{Math.abs(r.docked)}</span>
        ) : r.waitingAccept ? (
          <span className="whitespace-nowrap text-[11px] font-semibold text-[#B45309]">ยังไม่รับงาน</span>
        ) : (
          <span className="whitespace-nowrap text-[11px] text-(--ink-soft)">กำลังทำ</span>
        )}
      </span>
    </Link>
  );
}

function DockRow({ r, onOpen }: { r: ScoreWatchDockRow; onOpen: () => void }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-(--ink) break-words">{r.who}</span>
        <span className="mt-0.5 block text-xs text-(--ink-soft) break-words">
          {r.note ? `${r.note} · ` : ""}หักเมื่อ {fmtThaiDate(new Date(r.when))}
        </span>
      </span>
      <span className="shrink-0 text-sm font-bold tabular-nums text-[#DC2626]">−{Math.abs(r.points)}</span>
    </>
  );
  const cls = "flex items-center gap-2.5 border-b border-(--line) px-1 py-2.5 last:border-0";
  return r.href ? (
    <Link href={r.href} onClick={onOpen} data-testid="watch-row" className={`${cls} hover:bg-(--bg-soft)`}>
      {body}
    </Link>
  ) : (
    <div data-testid="watch-row" className={cls}>
      {body}
    </div>
  );
}

export function ScoreWatchDonut({ data }: { data: ScoreWatch }) {
  const parts: { key: ScoreWatchGroup; value: number }[] = [
    { key: "late", value: data.overdueCount },
    { key: "soon", value: data.dueSoonCount },
    { key: "later", value: data.laterCount },
    { key: "none", value: data.noDueCount },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;

  const [open, setOpen] = useState<Open | null>(null);
  const [rows, setRows] = useState<ScoreWatchRow[]>([]);
  const [docks, setDocks] = useState<ScoreWatchDockRow[]>([]);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(10);
  const [step, setStep] = useState(10);
  const [loading, start] = useTransition();

  const load = (key: Open) => {
    setError(false);
    start(async () => {
      try {
        if (key === "docks") setDocks(await loadScoreWatchDocksAction());
        else setRows(await loadScoreWatchRowsAction(key));
      } catch {
        setError(true);
      }
    });
  };
  const show = (key: Open, keepQuery = "") => {
    // จำนวนต่อรอบเดียวกับบอร์ด: จอคอม 10 มือถือ 12
    const size = window.matchMedia("(min-width: 640px)").matches ? 10 : 12;
    setStep(size);
    setShown(size);
    setQuery(keepQuery);
    setRows([]);
    setDocks([]);
    setOpen(key);
    load(key);
  };

  // ย้อนกลับมาจากใบที่กดจากหน้าต่าง — รอ NavTracker บันทึกการย้อนก่อน (เอฟเฟกต์ของแม่รันหลังลูก)
  useEffect(() => {
    const t = setTimeout(() => {
      const saved = takeRemembered();
      if (saved && arrivedByBack()) show(saved.key, saved.query);
    }, 80);
    return () => clearTimeout(t);
    // เปิดหน้าครั้งเดียว
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const remember = () => open && rememberOpen(open, query);

  const isDocks = open === "docks";
  const q = query.trim().toLowerCase();
  const allCount = isDocks ? docks.length : rows.length;
  const hitRows = q ? rows.filter((r) => `${r.code} ${r.title} ${r.place ?? ""} ${r.who ?? ""}`.toLowerCase().includes(q)) : rows;
  const hitDocks = q ? docks.filter((r) => `${r.who} ${r.note ?? ""}`.toLowerCase().includes(q)) : docks;
  const hitCount = isDocks ? hitDocks.length : hitRows.length;
  const info = open && open !== "docks" ? INFO[open] : null;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center sm:gap-10">
      <svg viewBox="0 0 140 140" className="h-44 w-44 shrink-0" role="group" aria-label={`ใบงานที่ยังไม่ปิด ${total} ใบ`}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--line)" strokeWidth="22" />
        {total > 0 &&
          parts.map((p) => {
            if (!p.value) return null;
            const len = (p.value / total) * C;
            const el = (
              <circle
                key={p.key}
                role="button"
                tabIndex={0}
                aria-label={`ดูใบงาน ${INFO[p.key].label} ${p.value} ใบ`}
                data-testid={`watch-slice-${p.key}`}
                onClick={() => show(p.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    show(p.key);
                  }
                }}
                className="cursor-pointer outline-none transition-[stroke-width] hover:[stroke-width:26] focus-visible:[stroke-width:26]"
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={INFO[p.key].color}
                strokeWidth="22"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 70 70)"
              />
            );
            offset += len;
            return el;
          })}
        <text x="70" y="68" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--ink)">
          {total}
        </text>
        <text x="70" y="86" textAnchor="middle" fontSize="10" fill="var(--ink-soft)">
          ใบงานที่ยังไม่ปิด
        </text>
      </svg>

      <div className="grid w-full max-w-md gap-0.5 text-sm sm:w-auto sm:min-w-90">
        {parts.map((p) => (
          <button
            key={p.key}
            type="button"
            disabled={p.value === 0}
            onClick={() => show(p.key)}
            data-testid={`watch-${p.key}`}
            className="grid grid-cols-[10px_minmax(0,1fr)_auto_2.5rem_1rem] items-center gap-2 rounded-lg px-2 py-1.5 text-left enabled:hover:bg-(--bg-soft) disabled:cursor-default disabled:opacity-60"
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: INFO[p.key].color }} />
            <span className="text-(--ink)">{INFO[p.key].label}</span>
            <span className="pl-3 font-semibold tabular-nums text-(--ink)">{p.value}</span>
            <span className="text-right text-xs tabular-nums text-(--ink-soft)">{total ? `${Math.round((p.value / total) * 100)}%` : "–"}</span>
            {p.value > 0 ? <ChevronRight className="h-4 w-4 text-(--ink-soft)" aria-hidden="true" /> : <span />}
          </button>
        ))}
        <button
          type="button"
          disabled={data.monthDocks === 0}
          onClick={() => show("docks")}
          data-testid="watch-docks"
          className="mt-1 grid grid-cols-[1rem_minmax(0,1fr)_auto_2.5rem_1rem] items-center gap-2 border-t border-(--line) px-2 pb-1.5 pt-2 text-left enabled:hover:bg-(--bg-soft) disabled:cursor-default"
        >
          <TrendingDown className="h-4 w-4 text-[#DC2626]" aria-hidden="true" />
          <span className="text-(--ink)">คะแนนที่โดนหักเดือนนี้ {data.orgWide ? "(ทั้งบริษัท)" : "(ของฉัน)"}</span>
          <span className="pl-3 font-semibold tabular-nums text-[#DC2626]">{data.monthPoints < 0 ? `−${Math.abs(data.monthPoints)}` : data.monthPoints}</span>
          <span className="text-right text-xs tabular-nums text-(--ink-soft)">{data.monthDocks} ครั้ง</span>
          {data.monthDocks > 0 ? <ChevronRight className="h-4 w-4 text-(--ink-soft)" aria-hidden="true" /> : <span />}
        </button>
      </div>

      {open && (
        <Modal
          title={`${info ? info.label : "คะแนนที่โดนหักเดือนนี้"}${loading ? "" : ` · ${allCount} ${isDocks ? "ครั้ง" : "ใบ"}`}`}
          onClose={() => setOpen(null)}
          actions={
            <>
              {shown < hitCount && (
                <Button type="button" size="sm" variant="outline" data-testid="watch-more" onClick={() => setShown((n) => n + step)}>
                  ดูเพิ่มเติม
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(null)}>
                ปิด
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-2" data-testid="watch-window">
            <p className="text-xs text-(--ink-soft)">{info ? info.desc : "ใครโดนหักจากใบไหน กดเพื่อเปิดใบงาน"}</p>
            {allCount >= SEARCH_FROM && (
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)" aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setShown(step);
                  }}
                  placeholder="ค้นหาชื่องาน บ้าน คน หรือเลขใบ"
                  aria-label="ค้นหาในรายการนี้"
                  data-testid="watch-search"
                  className="h-10 w-full rounded-(--radius) border border-(--line) bg-(--bg) pl-9 pr-3 text-base text-(--ink) outline-none focus:border-(--app) sm:text-sm"
                />
              </label>
            )}
            {loading ? (
              <p className="py-8 text-center text-sm text-(--ink-soft)">กำลังโหลด…</p>
            ) : error ? (
              <div className="flex flex-col items-center gap-2 py-6 text-sm text-(--ink-soft)">
                <p>โหลดรายการไม่สำเร็จ</p>
                <Button type="button" size="sm" variant="outline" onClick={() => load(open)}>
                  ลองอีกครั้ง
                </Button>
              </div>
            ) : hitCount === 0 ? (
              <p className="py-8 text-center text-sm text-(--ink-soft)">{q ? `ไม่พบ "${query.trim()}"` : info ? info.empty : "ไม่มีคะแนนที่โดนหักแล้ว"}</p>
            ) : (
              <div className="flex flex-col">
                {isDocks
                  ? hitDocks.slice(0, shown).map((r) => <DockRow key={r.id} r={r} onOpen={remember} />)
                  : hitRows.slice(0, shown).map((r) => <OrderRow key={r.id} r={r} onOpen={remember} />)}
              </div>
            )}
            {!loading && !error && hitCount > 0 && (
              <p className="text-xs text-(--ink-soft)" data-testid="watch-count">
                แสดง {Math.min(shown, hitCount)} จาก {hitCount}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
