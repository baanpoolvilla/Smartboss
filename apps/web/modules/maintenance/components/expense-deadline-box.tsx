"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarClock, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { todayBangkok } from "@/modules/maintenance/lib/no-past-date";
import { expenseDaysLabel } from "@/modules/maintenance/lib/expense-deadline";
import {
  cancelExpenseExtensionAction,
  decideExpenseExtensionAction,
  requestExpenseExtensionAction,
} from "@/app/(shell)/maintenance/work-orders/expense-deadline-actions";

import { useCeoTitle } from "@/lib/ceo-title-client";
export interface ExpenseRequestView {
  id: string;
  requestedBy: string;
  requestedByName: string;
  newDate: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decidedByName: string | null;
  decisionNote: string | null;
}

/** YYYY-MM-DD → "18 ต.ค. 2569" */
function th(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
const addDay = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/**
 * กล่อง "รอบันทึกค่าใช้จ่าย" บนหน้าใบงาน — สิ้นสุดเมื่อไร เหลือกี่วัน ปุ่มบันทึก ขอเลื่อน (ผู้บันทึก) อนุมัติ (CEO)
 * ดู lib/expense-deadline.ts · ขอเลื่อนคนละเรื่องกับกำหนดส่งใบงาน (work-order-due-request.tsx)
 */
export function ExpenseDeadlineBox({
  workOrderId,
  dueDate,
  daysLeft,
  closedLabel,
  recordHref,
  canRequest,
  canDecide,
  myId,
  noDock,
  requests,
}: {
  workOrderId: string;
  /** YYYY-MM-DD เวลาไทย */
  dueDate: string;
  daysLeft: number;
  closedLabel: string;
  /** null = ไม่มีสิทธิ์บันทึก */
  recordHref: string | null;
  canRequest: boolean;
  canDecide: boolean;
  myId: string;
  /** ของค้างเก่า ไม่หักคะแนน */
  noDock: boolean;
  requests: ExpenseRequestView[];
}) {
  const ceo = useCeoTitle();
  const [asking, setAsking] = useState(false);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, start] = useTransition();
  const pending = requests.find((r) => r.status === "pending");
  const latest = requests.find((r) => r.status === "approved" || r.status === "rejected");
  const late = daysLeft < 0;
  const today = todayBangkok();
  const minDate = addDay(dueDate > today ? dueDate : today, dueDate >= today ? 1 : 0);

  const run = (fn: () => Promise<{ error?: string }>, ok: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast.error(r.error);
      else {
        toast.success(ok);
        after?.();
      }
    });

  return (
    <div className={`mb-4 rounded-xl border p-4 ${late ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`} data-testid="expense-deadline">
      <div className="flex flex-wrap items-start gap-3">
        <ReceiptText className={`mt-0.5 h-5 w-5 shrink-0 ${late ? "text-red-600" : "text-amber-700"}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-(--ink)">รอบันทึกค่าใช้จ่าย</p>
          <p className="mt-0.5 text-sm text-(--ink)">
            ปิดงาน {closedLabel} · สิ้นสุดการบันทึก <b>{th(dueDate)}</b> ·{" "}
            <b className={late ? "text-red-600" : "text-amber-700"}>{expenseDaysLabel(daysLeft)}</b>
          </p>
          {noDock && <p className="mt-0.5 text-xs text-(--ink-soft)">ใบค้างจากก่อนเริ่มใช้ระบบ ไม่หักคะแนน</p>}
          {!noDock && late && <p className="mt-0.5 text-xs text-red-700">เลยกำหนดแล้วระบบหักคะแนนผู้บันทึก บันทึกให้เร็วที่สุด</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canRequest && !pending && (
            <button type="button" onClick={() => setAsking((v) => !v)} className="inline-flex h-9 items-center gap-1.5 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm font-medium text-(--ink) hover:bg-(--bg-soft)">
              <CalendarClock className="h-4 w-4" /> ขอเลื่อน
            </button>
          )}
          {recordHref && (
            <Link href={recordHref} className="inline-flex h-9 items-center gap-1.5 rounded-(--radius) bg-[#2E7D32] px-3 text-sm font-medium text-white hover:brightness-95">
              <ReceiptText className="h-4 w-4" /> บันทึกค่าใช้จ่าย
            </Link>
          )}
        </div>
      </div>

      {asking && canRequest && !pending && (
        <div className="mt-3 flex flex-col gap-2 rounded-(--radius) border border-(--line) bg-(--bg) p-3">
          <p className="text-xs text-(--ink-soft)">ส่งให้ {ceo} อนุมัติ · ถ้าเลยกำหนดไปก่อนอนุมัติ ระบบหักคะแนนตามปกติ</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-(--ink)">ขอเลื่อนเป็นวันที่</span>
            <DatePickerField value={date} minDate={minDate} onChange={setDate} className="h-9 max-w-56 text-(--ink)" />
          </div>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            aria-label="เหตุผลที่ขอเลื่อน"
            placeholder="เหตุผล เช่น รอใบเสร็จจากร้าน"
            className="w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink)"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => requestExpenseExtensionAction(workOrderId, date, reason), `ส่งคำขอให้ ${ceo} แล้ว`, () => { setAsking(false); setDate(""); setReason(""); })}
              className="h-9 rounded-(--radius) bg-[#0F766E] px-4 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50"
            >
              ส่งคำขอ
            </button>
            <button type="button" onClick={() => setAsking(false)} className="h-9 rounded-(--radius) px-3 text-sm text-(--ink-soft) hover:bg-(--bg-soft)">
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {pending && (
        <div className="mt-3 rounded-(--radius) border border-(--line) bg-(--bg) p-3 text-sm text-(--ink)">
          <p>
            <b>{pending.requestedByName}</b> ขอเลื่อนเป็น <b>{th(pending.newDate)}</b> · รอ {ceo} อนุมัติ
          </p>
          <p className="mt-0.5 text-(--ink-soft)">เหตุผล: {pending.reason}</p>
          {canDecide && pending.requestedBy !== myId && (
            <div className="mt-2 flex flex-col gap-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                aria-label="หมายเหตุการอนุมัติ"
                placeholder="หมายเหตุ (ไม่อนุมัติต้องใส่)"
                className="h-9 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)"
              />
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => run(() => decideExpenseExtensionAction(pending.id, true, note), "อนุมัติแล้ว", () => setNote(""))} className="h-9 rounded-(--radius) bg-[#2E7D32] px-4 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">
                  อนุมัติ
                </button>
                <button type="button" disabled={busy} onClick={() => run(() => decideExpenseExtensionAction(pending.id, false, note), "ไม่อนุมัติแล้ว", () => setNote(""))} className="h-9 rounded-(--radius) border border-red-300 px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                  ไม่อนุมัติ
                </button>
              </div>
            </div>
          )}
          {pending.requestedBy === myId && (
            <button type="button" disabled={busy} onClick={() => run(() => cancelExpenseExtensionAction(pending.id), "ยกเลิกคำขอแล้ว")} className="mt-2 text-xs text-(--ink-soft) underline disabled:opacity-50">
              ยกเลิกคำขอ
            </button>
          )}
        </div>
      )}

      {!pending && latest && (
        <p className="mt-2 text-xs text-(--ink-soft)">
          {latest.status === "approved" ? "อนุมัติเลื่อนเป็น" : "ไม่อนุมัติเลื่อนเป็น"} {th(latest.newDate)} โดย {latest.decidedByName ?? "-"}
          {latest.decisionNote ? ` · ${latest.decisionNote}` : ""}
        </p>
      )}
    </div>
  );
}
