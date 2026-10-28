"use client";

import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";

import { Notice } from "@/modules/requests/components/ui";
import { addAdjustmentAction, removeAdjustmentAction, submitRunAction, updateAdjustmentAction } from "../actions";
import type { Adjustment } from "../lib/compute";
import { fmtBaht } from "../lib/types";
import { field, hint, navy, outline } from "./ui";
import { useRun } from "./use-run";

export interface ReviewPerson {
  employmentId: string;
  name: string;
  department: string;
  updatedAt: string;
  /** คนทำเงินเดือน (ไม่ใช่ CEO) แก้ของตัวเองไม่ได้ */
  locked: boolean;
  adjustments: Adjustment[];
  net: number;
}

export interface ReviewItem {
  id: string;
  name: string;
  kind: "earning" | "deduction";
  taxable: boolean;
  ssoBase: boolean;
}

/**
 * รายเพิ่ม–รายหักของทุกคนในรอบ (หน้าต่างเดียว) — ข้อกำหนด HR 28/10/2569:
 * หลายรายการต่อคน · แต่ละรายการมีประเภท รายละเอียด จำนวนเงิน · เพิ่ม/แก้/ลบได้ก่อนสรุป
 * โหมด submit = ขั้น "ตรวจก่อนสรุป" — โชว์ข้อที่ต้องแก้ แล้วค่อยยืนยันส่ง
 */
export function AdjustmentsDialog({
  runId,
  people,
  items,
  editable,
  submit,
  trigger,
}: {
  runId: string;
  people: ReviewPerson[];
  items: ReviewItem[];
  editable: boolean;
  /** มี = ปุ่มนี้คือ "ส่ง" (ตรวจก่อนสรุป) */
  submit?: { mode: "ceo" | "ceo_on_change" | "hr"; blocks: string[]; negatives: string[]; warnings: number };
  trigger: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [onlyWith, setOnlyWith] = useState(false);
  const { busy, error, run } = useRun();
  const count = people.reduce((n, p) => n + p.adjustments.length, 0);
  const shown = people.filter((p) => (!onlyWith || p.adjustments.length > 0) && (!q.trim() || p.name.includes(q.trim())));
  const plus = people.reduce((n, p) => n + p.adjustments.filter((a) => a.kind === "earning").reduce((m, a) => m + a.amount, 0), 0);
  const minus = people.reduce((n, p) => n + p.adjustments.filter((a) => a.kind === "deduction").reduce((m, a) => m + a.amount, 0), 0);
  const canSend = !!submit && submit.blocks.length === 0 && submit.negatives.length === 0;

  return (
    <>
      <button type="button" className={submit ? navy : outline} onClick={() => setOpen(true)}>
        {trigger}
        {!submit && count > 0 && <span className="rounded-full bg-(--bg-soft) px-1.5 text-xs font-bold">{count}</span>}
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={submit ? "ตรวจก่อนสรุป" : "รายเพิ่ม–รายหัก"}>
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-t-(--radius-lg) bg-(--bg) shadow-xl sm:rounded-(--radius-lg)">
            <div className="flex items-start gap-3 border-b border-(--line) px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold text-(--ink)">{submit ? "ตรวจก่อนสรุปรอบ" : "รายเพิ่ม–รายหัก งวดนี้"}</div>
                <div className={hint}>
                  {submit ? "ตรวจรายเพิ่ม–รายหักของทุกคน และข้อที่ต้องแก้ ก่อนส่ง" : "เพิ่มได้หลายรายการต่อคน · แก้/ลบได้จนกว่าจะส่งอนุมัติ"} · รวมรายเพิ่ม {fmtBaht(plus)} · รายหัก {fmtBaht(minus)}
                </div>
              </div>
              <button type="button" aria-label="ปิด" onClick={() => setOpen(false)} className="inline-flex h-10 w-10 items-center justify-center rounded-(--radius) border border-(--line) hover:bg-(--bg-soft)">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="flex flex-col gap-3">
                {submit && (
                  <section className="flex flex-col gap-2">
                    {submit.blocks.length > 0 || submit.negatives.length > 0 ? (
                      <Notice tone="danger">
                        <strong>ยังส่งไม่ได้ — แก้ก่อน:</strong>
                        <ul className="mt-1 list-disc pl-5">
                          {submit.blocks.map((b) => <li key={b}>{b}</li>)}
                          {submit.negatives.length > 0 && <li>ยอดสุทธิติดลบ: {submit.negatives.join(", ")}</li>}
                        </ul>
                        <span className="mt-1 block text-xs">แก้ข้อมูลต้นทาง (เช่น ใส่คะแนน Tier ที่ระบบบุคคล › พนักงาน › ค่าคอม) แล้วกด &quot;ดึงข้อมูลใหม่&quot;</span>
                      </Notice>
                    ) : (
                      <Notice tone="ok">ข้อมูล Grade / Tier / ค่าคอม ครบ · ไม่มีคนยอดติดลบ{submit.warnings > 0 ? ` · มี ${submit.warnings} คนที่มีข้อเตือน (⚠ ในตาราง) ดูแล้วส่งได้` : ""}</Notice>
                    )}
                  </section>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <input aria-label="ค้นหาชื่อ" className={`${field} h-10 max-w-xs`} placeholder="ค้นหาชื่อ" value={q} onChange={(e) => setQ(e.target.value)} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={onlyWith} onChange={(e) => setOnlyWith(e.target.checked)} /> เฉพาะคนที่มีรายการ
                  </label>
                </div>

                <ul className="flex flex-col gap-2">
                  {shown.map((p) => (
                    <PersonBlock key={p.employmentId} runId={runId} p={p} items={items} editable={editable && !p.locked} />
                  ))}
                  {shown.length === 0 && <li className={hint}>ไม่มีรายชื่อตรงกับที่ค้นหา</li>}
                </ul>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-(--line) px-5 py-3">
              {error && <span className="mr-auto text-sm text-red-700">{error}</span>}
              <button type="button" className={outline} onClick={() => setOpen(false)} disabled={busy}>
                {submit ? "ยังก่อน" : "ปิด"}
              </button>
              {submit && (
                <button type="button" className={navy} disabled={busy || !canSend} onClick={() => run(() => submitRunAction({ runId }), () => setOpen(false))}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {submit.mode === "hr" ? "ถูกต้อง ยืนยันยอด" : "ถูกต้อง ส่งให้ CEO อนุมัติ"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PersonBlock({ runId, p, items, editable }: { runId: string; p: ReviewPerson; items: ReviewItem[]; editable: boolean }) {
  const [adding, setAdding] = useState(false);
  const ctx = { runId, employmentId: p.employmentId, expectUpdatedAt: p.updatedAt };
  const plus = p.adjustments.filter((a) => a.kind === "earning").reduce((n, a) => n + a.amount, 0);
  const minus = p.adjustments.filter((a) => a.kind === "deduction").reduce((n, a) => n + a.amount, 0);
  return (
    <li className="rounded-(--radius) border border-(--line) p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-semibold text-(--ink)">{p.name}</span>
          {p.department && <span className="ml-2 text-xs text-(--ink-soft)">{p.department}</span>}
        </div>
        <div className="text-xs tabular-nums text-(--ink-soft)">
          {plus > 0 && <><span className="text-emerald-800">+{fmtBaht(plus)}</span> · </>}
          {minus > 0 && <><span className="text-red-800">−{fmtBaht(minus)}</span> · </>}
          สุทธิ <strong className="text-(--ink)">{fmtBaht(p.net)}</strong>
        </div>
      </div>
      {p.locked && <p className="mt-1 text-xs text-amber-800">เงินเดือนของคุณเอง — ให้ CEO เป็นคนแก้</p>}
      {p.adjustments.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {p.adjustments.map((a) => (
            <AdjustmentRow key={a.id} a={a} ctx={ctx} editable={editable} items={items} />
          ))}
        </ul>
      )}
      {editable && !adding && (
        <button type="button" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-(--app-strong) underline" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> เพิ่มรายเพิ่ม/รายหัก
        </button>
      )}
      {adding && <AddRow ctx={ctx} items={items} onDone={() => setAdding(false)} />}
    </li>
  );
}

function AdjustmentRow({ a, ctx, editable, items }: { a: Adjustment; ctx: { runId: string; employmentId: string; expectUpdatedAt: string }; editable: boolean; items: ReviewItem[] }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ label: a.label, reason: a.reason, amount: String(a.amount) });
  const { busy, error, run } = useRun();
  const names = items.filter((i) => i.kind === a.kind).map((i) => i.name);
  if (edit) {
    return (
      <li className="grid grid-cols-1 gap-2 rounded-(--radius) border border-dashed border-(--line) bg-(--bg-soft) p-2 sm:grid-cols-[10rem_1fr_7rem_auto]">
        <input aria-label="ประเภท" list={`names-${a.kind}`} className={`${field} h-10`} value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} />
        <datalist id={`names-${a.kind}`}>{names.map((n) => <option key={n} value={n} />)}</datalist>
        <input aria-label="รายละเอียด" className={`${field} h-10`} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        <input aria-label="จำนวนเงิน" inputMode="decimal" className={`${field} h-10`} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        <div className="flex gap-1.5">
          <button type="button" className={`${outline} h-10`} onClick={() => setEdit(false)} disabled={busy}>ยกเลิก</button>
          <button
            type="button"
            className={`${navy} h-10`}
            disabled={busy}
            onClick={() => run(() => updateAdjustmentAction({ ...ctx, adjustmentId: a.id, label: v.label, reason: v.reason, amount: Number(v.amount.replace(/,/g, "")) }), () => setEdit(false))}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} บันทึก
          </button>
        </div>
        {error && <span className="text-xs text-red-700 sm:col-span-4">{error}</span>}
      </li>
    );
  }
  return (
    <li className="flex items-start justify-between gap-3 rounded-(--radius) bg-(--bg-soft) px-3 py-2">
      <div className="min-w-0">
        <div className="text-sm">
          <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[11px] font-bold ${a.kind === "earning" ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}>{a.kind === "earning" ? "รายเพิ่ม" : "รายหัก"}</span>
          <strong className="text-(--ink)">{a.label}</strong>
        </div>
        <div className="text-xs text-(--ink-soft)">{a.reason}{a.byName ? ` · โดย ${a.byName}` : ""}</div>
        {error && <div className="text-xs text-red-700">{error}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className={`text-sm font-semibold tabular-nums ${a.kind === "earning" ? "text-emerald-800" : "text-red-800"}`}>{a.kind === "earning" ? "+" : "−"}{fmtBaht(a.amount)}</span>
        {editable && (
          <>
            <button type="button" aria-label={`แก้ ${a.label}`} onClick={() => setEdit(true)} className="inline-flex h-8 w-8 items-center justify-center rounded-(--radius) border border-(--line) bg-(--bg) hover:bg-(--bg-soft)">
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button type="button" aria-label={`ลบ ${a.label}`} disabled={busy} onClick={() => run(() => removeAdjustmentAction({ ...ctx, adjustmentId: a.id }))} className="inline-flex h-8 w-8 items-center justify-center rounded-(--radius) border border-(--line) bg-(--bg) hover:bg-red-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function AddRow({ ctx, items, onDone }: { ctx: { runId: string; employmentId: string; expectUpdatedAt: string }; items: ReviewItem[]; onDone: () => void }) {
  const [kind, setKind] = useState<"earning" | "deduction">("earning");
  const [itemId, setItemId] = useState("");
  const [labelText, setLabelText] = useState("");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const { busy, error, run } = useRun();
  const list = items.filter((i) => i.kind === kind);
  const item = list.find((i) => i.id === itemId);
  const chip = (on: boolean, tone: string) => `h-9 rounded-full border px-3 text-sm ${on ? `${tone} font-semibold` : "border-(--line) text-(--ink-soft)"}`;
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-(--radius) border border-dashed border-(--line) bg-(--bg-soft) p-3">
      <div role="radiogroup" aria-label="ชนิด" className="flex gap-2">
        <button type="button" role="radio" aria-checked={kind === "earning"} className={chip(kind === "earning", "border-emerald-600 bg-emerald-50 text-emerald-900")} onClick={() => { setKind("earning"); setItemId(""); }}>+ รายเพิ่ม</button>
        <button type="button" role="radio" aria-checked={kind === "deduction"} className={chip(kind === "deduction", "border-red-600 bg-red-50 text-red-900")} onClick={() => { setKind("deduction"); setItemId(""); }}>− รายหัก</button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[12rem_1fr_8rem]">
        <div className="flex flex-col gap-1">
          <select aria-label="ประเภท" className={`${field} h-10`} value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">อื่นๆ (พิมพ์เอง)</option>
            {list.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          {!item && <input aria-label="ชื่อประเภท" className={`${field} h-10`} placeholder="ประเภท เช่น ค่าเดินทาง" value={labelText} onChange={(e) => setLabelText(e.target.value)} />}
        </div>
        <input aria-label="รายละเอียด" className={`${field} h-10`} placeholder="รายละเอียด (CEO เห็นตอนอนุมัติ)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <input aria-label="จำนวนเงิน" inputMode="decimal" className={`${field} h-10`} placeholder="บาท" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <p className={hint}>เป็นรายการของงวดนี้งวดเดียว · ทุกเดือน/ผ่อนหลายงวด ตั้งที่ &quot;แก้ไข&quot; รายคน</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`${outline} h-10`} onClick={onDone} disabled={busy}>ยกเลิก</button>
        <button
          type="button"
          className={`${navy} h-10`}
          disabled={busy || !reason.trim() || !amount.trim() || (!item && !labelText.trim())}
          onClick={() =>
            run(
              () =>
                addAdjustmentAction({
                  ...ctx,
                  kind,
                  itemId: item?.id ?? null,
                  label: item?.name ?? labelText,
                  amount: Number(amount.replace(/,/g, "")),
                  taxable: item?.taxable ?? kind === "earning",
                  ssoBase: item?.ssoBase ?? false,
                  reason,
                  repeat: "once",
                  months: 0,
                  saveName: false,
                }),
              onDone,
            )
          }
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} เพิ่ม
        </button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    </div>
  );
}
