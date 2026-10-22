"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { Notice } from "@/modules/requests/components/ui";
import { decideRunAction, markPaidAction, recomputeAction, runNoteAction, submitRunAction } from "../actions";
import { fmtBaht, thaiDate } from "../lib/types";
import { dangerOutline, field, hint, label, labelText, navy, outline } from "./ui";
import { useRun } from "./use-run";

export function RecomputeButton({ runId }: { runId: string }) {
  const { busy, error, run } = useRun();
  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className={outline} disabled={busy} onClick={() => run(() => recomputeAction({ runId }))} title="ดึงเงินเดือน OT เบิกล่วงหน้า ลา ล่าสุดจากทุกระบบแล้วคิดใหม่ (รายการที่แก้เองไม่หาย)">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />} ดึงข้อมูลใหม่
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

export function SubmitButton({ runId, mode, negatives }: { runId: string; mode: "ceo" | "ceo_on_change" | "hr"; negatives: number }) {
  const { busy, error, run } = useRun();
  const [confirm, setConfirm] = useState(false);
  const labelBtn = mode === "hr" ? "ยืนยันยอด (HR อนุมัติเอง)" : "ส่งให้ CEO อนุมัติ";
  return (
    <div className="flex flex-col items-end gap-1">
      {!confirm ? (
        <button type="button" className={navy} disabled={busy || negatives > 0} onClick={() => setConfirm(true)} title={negatives > 0 ? "มีคนยอดสุทธิติดลบ — แก้ก่อน" : undefined}>
          {labelBtn}
        </button>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-(--radius) border border-(--line) bg-(--bg-soft) p-2">
          <span className="text-sm text-(--ink)">ตรวจครบแล้ว? หลังส่งจะแก้ไม่ได้จนกว่าจะถูกส่งกลับ</span>
          <button type="button" className={outline} onClick={() => setConfirm(false)} disabled={busy}>ยังก่อน</button>
          <button type="button" className={navy} disabled={busy} onClick={() => run(() => submitRunAction({ runId }), () => setConfirm(false))}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} ยืนยันส่ง
          </button>
        </div>
      )}
      {negatives > 0 && <span className="text-xs text-red-700">มีคนยอดสุทธิติดลบ {negatives} คน — แก้ก่อนส่ง</span>}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

/** CEO: อนุมัติจ่าย / ส่งกลับให้ HR แก้ (ต้องมีเหตุผล) */
export function ApproveBar({ runId, net, canApprove, approved }: { runId: string; net: number; canApprove: boolean; approved: boolean }) {
  const { busy, error, run } = useRun();
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-col gap-2">
      {returning && (
        <label className={label}>
          <span className={labelText}>เหตุผลที่ส่งกลับ (HR เห็น)</span>
          <input className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น โบนัสคนนี้เลื่อนไปเดือนหน้า" />
        </label>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className={returning ? dangerOutline : outline}
          disabled={busy || (returning && !note.trim())}
          onClick={() => (returning ? run(() => decideRunAction({ runId, outcome: "return", note }), () => setReturning(false)) : setReturning(true))}
        >
          {returning ? "ยืนยันส่งกลับ" : approved ? "ยกเลิกอนุมัติ (ส่งกลับแก้)" : "ส่งกลับให้ HR แก้"}
        </button>
        {returning && (
          <button type="button" className={outline} onClick={() => setReturning(false)} disabled={busy}>ยกเลิก</button>
        )}
        {!approved && canApprove && !returning && (
          <button type="button" className={navy} disabled={busy} onClick={() => run(() => decideRunAction({ runId, outcome: "approve", note: "" }))}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} อนุมัติจ่าย {fmtBaht(net)}
          </button>
        )}
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}

/** บันทึกการชำระเงินเดือน (แบบหน้าต่าง "บันทึกการชำระเงินเดือน" ของ FlowAccount) */
export function PayDialog({
  runId,
  period,
  payDate,
  people,
  transferNet,
  cashNet,
  rows,
}: {
  runId: string;
  period: string;
  payDate: string;
  people: number;
  transferNet: number;
  cashNet: number;
  rows: { name: string; channel: string; net: number }[];
}) {
  const [open, setOpen] = useState(false);
  const [paidOn, setPaidOn] = useState(payDate);
  const [fee, setFee] = useState("0");
  const { busy, error, run } = useRun();
  if (!open) {
    return (
      <button type="button" className={navy} onClick={() => setOpen(true)}>
        บันทึกการจ่ายเงินเดือน
      </button>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="บันทึกการชำระเงินเดือน">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-t-(--radius-lg) bg-(--bg) p-5 sm:rounded-(--radius-lg)">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-(--ink)">บันทึกการชำระเงินเดือน</h2>
            <p className={hint}>{period}</p>
          </div>
          <div className="text-right">
            <div className="text-xs text-(--ink-soft)">{people} คน · ยอดรวมจ่ายสุทธิ</div>
            <div className="text-2xl font-bold tabular-nums text-(--ink)">{fmtBaht(transferNet + cashNet)}</div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={label}>
            <span className={labelText}>วันที่ชำระ (วันที่โอนจริง)</span>
            <input type="date" className={field} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </label>
          <label className={label}>
            <span className={labelText}>ค่าธรรมเนียมโอน (บริษัทจ่าย)</span>
            <input inputMode="decimal" className={field} value={fee} onChange={(e) => setFee(e.target.value)} />
          </label>
        </div>
        <div className="rounded-(--radius) border border-(--line) p-3 text-sm">
          <div className="flex justify-between"><span>โอนเข้าบัญชี</span><span className="font-semibold tabular-nums">{fmtBaht(transferNet)}</span></div>
          <div className="mt-1 flex justify-between"><span>เงินสด</span><span className="font-semibold tabular-nums">{fmtBaht(cashNet)}</span></div>
        </div>
        <div className="max-h-56 overflow-y-auto rounded-(--radius) border border-(--line)">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-(--bg-soft) text-left text-xs text-(--ink-soft)">
              <tr><th className="px-3 py-2">ชื่อ</th><th className="px-3 py-2">ช่องทาง</th><th className="px-3 py-2 text-right">ยอดจ่ายสุทธิ</th></tr>
            </thead>
            <tbody className="divide-y divide-(--line)">
              {rows.map((r, i) => (
                <tr key={i}><td className="px-3 py-1.5">{r.name}</td><td className="px-3 py-1.5 text-xs text-(--ink-soft)">{r.channel}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmtBaht(r.net)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <Notice tone="warn">
          กดยืนยันเมื่อโอนเงินเสร็จแล้วจริง — รอบจะล็อกถาวร พนักงานได้สลิปในแอป ใบ OT/เบิกล่วงหน้าในรอบถูกปิด (ถ้าผิดภายหลัง แก้ในงวดถัดไปด้วยรายการ &quot;ปรับปรุงงวดก่อน&quot;)
        </Notice>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" className={outline} onClick={() => setOpen(false)} disabled={busy}>ยกเลิก</button>
          <button type="button" className={navy} disabled={busy || !paidOn} onClick={() => run(() => markPaidAction({ runId, paidOn, bankFee: Number(fee.replace(/,/g, "") || 0) }), () => setOpen(false))}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} ยืนยันการจ่ายเงินเดือน
          </button>
        </div>
        <p className={hint}>วันที่จ่ายตามงวด: {thaiDate(payDate)}</p>
      </div>
    </div>
  );
}

export function RunNote({ runId, note, editable }: { runId: string; note: string; editable: boolean }) {
  const [v, setV] = useState(note);
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useRun();
  if (!editable) return note ? <p className="whitespace-pre-line text-sm text-(--ink)">{note}</p> : <p className={hint}>—</p>;
  if (!editing) {
    return (
      <div className="flex flex-col gap-1">
        {note ? <p className="whitespace-pre-line text-sm text-(--ink)">{note}</p> : <p className={hint}>ยังไม่มีโน้ต</p>}
        <button type="button" className="self-start text-sm font-semibold text-(--app-strong) underline" onClick={() => setEditing(true)}>
          {note ? "แก้โน้ต" : "+ เพิ่มโน้ต"}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <textarea className={`${field} h-auto py-2`} rows={3} value={v} onChange={(e) => setV(e.target.value)} />
      <div className="flex gap-2">
        <button type="button" className={outline} onClick={() => setEditing(false)} disabled={busy}>ยกเลิก</button>
        <button type="button" className={navy} disabled={busy} onClick={() => run(() => runNoteAction({ runId, note: v }), () => setEditing(false))}>บันทึกโน้ต</button>
      </div>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
