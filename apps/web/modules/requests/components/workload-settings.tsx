"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { PETTY_CATEGORIES } from "../lib/types";
import { LIMIT_KINDS, type LimitKind, type SpendLimitRule } from "../lib/spend-rules";

const field = "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)";
const chip = (on: boolean) => `inline-flex h-9 items-center rounded-full px-3 text-sm ${on ? "bg-(--brand-navy) font-semibold text-white" : "border border-(--line)"}`;
const KIND_LABEL: Record<LimitKind, string> = { cash_advance: "เบิกเงินไปซื้อของ", expense: "เบิกค่าใช้จ่าย (จ่ายเองไปก่อน)" };

export interface WorkloadState {
  spendLimits: SpendLimitRule[];
  cashConfirmMode: boolean;
  noReceiptOn: boolean;
  noReceiptMax: string;
  autoCloseClear: boolean;
}

/**
 * ตั้งค่า "ลดงาน HR" (ผู้ใช้ 22/11/2569) — ทุกข้อปิดไว้เป็นค่าเริ่มต้น = แบบเดิม
 *   วงเงินรายคน · ใบรับรองแทนใบเสร็จ · จ่ายเงินสดให้ผู้รับกดยืนยัน · ยอดตรงปิดใบเอง
 */
export function WorkloadSettings({ value, onChange, people }: { value: WorkloadState; onChange: (v: WorkloadState) => void; people: { userId: string; name: string; isWorker: boolean }[] }) {
  const set = (patch: Partial<WorkloadState>) => onChange({ ...value, ...patch });
  const setRule = (i: number, patch: Partial<SpendLimitRule>) => set({ spendLimits: value.spendLimits.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const addRule = () =>
    set({
      spendLimits: [
        ...value.spendLimits,
        { id: `lim-${Date.now().toString(36)}`, name: "ของใช้ในบ้านประจำ", kinds: ["cash_advance", "expense"], categories: [], perRequest: 500, perWeek: 2000, userIds: [], active: true },
      ],
    });

  return (
    <section className="flex flex-col gap-4 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4">
      <div>
        <h2 className="text-sm font-bold text-(--ink)">ลดงานอนุมัติและจ่ายเงิน</h2>
        <p className="text-xs text-(--ink-soft)">ทุกข้อปิดไว้เป็นค่าเริ่มต้น ไม่เปิด = ทำงานแบบเดิมทุกอย่าง</p>
      </div>

      {/* วงเงินรายคน */}
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold text-(--ink)">วงเงินรายคน — ใบในวงเงินผ่านเอง ไม่ต้องรอใครกด</h3>
          <p className="text-xs text-(--ink-soft)">
            เกินครั้งละ / เกินวงเงินสัปดาห์ / นอกหมวด = ไปหาคนอนุมัติตามปกติ · ยังต้องจ่ายเงินและส่งใบเสร็จเหมือนเดิม · ใบของคนที่อนุมัติได้เอง ใบที่ต้องผ่าน CEO และคนที่ค้างส่งใบเสร็จเกินกำหนด ไม่ผ่านเอง
          </p>
        </div>
        {value.spendLimits.map((r, i) => (
          <RuleCard key={r.id} rule={r} people={people} onChange={(patch) => setRule(i, patch)} onRemove={() => set({ spendLimits: value.spendLimits.filter((_, j) => j !== i) })} />
        ))}
        <button type="button" onClick={addRule} className="inline-flex items-center gap-1 self-start text-sm font-medium text-(--app-strong) hover:underline">
          <Plus className="h-4 w-4" aria-hidden="true" /> เพิ่มวงเงิน
        </button>
      </div>

      <div className="h-px bg-(--line)" />

      {/* ใบรับรองแทนใบเสร็จ */}
      <label className="flex items-start gap-3 text-sm text-(--ink)">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={value.noReceiptOn} onChange={(e) => set({ noReceiptOn: e.target.checked, noReceiptMax: e.target.checked && !value.noReceiptMax ? "500" : value.noReceiptMax })} />
        <span>
          ร้านไม่มีบิล ใช้ “ใบรับรองแทนใบเสร็จรับเงิน” ได้
          <span className="block text-xs text-(--ink-soft)">กรอกในมือถือ (วันที่ ร้าน รายการ ยอด) + แนบรูปของที่ซื้อ ใช้แทนบิลได้ทั้งตอนยื่นเบิก ตอนส่งเคลียร์ และเงินสดย่อย · ขึ้นป้าย “ไม่มีบิล” ให้เห็นทุกใบ</span>
        </span>
      </label>
      {value.noReceiptOn && (
        <label className="flex max-w-xs flex-col gap-1.5 pl-7 text-sm">
          <span className="font-semibold">ใบละไม่เกิน (บาท)</span>
          <input inputMode="decimal" className={field} value={value.noReceiptMax} onChange={(e) => set({ noReceiptMax: e.target.value })} aria-label="ใบรับรองแทนใบเสร็จ ใบละไม่เกิน" />
          <span className="text-xs text-(--ink-soft)">เกินนี้ต้องมีบิลจริง</span>
        </label>
      )}

      {/* จ่ายเงินสด ให้ผู้รับยืนยัน */}
      <label className="flex items-start gap-3 text-sm text-(--ink)">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={value.cashConfirmMode} onChange={(e) => set({ cashConfirmMode: e.target.checked })} />
        <span>
          จ่ายเงินสด ไม่ต้องถ่ายรูป — ให้คนรับกด “ได้รับเงินแล้ว” ในมือถือแทน
          <span className="block text-xs text-(--ink-soft)">ใช้กับพนักงานที่มีบัญชีในระบบ · ระบบเก็บชื่อและเวลาที่กดเป็นหลักฐาน · ติ๊กจ่ายหลายใบพร้อมกันได้ · คนงาน/ช่างภายนอกยังต้องแนบรูปเหมือนเดิม</span>
        </span>
      </label>

      {/* ยอดตรงปิดเอง */}
      <label className="flex items-start gap-3 text-sm text-(--ink)">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={value.autoCloseClear} onChange={(e) => set({ autoCloseClear: e.target.checked })} />
        <span>
          ส่งใบเสร็จแล้วยอดตรง ปิดใบเอง
          <span className="block text-xs text-(--ink-soft)">ใช้จริง + เงินทอน = ที่ได้ไป และยอดที่ระบบอ่านจากใบเสร็จตรงกับที่กรอก · ไม่มีเงินทอน = ปิดทันที · มีเงินทอน = ปิดเมื่อคนถือเงินกด “ได้รับเงินทอน” · ยอดไม่ตรง = HR ตรวจเหมือนเดิม</span>
        </span>
      </label>
    </section>
  );
}

function RuleCard({ rule, people, onChange, onRemove }: { rule: SpendLimitRule; people: { userId: string; name: string; isWorker: boolean }[]; onChange: (p: Partial<SpendLimitRule>) => void; onRemove: () => void }) {
  const [query, setQuery] = useState("");
  const picked = new Set(rule.userIds);
  const shown = useMemo(() => people.filter((p) => !query.trim() || p.name.toLowerCase().includes(query.trim().toLowerCase())), [people, query]);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className={`flex flex-col gap-3 rounded-(--radius) border p-3 ${rule.active ? "border-(--line)" : "border-dashed border-(--line) opacity-70"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${field} min-w-0 flex-1`} value={rule.name} onChange={(e) => onChange({ name: e.target.value })} aria-label="ชื่อวงเงิน" placeholder="เช่น ของใช้ในบ้านประจำ" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={rule.active} onChange={(e) => onChange({ active: e.target.checked })} /> ใช้อยู่
        </label>
        <button type="button" onClick={onRemove} aria-label={`ลบวงเงิน ${rule.name}`} className="flex h-10 w-10 items-center justify-center rounded-(--radius) border border-(--line) text-(--ink-soft) hover:bg-(--bg-soft)">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-(--ink-soft)">ใช้กับใบ</span>
        <div className="flex flex-wrap gap-1.5">
          {LIMIT_KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={rule.kinds.includes(k)} onClick={() => onChange({ kinds: toggle(rule.kinds, k).length ? toggle(rule.kinds, k) : rule.kinds })} className={chip(rule.kinds.includes(k))}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-(--ink-soft)">หมวดที่ใช้ได้ (ไม่เลือก = ทุกหมวด)</span>
        <div className="flex flex-wrap gap-1.5">
          {PETTY_CATEGORIES.map((c) => (
            <button key={c} type="button" aria-pressed={rule.categories.includes(c)} onClick={() => onChange({ categories: toggle(rule.categories, c) })} className={chip(rule.categories.includes(c))}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">ครั้งละไม่เกิน (บาท)</span>
          <input inputMode="decimal" className={field} value={rule.perRequest || ""} onChange={(e) => onChange({ perRequest: Number(e.target.value.replace(/,/g, "")) || 0 })} aria-label={`${rule.name} ครั้งละไม่เกิน`} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">ต่อสัปดาห์ไม่เกิน (บาท)</span>
          <input inputMode="decimal" className={field} value={rule.perWeek || ""} onChange={(e) => onChange({ perWeek: Number(e.target.value.replace(/,/g, "")) || 0 })} aria-label={`${rule.name} ต่อสัปดาห์ไม่เกิน`} />
        </label>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-(--ink-soft)">คนที่ใช้วงเงินนี้ได้ ({rule.userIds.length} คน) · สัปดาห์ = จันทร์–อาทิตย์ นับต่อคน</span>
        <input className={field} placeholder="ค้นหาชื่อ" value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`ค้นหาคนในวงเงิน ${rule.name}`} />
        <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
          {shown.map((p) => (
            <button key={p.userId} type="button" aria-pressed={picked.has(p.userId)} onClick={() => onChange({ userIds: toggle(rule.userIds, p.userId) })} className={chip(picked.has(p.userId))}>
              {p.name}
              {p.isWorker ? " · คนงาน" : ""}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
