"use client";

import { advanceRound, PERIOD_LABEL, WEEKDAY_NAMES, type AdvanceGroupRule, type AdvancePeriod, type AdvanceRules, type AdvanceWho } from "../lib/advance-rules";
import type { AdvanceCapMode } from "../lib/types";

const field = "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)";
const chip = (on: boolean) => `h-9 rounded-full px-3.5 text-sm ${on ? "bg-(--brand-navy) font-semibold text-white" : "border border-(--line)"}`;

/** ตัวเลขในฟอร์มเก็บเป็นข้อความระหว่างพิมพ์ — แปลงตอนบันทึก (parseAdvanceRules ตรวจอีกชั้นที่เซิร์ฟเวอร์) */
export interface AdvanceRulesState extends Omit<AdvanceRules, "worker" | "staff"> {
  worker: AdvanceGroupForm;
  staff: AdvanceGroupForm;
}
export interface AdvanceGroupForm {
  mode: AdvanceCapMode;
  value: string;
  period: AdvancePeriod;
  maxCount: string;
}

export function toAdvanceForm(r: AdvanceRules): AdvanceRulesState {
  const g = (x: AdvanceGroupRule): AdvanceGroupForm => ({ mode: x.mode, value: x.mode === "none" ? "" : String(x.value), period: x.period, maxCount: x.maxCount === null ? "" : String(x.maxCount) });
  return { ...r, worker: g(r.worker), staff: g(r.staff) };
}

export function fromAdvanceForm(f: AdvanceRulesState): AdvanceRules {
  const g = (x: AdvanceGroupForm): AdvanceGroupRule => ({
    mode: x.mode,
    value: x.mode === "none" ? 0 : Number(x.value.replace(/,/g, "")),
    period: x.period,
    maxCount: x.maxCount.trim() === "" ? null : Number(x.maxCount),
  });
  return { ...f, worker: g(f.worker), staff: g(f.staff) };
}

const WHO: [AdvanceWho, string][] = [
  ["all", "ทุกคน"],
  ["worker", "เฉพาะคนงานรายวัน"],
  ["staff", "เฉพาะพนักงานรายเดือน"],
];

/**
 * กติกาเบิกล่วงหน้าของบริษัท (ผู้ใช้ 22/11/2569 "ให้เขาปรับเองใช้เองได้")
 * ใครเบิกได้ → การ์ดกติกาของแต่ละกลุ่ม (เพดาน · นับต่อรอบไหน · จำนวนครั้ง) → วันเริ่มรอบ · ตัวอย่างรอบของวันนี้
 */
export function AdvanceRulesSettings({ value, onChange, today }: { value: AdvanceRulesState; onChange: (v: AdvanceRulesState) => void; today: string }) {
  const set = (patch: Partial<AdvanceRulesState>) => onChange({ ...value, ...patch });
  const setGroup = (k: "worker" | "staff", patch: Partial<AdvanceGroupForm>) => set({ [k]: { ...value[k], ...patch } } as Partial<AdvanceRulesState>);
  const groups = (["worker", "staff"] as const).filter((k) => value.who === "all" || value.who === k);
  const usesMonth = groups.some((k) => value[k].period !== "week");
  const usesWeek = groups.some((k) => value[k].period === "week");

  return (
    <section className="flex flex-col gap-4 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4">
      <div>
        <h2 className="text-sm font-bold text-(--ink)">เบิกล่วงหน้า</h2>
        <p className="text-xs text-(--ink-soft)">เฉพาะใบ &quot;เบิกล่วงหน้า&quot; (ไม่เกี่ยวกับเบิกค่าใช้จ่าย/OT) · ตั้งตามกติกาของบริษัทเอง</p>
      </div>

      <div className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold text-(--ink)">ใครเบิกได้</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="ใครเบิกล่วงหน้าได้">
          {WHO.map(([w, label]) => (
            <button key={w} type="button" aria-pressed={value.who === w} onClick={() => set({ who: w })} className={chip(value.who === w)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-3 ${groups.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {groups.map((k) => {
          const g = value[k];
          const name = k === "worker" ? "คนงานรายวัน" : "พนักงานรายเดือน";
          const round = advanceRound(today, g.period, value);
          return (
            <div key={k} className="flex flex-col gap-3 rounded-(--radius) border border-(--line) p-3" aria-label={`กติกา${name}`}>
              <h3 className="text-sm font-semibold text-(--ink)">{name}</h3>
              <label className="flex items-start gap-3 text-sm text-(--ink)">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={g.mode !== "none"} onChange={(e) => setGroup(k, e.target.checked ? { mode: "baht" } : { mode: "none", value: "" })} />
                <span>
                  จำกัดยอดเบิก
                  <span className="block text-xs text-(--ink-soft)">{g.mode === "none" ? "ไม่ติ๊ก = เบิกได้ไม่จำกัด ผู้อนุมัติดูเอง" : "ยื่นเกินเพดานไม่ได้ (นับรวมที่รออนุมัติ อนุมัติแล้ว และจ่ายแล้วในรอบนั้น)"}</span>
                </span>
              </label>
              {g.mode !== "none" && (
                <div className="flex flex-wrap items-end gap-2">
                  {(
                    [
                      ["baht", "บาท"],
                      ["days", "วันของค่าแรง"],
                    ] as [AdvanceCapMode, string][]
                  ).map(([m, label]) => (
                    <button key={m} type="button" aria-pressed={g.mode === m} onClick={() => setGroup(k, { mode: m })} className={chip(g.mode === m)}>
                      {label}
                    </button>
                  ))}
                  <label className="flex w-36 flex-col gap-1 text-xs">
                    <span className="font-semibold text-(--ink)">{g.mode === "baht" ? "ไม่เกิน (บาท)" : "ไม่เกิน (วัน)"}</span>
                    <input inputMode="decimal" className={field} value={g.value} onChange={(e) => setGroup(k, { value: e.target.value })} aria-label={`เพดาน${name}`} />
                  </label>
                </div>
              )}
              {g.mode === "days" && <p className="-mt-1 text-xs text-(--ink-soft)">{k === "worker" ? "คิดจากค่าแรงต่อวันของแต่ละคน" : "คิดจากเงินเดือน ÷ 30 ของแต่ละคน"}</p>}
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="font-semibold text-(--ink)">นับรอบ</span>
                <div className="flex flex-wrap gap-2" role="group" aria-label={`นับรอบ${name}`}>
                  {(Object.keys(PERIOD_LABEL) as AdvancePeriod[]).map((p) => (
                    <button key={p} type="button" aria-pressed={g.period === p} onClick={() => setGroup(k, { period: p })} className={chip(g.period === p)}>
                      {PERIOD_LABEL[p]}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-start gap-3 text-sm text-(--ink)">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={g.maxCount !== ""} onChange={(e) => setGroup(k, { maxCount: e.target.checked ? "1" : "" })} />
                <span className="flex flex-wrap items-center gap-2">
                  จำกัดจำนวนครั้งต่อรอบ
                  {g.maxCount !== "" && (
                    <>
                      <input inputMode="numeric" className={`${field} w-20`} value={g.maxCount} onChange={(e) => setGroup(k, { maxCount: e.target.value.replace(/\D/g, "") })} aria-label={`จำนวนครั้ง${name}`} />
                      <span>ครั้ง</span>
                    </>
                  )}
                </span>
              </label>
              <p className="rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-xs text-(--ink-soft)">วันนี้อยู่ใน{round.label}</p>
            </div>
          );
        })}
      </div>

      {(usesMonth || usesWeek) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {usesMonth && (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-semibold text-(--ink)">รอบเดือนเริ่มวันที่</span>
              <select className={field} value={value.monthStartDay} onChange={(e) => set({ monthStartDay: Number(e.target.value) })}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d === 1 ? "1 (ตามเดือนปฏิทิน)" : `${d} (ถึงวันที่ ${d - 1} เดือนถัดไป)`}</option>
                ))}
              </select>
              <span className="text-xs text-(--ink-soft)">ใช้กับ “ต่อเดือน” และ “ต่อครึ่งเดือน” (ครึ่งแรก = 15 วันแรกของรอบ)</span>
            </label>
          )}
          {usesWeek && (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-semibold text-(--ink)">สัปดาห์เริ่มวัน</span>
              <select className={field} value={value.weekStart} onChange={(e) => set({ weekStart: Number(e.target.value) })}>
                {WEEKDAY_NAMES.map((n, i) => (
                  <option key={n} value={i}>{n}</option>
                ))}
              </select>
              <span className="text-xs text-(--ink-soft)">ใช้กับ “ต่อสัปดาห์”</span>
            </label>
          )}
        </div>
      )}
    </section>
  );
}
