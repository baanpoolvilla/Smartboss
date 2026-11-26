"use client";

import { useMemo, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { saveExpenseTrackingAction } from "@/app/(shell)/maintenance/settings/actions";
import { useCeoTitle } from "@/lib/ceo-title-client";

/**
 * ตั้งค่า "เตือนลงบิลค่าใช้จ่าย" แบบอ่านง่าย (ผู้ใช้ 18/11/2569 "งง ทำไมใช้ยากจัง" · mockup Bj91zJ7eiZCxXbW6dnUDat)
 *
 * กติกาเหมือนเดิมทุกอย่าง (lib/expense-deadline.ts) — เปลี่ยนแค่หน้าตั้งค่า:
 *   สวิตช์เปิด/ปิด แทนช่องวันที่ (เปิดครั้งแรก = เริ่มนับวันนี้ · เปิดอยู่แล้วแก้คน/จำนวนวัน วันเริ่มเดิมไม่เปลี่ยน)
 *   เลือกคนลงบิล: คนที่เลือกขึ้นเป็นป้าย · รายชื่อทั้งหมดในกล่องเลื่อน แยกแผนก ค้นหาได้ (บริษัทคนเยอะ)
 *   กล่อง "ถ้ากดบันทึกตอนนี้" บอกผลก่อนกด
 */
export interface RecorderOption {
  id: string;
  name: string;
  dept: string;
}

const DAY_CHOICES = [7, 14, 30];
const NO_DEPT = "ไม่ระบุแผนก";

function thDate(ymd: string): string {
  return new Date(`${ymd}T00:00:00+07:00`).toLocaleDateString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

function addDays(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function ExpenseTrackingForm({
  initialFrom,
  initialDays,
  initialRecorderIds,
  initialRecorderOnly = false,
  options,
  allowedIds,
  names,
  pendingCount,
  today,
}: {
  /** YYYY-MM-DD หรือ null = ปิดอยู่ */
  initialFrom: string | null;
  initialDays: number;
  initialRecorderIds: string[];
  /** เฉพาะคนลงบิลที่เลือก + Boss ลงค่าใช้จ่ายของใบงานได้ (ผู้ใช้ 26/11/2569) */
  initialRecorderOnly?: boolean;
  /** คนที่มีสิทธิ์ลงบิล (ไม่รวมผู้ดูแลระบบสูงสุด) */
  options: RecorderOption[];
  /** ทุกคนที่ถือสิทธิ์ลงบิล (รวมผู้ดูแลระบบสูงสุดที่เคยติ๊กไว้) — ฝั่ง server เก็บเฉพาะคนกลุ่มนี้ */
  allowedIds: string[];
  /** ชื่อของทุก id ที่อาจถูกติ๊กไว้ (รวมคนที่ไม่อยู่ในรายชื่อแล้ว) */
  names: Record<string, string>;
  pendingCount: number;
  today: string;
}) {
  const [on, setOn] = useState(initialFrom !== null);
  const [picked, setPicked] = useState<string[]>(initialRecorderIds);
  const [days, setDays] = useState(initialDays);
  const [recorderOnly, setRecorderOnly] = useState(initialRecorderOnly);
  const ceo = useCeoTitle();
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const optionIds = useMemo(() => new Set(options.map((o) => o.id)), [options]);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = options.filter((o) => !q || o.name.toLowerCase().includes(q) || o.dept.toLowerCase().includes(q));
    const byDept = new Map<string, RecorderOption[]>();
    for (const o of hits) byDept.set(o.dept, [...(byDept.get(o.dept) ?? []), o]);
    // แผนกเรียงตามชื่อ · "ไม่ระบุแผนก" ไว้ท้าย
    return [...byDept.entries()].sort(([a], [b]) => (a === NO_DEPT ? 1 : b === NO_DEPT ? -1 : a.localeCompare(b, "th")));
  }, [options, query]);
  const hitCount = groups.reduce((n, [, list]) => n + list.length, 0);

  const toggle = (id: string) => setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const setMany = (ids: string[], add: boolean) =>
    setPicked((prev) => (add ? [...prev, ...ids.filter((id) => !prev.includes(id))] : prev.filter((id) => !ids.includes(id))));

  const from = on ? (initialFrom ?? today) : null;
  const usable = picked.filter((id) => allowedIds.includes(id));
  const backlogDue = addDays(from ?? today, days);
  const canSave = !pending && (!on || usable.length > 0);

  const status =
    initialFrom === null
      ? "ปิดอยู่ · ยังไม่มีใครได้รับแจ้งเตือน และไม่มีใครโดนหักคะแนน"
      : `เปิดอยู่ ตั้งแต่ ${thDate(initialFrom)} · คนลงบิล ${initialRecorderIds.length} คน · ลงภายใน ${initialDays} วัน`;

  const save = () => {
    setError(null);
    setSaved(null);
    const fd = new FormData();
    fd.set("from", from ?? "");
    fd.set("days", String(days));
    if (recorderOnly) fd.set("recorderOnly", "1");
    for (const id of picked) fd.append("recorderIds", id);
    start(async () => {
      try {
        await saveExpenseTrackingAction(fd);
        setSaved(on ? `✓ บันทึกแล้ว · เปิดใช้ตั้งแต่ ${thDate(from!)}` : "✓ ปิดแล้ว");
      } catch (e) {
        setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
      }
    });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="expense-tracking-form">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-(--ink)">เตือนลงบิลค่าใช้จ่าย</h2>
          <p className={`text-xs ${initialFrom ? "text-(--tone-ok)" : "text-(--ink-soft)"}`}>{status}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => setOn((v) => !v)}
          className="flex shrink-0 items-center gap-2 rounded-lg p-1 text-sm font-semibold text-(--ink) focus-visible:outline-2 focus-visible:outline-(--brand-navy)"
          data-testid="expense-switch"
        >
          {on ? "เปิด" : "ปิด"}
          <span className={`relative h-7 w-12 rounded-full transition-colors ${on ? "bg-(--brand-navy)" : "bg-(--line)"}`}>
            <span className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`} />
          </span>
        </button>
      </div>

      <div className={`flex flex-col gap-4 ${on ? "" : "pointer-events-none opacity-45"}`} aria-disabled={!on}>
        <div>
          <p className="mb-2 text-sm font-semibold text-(--ink)">
            1. ใครเป็นคนลงบิล?{" "}
            <span className="font-normal text-(--ink-soft) text-xs">เลือกได้หลายคน · คนที่เลือกจะได้แจ้งเตือนและรับผิดชอบร่วมกัน</span>
          </p>
          <div className="mb-2 flex min-h-8 flex-wrap items-center gap-1.5">
            <span className="text-xs text-(--ink-soft)">
              {picked.length === 0 ? "ยังไม่ได้เลือกใคร · ค้นหาแล้วติ๊กชื่อด้านล่าง" : `เลือกแล้ว ${picked.length} คน:`}
            </span>
            {picked.map((id) => {
              const lost = !allowedIds.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggle(id)}
                  aria-label={`เอา ${names[id] ?? id} ออก`}
                  className={`inline-flex items-center gap-1.5 rounded-full py-1 pr-1.5 pl-3 text-xs ${
                    lost ? "bg-(--danger-bg) text-(--danger)" : "bg-(--brand-navy) text-white"
                  }`}
                  title={lost ? "คนนี้ไม่มีสิทธิ์ลงบิลแล้ว หรือปิดบัญชีแล้ว" : undefined}
                >
                  {names[id] ?? "ผู้ใช้ที่ไม่พบ"}
                  {lost && " (ไม่มีสิทธิ์แล้ว)"}
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              );
            })}
          </div>
          {options.length === 0 ? (
            <p className="rounded-(--radius) bg-(--bg-soft) p-3 text-xs text-(--ink-soft)">
              ยังไม่มีใครมีสิทธิ์บันทึก/แก้ไขค่าใช้จ่าย ให้สิทธิ์ที่หน้าบทบาทก่อน
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-(--line)">
              <label className="flex h-10 items-center gap-2 border-b border-(--line) px-3 text-(--ink-soft)">
                <Search className="h-4 w-4" aria-hidden />
                <input
                  id="expense-recorder-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="พิมพ์ชื่อหรือแผนก เพื่อค้นหา"
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent text-sm text-(--ink) outline-none"
                />
              </label>
              <div className="max-h-64 overflow-y-auto" role="listbox" aria-multiselectable aria-label="รายชื่อคนที่มีสิทธิ์ลงบิล">
                {hitCount === 0 && <p className="p-3 text-xs text-(--ink-soft)">ไม่พบชื่อ &quot;{query}&quot; · รายชื่อนี้มีเฉพาะคนที่มีสิทธิ์ลงบิล</p>}
                {groups.map(([dept, list]) => {
                  const allOn = list.every((o) => picked.includes(o.id));
                  return (
                    <div key={dept}>
                      <div className="sticky top-0 z-10 flex justify-between bg-(--bg-soft) px-3 py-1 text-xs font-semibold text-(--ink-soft)">
                        <span>
                          {dept} · {list.length} คน
                        </span>
                        <button
                          type="button"
                          onClick={() => setMany(list.map((o) => o.id), !allOn)}
                          className="font-semibold text-(--brand-navy)"
                        >
                          {allOn ? "เอาออกทั้งแผนก" : "เลือกทั้งแผนก"}
                        </button>
                      </div>
                      {list.map((o) => {
                        const sel = picked.includes(o.id);
                        return (
                          <button
                            key={o.id}
                            type="button"
                            role="option"
                            aria-selected={sel}
                            onClick={() => toggle(o.id)}
                            className="flex w-full items-center gap-2.5 border-b border-(--line) px-3 py-2 text-left text-sm text-(--ink) last:border-b-0 hover:bg-(--bg-soft)"
                          >
                            <span
                              className={`grid h-4.5 w-4.5 shrink-0 place-items-center rounded border-[1.5px] text-[11px] text-white ${
                                sel ? "border-(--brand-navy) bg-(--brand-navy)" : "border-(--ink-soft)"
                              }`}
                              aria-hidden
                            >
                              {sel ? "✓" : ""}
                            </span>
                            {o.name}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              <p className="border-t border-(--line) px-3 py-1.5 text-xs text-(--ink-soft)">
                มีสิทธิ์ลงบิล {options.length} คน{query.trim() ? ` · ค้นเจอ ${hitCount} คน` : ""}
              </p>
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-(--ink)">2. ปิดงานแล้วต้องลงบิลภายในกี่วัน?</p>
          <div className="flex flex-wrap gap-2">
            {[...new Set([...DAY_CHOICES, initialDays])].sort((a, b) => a - b).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={days === n}
                onClick={() => setDays(n)}
                className={`rounded-lg border px-4 py-1.5 text-sm tabular-nums ${
                  days === n ? "border-(--brand-navy) bg-(--brand-navy) font-semibold text-white" : "border-(--line) text-(--ink)"
                }`}
              >
                {n} วัน
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-(--ink)">3. ใครลงค่าใช้จ่ายของใบงานได้?</p>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="ใครลงค่าใช้จ่ายของใบงานได้">
            {([
              [false, "ทุกคนที่มีสิทธิ์ลงค่าใช้จ่าย", "แบบเดิม · คนลงบิลที่เลือกข้างบนแค่ได้แจ้งเตือนและรับผิดชอบกำหนดส่ง"],
              [true, `เฉพาะคนลงบิลที่เลือก + ${ceo}`, `คนอื่นเปิดใบงานแล้วไม่เห็นปุ่มลงค่าใช้จ่าย · ${ceo} ลงได้แต่ไม่ได้รับแจ้งเตือน · ค่าใช้จ่ายทั่วไปที่ไม่ผูกใบงานยังลงได้ตามสิทธิ์เดิม`],
            ] as [boolean, string, string][]).map(([v, title, sub]) => (
              <button
                key={String(v)}
                type="button"
                role="radio"
                aria-checked={recorderOnly === v}
                onClick={() => setRecorderOnly(v)}
                data-testid={v ? "recorder-only-on" : "recorder-only-off"}
                className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left ${
                  recorderOnly === v ? "border-(--brand-navy) bg-(--bg-soft)" : "border-(--line)"
                }`}
              >
                <span
                  className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px] ${recorderOnly === v ? "border-(--brand-navy)" : "border-(--ink-soft)"}`}
                  aria-hidden
                >
                  {recorderOnly === v && <span className="h-2 w-2 rounded-full bg-(--brand-navy)" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-(--ink)">{title}</span>
                  <span className="block text-xs text-(--ink-soft)">{sub}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 rounded-xl bg-(--bg-soft) p-4 text-sm" aria-live="polite">
        <p className="text-xs font-semibold text-(--ink-soft)">ถ้ากดบันทึกตอนนี้</p>
        {!on ? (
          <Row icon="⏸" title={initialFrom ? "ปิดระบบ: หยุดเตือนและหยุดหักคะแนน" : "ไม่มีอะไรเปลี่ยน"} sub="ระบบปิดอยู่ ไม่เตือนและไม่หักคะแนน" />
        ) : (
          <>
            {initialFrom === null ? (
              <Row
                icon="📦"
                title={`บิลที่ค้างอยู่ ${pendingCount} ใบ ต้องลงให้เสร็จภายใน ${thDate(backlogDue)}`}
                sub="ใบที่ค้างก่อนเปิดใช้ไม่หักคะแนน ถึงจะเลยกำหนดก็ตาม"
              />
            ) : (
              <Row icon="📦" title={`ตอนนี้รอลงบิล ${pendingCount} ใบ`} sub={`ใบที่ปิดก่อน ${thDate(initialFrom)} ไม่หักคะแนน`} />
            )}
            <Row
              icon="⏱"
              title={`ใบที่ปิดงาน${initialFrom ? "หลังจากนี้" : "ตั้งแต่วันนี้"} ต้องลงบิลภายใน ${days} วัน`}
              sub={`เลยกำหนด: หักคะแนน${
                usable.length <= 1 ? (usable[0] ? ` ${names[usable[0]] ?? ""}` : "คนที่เลือก") : `ทั้ง ${usable.length} คนที่เลือก คนละครั้ง`
              } ตอนเที่ยงคืน 5 นาทีของคืนถัดไป (เท่ากับใบแจ้งซ่อมเลยกำหนด)`}
            />
            <Row icon="🔔" title="เตือนทุกเช้า 08:05 ทั้งกระดิ่งและ LINE" sub="สรุปว่ามีบิลรอกี่ใบ ใบไหนใกล้ครบหรือเลยกำหนด" />
            {usable.length === 0 && (
              <p className="rounded-lg bg-(--danger-bg) px-3 py-2 text-xs text-(--danger)">เลือกคนลงบิลอย่างน้อย 1 คนก่อน ถึงจะกดบันทึกได้</p>
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="rounded-lg bg-(--brand-navy) px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
          data-testid="expense-save"
        >
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        {saved && <span className="text-xs font-semibold text-(--tone-ok)">{saved}</span>}
        {error && <span className="text-xs text-(--danger)">{error}</span>}
      </div>
    </div>
  );
}

function Row({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div className="grid grid-cols-[22px_minmax(0,1fr)] gap-2">
      <span aria-hidden>{icon}</span>
      <div>
        <p className="font-semibold text-(--ink)">{title}</p>
        <p className="text-xs text-(--ink-soft)">{sub}</p>
      </div>
    </div>
  );
}
