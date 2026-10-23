"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, X } from "lucide-react";

import { Notice } from "@/modules/requests/components/ui";
import { addAdjustmentAction, deferAdvanceAction, excludeAction, overrideAction, removeAdjustmentAction } from "../actions";
import type { Adjustment, PayLine, TaxBreak } from "../lib/compute";
import { fmtBaht, type SsoParams } from "../lib/types";
import { AdvanceExplain, FlagsExplain, SalaryExplain, SsoExplain } from "./explain-content";
import { Explain } from "./help";
import { TaxSteps } from "./tax-steps";
import { dangerOutline, field, hint, label, labelText, navy, outline } from "./ui";
import { useRun } from "./use-run";

export interface EditorData {
  runId: string;
  employmentId: string;
  name: string;
  department: string;
  employeeCode: string;
  editable: boolean;
  /** บรรทัดของคนที่เปิดเอง (คนทำเงินเดือนที่ไม่ใช่ CEO) — ดูได้ แก้ไม่ได้ */
  ownLocked?: boolean;
  expectUpdatedAt: string;
  lines: PayLine[];
  adjustments: Adjustment[];
  overrides: { sso?: { amount: number; reason: string }; tax?: { amount: number; reason: string } };
  deferred: { refId: string; code: string; amount: number }[];
  items: { id: string; name: string; kind: "earning" | "deduction"; taxable: boolean; ssoBase: boolean }[];
  gross: number;
  deductions: number;
  net: number;
  ssoEmployer: number;
  ssoComputed: number;
  taxComputed: number;
  warnings: string[];
  /** วิธีคิดภาษีทีละขั้น (รอบที่คำนวณก่อนมีระบบนี้ไม่มี) */
  taxBreak?: TaxBreak;
  sso: SsoParams;
  closeHref: string;
  employeeHref: string;
  slipHref: string;
}

const BADGE: Record<string, { text: string; cls: string }> = {
  auto: { text: "อัตโนมัติ", cls: "bg-sky-100 text-sky-900" },
  recurring: { text: "ตั้งไว้ล่วงหน้า", cls: "bg-slate-100 text-slate-800" },
  adjustment: { text: "เพิ่มเองงวดนี้", cls: "bg-amber-100 text-amber-900" },
};

/**
 * แก้ไขพนักงานในรอบ — แบบหน้าต่าง "แก้ไขพนักงาน" ของ FlowAccount
 * (ข้อมูลเงินเดือน · รายการปรับเพิ่ม · รายการปรับลด · + เพิ่มรายการ) แต่ทุกบรรทัดบอกว่าคิดยังไง
 * ประกันสังคม/ภาษีปรับเองได้ ต้องมีเหตุผล และโชว์ยอดที่ระบบคิดได้คู่กันเสมอ
 */
export function LineEditor({ d }: { d: EditorData }) {
  const earn = d.lines.filter((l) => l.kind === "earning" && l.source !== "salary");
  const salary = d.lines.find((l) => l.source === "salary");
  const sso = d.lines.find((l) => l.key === "sso");
  const tax = d.lines.find((l) => l.key === "tax");
  const ded = d.lines.filter((l) => l.kind === "deduction" && l.key !== "sso" && l.key !== "tax");
  const ctx = { runId: d.runId, employmentId: d.employmentId, expectUpdatedAt: d.expectUpdatedAt };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-label={`แก้ไขเงินเดือน ${d.name}`}>
      <Link href={d.closeHref} aria-label="ปิด" className="hidden flex-1 sm:block" />
      <div className="flex h-full w-full max-w-xl flex-col bg-(--bg) shadow-xl">
        <div className="flex items-start gap-3 border-b border-(--line) px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold text-(--ink)">{d.name}</div>
            <div className="text-xs text-(--ink-soft)">{[d.employeeCode, d.department].filter(Boolean).join(" · ")}</div>
          </div>
          <Link href={d.closeHref} aria-label="ปิด" className="inline-flex h-10 w-10 items-center justify-center rounded-(--radius) border border-(--line) hover:bg-(--bg-soft)">
            <X className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-5">
            {d.ownLocked && <Notice tone="warn">นี่คือเงินเดือนของคุณเอง — แก้เองไม่ได้ ให้ CEO เป็นคนแก้ให้</Notice>}
            {!d.editable && !d.ownLocked && <Notice tone="info">รอบนี้ส่งอนุมัติแล้ว — ดูได้อย่างเดียว (แก้ได้เมื่อถูกส่งกลับ)</Notice>}
            {d.warnings.map((w, i) => (
              <Notice key={i} tone={w.includes("ติดลบ") ? "danger" : "warn"}>{w}</Notice>
            ))}

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-(--ink)">ข้อมูลเงินเดือน</h3>
              <Row
                label="เงินเดือน"
                how={salary?.how ?? "ไม่มี"}
                amount={salary?.amount ?? 0}
                extra={<Link href={d.employeeHref} className="text-xs font-semibold text-(--app-strong) underline">แก้เงินเดือน/ขึ้นเงินเดือน</Link>}
                help={<Explain q="คิดยังไง?"><SalaryExplain /></Explain>}
              />
              <OverrideRow which="sso" title="ประกันสังคม" line={sso} computed={d.ssoComputed} current={d.overrides.sso} ctx={ctx} editable={d.editable} help={<Explain q="คิดยังไง?"><SsoExplain p={d.sso} /></Explain>} />
              <OverrideRow
                which="tax"
                title="ภาษีหัก ณ ที่จ่าย"
                line={tax}
                computed={d.taxComputed}
                current={d.overrides.tax}
                ctx={ctx}
                editable={d.editable}
                help={d.taxBreak ? <Explain q="ดูวิธีคิดทีละขั้น"><TaxSteps b={d.taxBreak} /></Explain> : undefined}
              />
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-emerald-800">รายการปรับเพิ่ม</h3>
              {earn.length === 0 && <p className={hint}>ไม่มี</p>}
              {earn.map((l) => (
                <Row
                  key={l.key}
                  label={l.label}
                  how={l.how}
                  amount={l.amount}
                  badge={l.source === "ot" ? "auto" : l.source}
                  remove={l.source === "adjustment" && d.editable ? { ...ctx, adjustmentId: l.refId! } : undefined}
                  help={l.formula ? <Explain q="คิดยังไง?"><div>{l.formula}</div><div className="text-(--ink-soft)">ใบ OT ที่อนุมัติแล้วในเบิกจ่าย &amp; OT เข้ารอบเอง · อนุมัติหลังจ่ายงวดนี้ไปแล้วจะเข้างวดถัดไป</div></Explain> : undefined}
                />
              ))}
              {d.editable && <AddForm kind="earning" items={d.items} ctx={ctx} />}
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-red-800">รายการปรับลด</h3>
              {ded.length === 0 && d.deferred.length === 0 && <p className={hint}>ไม่มี (นอกจากประกันสังคม/ภาษีด้านบน)</p>}
              {ded.map((l) => (
                <Row
                  key={l.key}
                  label={l.label}
                  how={l.how}
                  amount={l.amount}
                  minus
                  badge={l.source === "adjustment" ? "adjustment" : l.source === "recurring" ? "recurring" : "auto"}
                  remove={l.source === "adjustment" && d.editable ? { ...ctx, adjustmentId: l.refId! } : undefined}
                  defer={l.source === "advance" && d.editable ? { ...ctx, requestId: l.refId!, defer: true } : undefined}
                  help={l.source === "advance" ? <Explain q="คืออะไร?"><AdvanceExplain /></Explain> : undefined}
                />
              ))}
              {d.deferred.map((x) => (
                <div key={x.refId} className="flex items-center justify-between gap-3 rounded-(--radius) border border-dashed border-(--line) px-3 py-2 text-sm">
                  <div>
                    <div className="text-(--ink-soft) line-through">หักคืนเบิกล่วงหน้า {x.code}</div>
                    <div className={hint}>เลื่อนไปหักงวดหน้า</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-(--ink-soft)">{fmtBaht(x.amount)}</span>
                    {d.editable && <DeferButton ctx={{ ...ctx, requestId: x.refId, defer: false }} text="กลับมาหักงวดนี้" />}
                  </div>
                </div>
              ))}
              {d.editable && <AddForm kind="deduction" items={d.items} ctx={ctx} />}
            </section>

            <section className="flex flex-col gap-1.5 rounded-(--radius) bg-(--bg-soft) p-3 text-sm">
              <div className="flex justify-between"><span>รวมเงินได้</span><span className="font-semibold tabular-nums">{fmtBaht(d.gross)}</span></div>
              <div className="flex justify-between"><span>รวมหัก</span><span className="font-semibold tabular-nums text-red-800">({fmtBaht(d.deductions)})</span></div>
              <div className="flex justify-between border-t border-(--line) pt-1.5 text-lg font-bold"><span>จ่ายสุทธิ</span><span className={`tabular-nums ${d.net < 0 ? "text-red-700" : ""}`}>{fmtBaht(d.net)}</span></div>
              <div className={hint}>บริษัทสมทบประกันสังคมให้อีก {fmtBaht(d.ssoEmployer)} (ไม่หักจากพนักงาน)</div>
            </section>

            <div className="flex flex-wrap gap-2">
              <Link href={d.slipHref} className={outline}>ดูสลิป</Link>
              {d.editable && <ExcludeButton ctx={ctx} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label: text,
  how,
  amount,
  minus = false,
  badge,
  extra,
  remove,
  defer,
  help,
}: {
  label: string;
  how: string;
  amount: number;
  minus?: boolean;
  badge?: string;
  extra?: React.ReactNode;
  remove?: { runId: string; employmentId: string; expectUpdatedAt: string; adjustmentId: string };
  defer?: { runId: string; employmentId: string; expectUpdatedAt: string; requestId: string; defer: boolean };
  help?: React.ReactNode;
}) {
  const b = badge ? BADGE[badge] : undefined;
  const { busy, error, run } = useRun();
  return (
    <div className="rounded-(--radius) border border-(--line) px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-(--ink)">
            {text} {b && <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${b.cls}`}>{b.text}</span>}
          </div>
          <div className="text-xs text-(--ink-soft)">{how}</div>
          {extra}
          {help}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={`text-sm font-semibold tabular-nums ${minus ? "text-red-800" : "text-(--ink)"}`}>{minus ? `(${fmtBaht(amount)})` : fmtBaht(amount)}</span>
          {remove && (
            <button type="button" aria-label={`ลบ ${text}`} disabled={busy} onClick={() => run(() => removeAdjustmentAction(remove))} className="inline-flex h-8 w-8 items-center justify-center rounded-(--radius) border border-(--line) hover:bg-red-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          )}
        </div>
      </div>
      {defer && (
        <div className="mt-1.5">
          <DeferButton ctx={defer} text="เลื่อนไปหักงวดหน้า" />
        </div>
      )}
      {error && <div className="mt-1 text-xs text-red-700">{error}</div>}
    </div>
  );
}

function DeferButton({ ctx, text }: { ctx: { runId: string; employmentId: string; expectUpdatedAt: string; requestId: string; defer: boolean }; text: string }) {
  const { busy, error, run } = useRun();
  return (
    <>
      <button type="button" disabled={busy} onClick={() => run(() => deferAdvanceAction(ctx))} className="text-xs font-semibold text-(--app-strong) underline disabled:opacity-50">
        {busy ? "กำลังทำ…" : text}
      </button>
      {error && <span className="ml-2 text-xs text-red-700">{error}</span>}
    </>
  );
}

function OverrideRow({
  which,
  title,
  line,
  computed,
  current,
  ctx,
  editable,
  help,
}: {
  which: "sso" | "tax";
  title: string;
  line?: PayLine;
  computed: number;
  current?: { amount: number; reason: string };
  ctx: { runId: string; employmentId: string; expectUpdatedAt: string };
  editable: boolean;
  help?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(current?.amount ?? computed));
  const [reason, setReason] = useState(current?.reason ?? "");
  const { busy, error, run } = useRun();
  return (
    <div className="rounded-(--radius) border border-(--line) px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-(--ink)">
            {title}{" "}
            <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${current ? BADGE.adjustment!.cls : BADGE.auto!.cls}`}>{current ? "ปรับเอง" : "อัตโนมัติ"}</span>
          </div>
          <div className="text-xs text-(--ink-soft)">{line?.how}</div>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-red-800">({fmtBaht(line?.amount ?? 0)})</span>
      </div>
      {help}
      {editable && !open && (
        <div className="mt-1.5 flex gap-3">
          <button type="button" className="text-xs font-semibold text-(--app-strong) underline" onClick={() => setOpen(true)}>ปรับยอด</button>
          {current && (
            <button type="button" className="text-xs font-semibold text-(--app-strong) underline" disabled={busy} onClick={() => run(() => overrideAction({ ...ctx, which, amount: null, reason: "" }))}>
              กลับไปใช้ที่ระบบคิด ({fmtBaht(computed)})
            </button>
          )}
        </div>
      )}
      {open && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[8rem_1fr_auto]">
          <input aria-label={`${title} ยอดใหม่`} inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input aria-label="เหตุผล" className={field} placeholder="เหตุผล (จำเป็น)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className={`${hint} sm:col-span-3 sm:order-last`}>ใช้เมื่อยอดต้องต่างจากที่ระบบคิดจริง ๆ เช่น พนักงานขอให้หักภาษีเพิ่ม · CEO เห็นยอดนี้คู่กับที่ระบบคิดตอนอนุมัติ</p>
          <div className="flex gap-1.5">
            <button type="button" className={outline} onClick={() => setOpen(false)} disabled={busy}>ยกเลิก</button>
            <button type="button" className={navy} disabled={busy || !reason.trim()} onClick={() => run(() => overrideAction({ ...ctx, which, amount: Number(amount.replace(/,/g, "")), reason }), () => setOpen(false))}>บันทึก</button>
          </div>
        </div>
      )}
      {error && <div className="mt-1 text-xs text-red-700">{error}</div>}
    </div>
  );
}

const OTHER = "__other__";

function AddForm({ kind, items, ctx }: { kind: "earning" | "deduction"; items: EditorData["items"]; ctx: { runId: string; employmentId: string; expectUpdatedAt: string } }) {
  const [open, setOpen] = useState(false);
  const choices = items.filter((i) => i.kind === kind);
  const [itemId, setItemId] = useState(choices.length ? "" : OTHER);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [repeat, setRepeat] = useState<"once" | "monthly" | "months">("once");
  const [months, setMonths] = useState("3");
  const [taxable, setTaxable] = useState(true);
  const [ssoBase, setSsoBase] = useState(false);
  const [saveName, setSaveName] = useState(false);
  const { busy, error, run } = useRun();
  const other = itemId === OTHER;
  const reset = () => {
    setOpen(false);
    setAmount("");
    setReason("");
    setName("");
    setRepeat("once");
  };
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`self-start text-sm font-semibold underline ${kind === "earning" ? "text-emerald-800" : "text-red-800"}`}>
        + เพิ่มรายการ{kind === "earning" ? "ปรับเพิ่ม" : "ปรับลด"}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-(--radius) border border-dashed border-(--line) bg-(--bg-soft) p-3">
      <label className={label}>
        <span className={labelText}>ประเภท</span>
        <select className={field} value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">— เลือกรายการ —</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
          <option value={OTHER}>อื่นๆ (พิมพ์ชื่อเอง)</option>
        </select>
      </label>
      {other && (
        <div className="flex flex-col gap-2 rounded-(--radius) border border-(--line) bg-(--bg) p-2.5">
          <label className={label}>
            <span className={labelText}>ชื่อรายการ</span>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "earning" ? "เช่น รางวัลพนักงานดีเด่น" : "เช่น ค่าชุดยูนิฟอร์ม"} />
          </label>
          {kind === "earning" && (
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} className="h-4 w-4" /> คิดภาษี</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={ssoBase} onChange={(e) => setSsoBase(e.target.checked)} className="h-4 w-4" /> นับเป็นค่าจ้างคิดประกันสังคม</label>
              <div className="basis-full"><Explain q="ติ๊กอันไหนดี?"><FlagsExplain /></Explain></div>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={saveName} onChange={(e) => setSaveName(e.target.checked)} className="h-4 w-4" /> จำชื่อนี้ไว้ใช้ครั้งหน้า</label>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className={label}>
          <span className={labelText}>จำนวนเงิน</span>
          <input inputMode="decimal" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </label>
        <label className={label}>
          <span className={labelText}>ใช้กับ</span>
          <select className={field} value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)}>
            <option value="once">งวดนี้เท่านั้น</option>
            <option value="monthly">ทุกเดือน (รายการประจำ)</option>
            <option value="months">ผ่อน หลายเดือน</option>
          </select>
        </label>
      </div>
      {repeat === "months" && (
        <label className={label}>
          <span className={labelText}>กี่เดือน (เท่ากันทุกเดือน หยุดเอง)</span>
          <input inputMode="numeric" className={field} value={months} onChange={(e) => setMonths(e.target.value)} />
        </label>
      )}
      <label className={label}>
        <span className={labelText}>หมายเหตุ <span className="font-normal text-(--ink-soft)">(จำเป็น — CEO เห็นตอนอนุมัติ)</span></span>
        <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex gap-2">
        <button type="button" className={outline} onClick={reset} disabled={busy}>ยกเลิก</button>
        <button
          type="button"
          className={navy}
          disabled={busy || !itemId || !amount || !reason.trim() || (other && !name.trim())}
          onClick={() =>
            run(
              () =>
                addAdjustmentAction({
                  ...ctx,
                  kind,
                  itemId: other ? null : itemId,
                  label: other ? name : "",
                  amount: Number(amount.replace(/,/g, "")),
                  taxable,
                  ssoBase,
                  reason,
                  repeat,
                  months: Number(months),
                  saveName,
                }),
              reset,
            )
          }
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} เพิ่ม
        </button>
      </div>
    </div>
  );
}

function ExcludeButton({ ctx }: { ctx: { runId: string; employmentId: string } }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { busy, error, run } = useRun();
  if (!open) return <button type="button" className={dangerOutline} onClick={() => setOpen(true)}>ไม่จ่ายงวดนี้</button>;
  return (
    <div className="flex w-full flex-col gap-2 rounded-(--radius) border border-red-200 bg-red-50 p-3">
      <span className="text-sm text-red-900">คนนี้จะไม่อยู่ในรอบนี้ (OT/เบิกล่วงหน้าของเขายกไปงวดหน้า) — ใส่เหตุผล</span>
      <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น พักงานไม่รับค่าจ้าง / จ่ายแยกแล้ว" />
      <div className="flex gap-2">
        <button type="button" className={outline} onClick={() => setOpen(false)} disabled={busy}>ยกเลิก</button>
        <button type="button" className={dangerOutline} disabled={busy || !reason.trim()} onClick={() => run(() => excludeAction({ ...ctx, exclude: true, reason }))}>ยืนยันไม่จ่ายงวดนี้</button>
      </div>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
