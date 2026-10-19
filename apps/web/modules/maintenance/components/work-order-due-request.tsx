"use client";

import { useState, useTransition } from "react";
import { CalendarClock, Pencil } from "lucide-react";
import { toast } from "sonner";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { todayBangkok } from "@/modules/maintenance/lib/no-past-date";
import {
  cancelDueRequestAction,
  decideDueRequestAction,
  editDueDateAction,
  requestDueDateAction,
} from "@/app/(shell)/maintenance/work-orders/due-request-actions";

export interface DueRequestView {
  id: string;
  requestedBy: string;
  requestedByName: string;
  previousDate: string | null;
  newDate: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decidedByName: string | null;
  decisionNote: string | null;
  createdAt: string;
  /** คนที่ดูอยู่อนุมัติคำขอนี้ได้ไหม (คำนวณที่ server) */
  canDecide: boolean;
}

/** YYYY-MM-DD → "18 ต.ค. 2569" */
function th(ymd: string | null): string {
  if (!ymd) return "-";
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
const addDay = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/**
 * ขอเลื่อนกำหนดส่งใบงาน (แบบเดียวกับงานบนบอร์ดงาน) — ใต้แถว "กำหนดส่ง" ในหน้ารายละเอียดใบงาน
 * ผู้รับผิดชอบ: ปุ่ม "ขอเลื่อนกำหนดส่ง" → เลือกวันใหม่ + เหตุผล · ยกเลิกคำขอได้
 * CEO / คนเปิดใบงาน: เห็นคำขอที่รออนุมัติ พร้อมปุ่มอนุมัติ / ไม่อนุมัติ (ใส่หมายเหตุได้)
 *   + ปุ่ม "แก้" กำหนดส่งตรง ๆ (เลื่อนออก/เข้าได้ ไม่ก่อนวันนี้) — ผู้ใช้ขอ 19/10/2569
 */
export function WorkOrderDueRequest({
  workOrderId,
  dueDate,
  canRequest,
  canEdit = false,
  myId,
  requests,
}: {
  workOrderId: string;
  /** กำหนดส่งปัจจุบัน YYYY-MM-DD (เวลาไทย) */
  dueDate: string;
  canRequest: boolean;
  /** CEO / คนเปิดใบงาน แก้กำหนดส่งเองได้เลย (คำนวณที่ server) */
  canEdit?: boolean;
  myId: string;
  requests: DueRequestView[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const today = todayBangkok();
  const [editDate, setEditDate] = useState(dueDate < today ? today : dueDate);
  const [editReason, setEditReason] = useState("");
  const [date, setDate] = useState(addDay(dueDate, 3));
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const pendingReq = requests.find((r) => r.status === "pending");
  const history = requests.filter((r) => r.status === "approved" || r.status === "rejected").slice(0, 3);

  const run = (fn: () => Promise<{ error?: string }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else toast.success(ok);
    });

  return (
    <div className="grid gap-2">
      {canEdit && !editing && (
        <button type="button" onClick={() => setEditing(true)}
          className="inline-flex w-max items-center gap-1.5 rounded-lg border border-(--line) bg-white px-3 py-1.5 text-[13px] font-semibold text-(--ink) hover:bg-(--bg-soft)">
          <Pencil className="h-4 w-4" /> แก้กำหนดส่ง
        </button>
      )}

      {editing && (
        <div className="grid gap-2 rounded-xl border border-(--line) bg-(--bg-soft) p-3">
          <b className="text-[13.5px]">แก้กำหนดส่ง</b>
          <label className="grid gap-1 text-[12.5px] text-(--ink-soft)">
            กำหนดส่งใหม่ (ไม่ก่อนวันนี้)
            <DatePickerField value={editDate} minDate={today} onChange={(v) => v && setEditDate(v)} className="text-(--ink)" />
          </label>
          <label className="grid gap-1 text-[12.5px] text-(--ink-soft)">
            เหตุผล (ไม่บังคับ)
            <textarea value={editReason} onChange={(e) => setEditReason(e.target.value)} rows={2}
              className="w-full rounded-lg border border-(--line) bg-white px-2.5 py-1.5 text-base text-(--ink) sm:text-sm" />
          </label>
          {pendingReq && <p className="m-0 text-[12px] text-amber-800">คำขอเลื่อนที่รออนุมัติอยู่จะถูกปิดไปด้วย</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="rounded-lg px-3 py-1.5 text-[13px] text-(--ink-soft)" onClick={() => setEditing(false)}>ยกเลิก</button>
            <button type="button" disabled={pending || editDate < today || editDate === dueDate}
              className="rounded-lg bg-[#2E7D32] px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
              onClick={() => run(async () => { const r = await editDueDateAction(workOrderId, editDate, editReason); if (!r.error) { setEditing(false); setEditReason(""); } return r; }, `แก้กำหนดส่งแล้ว · ${th(editDate)}`)}>
              บันทึก
            </button>
          </div>
        </div>
      )}

      {canRequest && !canEdit && !pendingReq && !open && (
        <button type="button" onClick={() => setOpen(true)}
          className="inline-flex w-max items-center gap-1.5 rounded-lg border border-(--line) bg-white px-3 py-1.5 text-[13px] font-semibold text-(--ink) hover:bg-(--bg-soft)">
          <CalendarClock className="h-4 w-4" /> ขอเลื่อนกำหนดส่ง
        </button>
      )}

      {open && (
        <div className="grid gap-2 rounded-xl border border-(--line) bg-(--bg-soft) p-3">
          <b className="text-[13.5px]">ขอเลื่อนกำหนดส่ง</b>
          <label className="grid gap-1 text-[12.5px] text-(--ink-soft)">
            กำหนดส่งใหม่ (ต้องหลัง {th(dueDate)})
            <DatePickerField value={date} minDate={addDay(dueDate, 1)} onChange={(v) => v && setDate(v)} className="text-(--ink)" />
          </label>
          <label className="grid gap-1 text-[12.5px] text-(--ink-soft)">
            เหตุผล (เช่น รออะไหล่ ช่างภายนอกยังไม่ว่าง ลูกค้าเข้าพัก)
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              className="w-full rounded-lg border border-(--line) bg-white px-2.5 py-1.5 text-base text-(--ink) sm:text-sm" />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="rounded-lg px-3 py-1.5 text-[13px] text-(--ink-soft)" onClick={() => setOpen(false)}>ยกเลิก</button>
            <button type="button" disabled={pending || !reason.trim() || date <= dueDate}
              className="rounded-lg bg-[#2E7D32] px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
              onClick={() => run(async () => { const r = await requestDueDateAction(workOrderId, date, reason); if (!r.error) { setOpen(false); setReason(""); } return r; }, "ส่งคำขอแล้ว · รอ CEO / คนเปิดใบงานอนุมัติ")}>
              ส่งคำขอ
            </button>
          </div>
        </div>
      )}

      {pendingReq && (
        <div className="grid gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11.5px] font-bold text-amber-900">รออนุมัติ</span>
            <span><b>{pendingReq.requestedByName}</b> ขอเลื่อน {th(pendingReq.previousDate)} → <b>{th(pendingReq.newDate)}</b></span>
          </div>
          <p className="m-0 text-(--ink)">เหตุผล: {pendingReq.reason}</p>
          {pendingReq.canDecide && (
            <div className="grid gap-2">
              <input value={notes[pendingReq.id] ?? ""} onChange={(e) => setNotes({ ...notes, [pendingReq.id]: e.target.value })} placeholder="หมายเหตุ (ไม่บังคับ)"
                className="w-full rounded-lg border border-(--line) bg-white px-2.5 py-1.5 text-base text-(--ink) sm:text-sm" />
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" disabled={pending} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 font-semibold text-red-700 disabled:opacity-50"
                  onClick={() => run(() => decideDueRequestAction(pendingReq.id, false, notes[pendingReq.id] ?? ""), "ไม่อนุมัติแล้ว · แจ้งคนขอแล้ว")}>
                  ไม่อนุมัติ
                </button>
                <button type="button" disabled={pending} className="rounded-lg bg-[#2E7D32] px-4 py-1.5 font-semibold text-white disabled:opacity-50"
                  onClick={() => run(() => decideDueRequestAction(pendingReq.id, true, notes[pendingReq.id] ?? ""), `อนุมัติแล้ว · กำหนดส่งใหม่ ${th(pendingReq.newDate)}`)}>
                  อนุมัติ
                </button>
              </div>
            </div>
          )}
          {pendingReq.requestedBy === myId && (
            <button type="button" disabled={pending} className="justify-self-end rounded-lg px-2 py-1 text-[12.5px] text-(--ink-soft) hover:underline"
              onClick={() => run(() => cancelDueRequestAction(pendingReq.id), "ยกเลิกคำขอแล้ว")}>
              ยกเลิกคำขอ
            </button>
          )}
          {!pendingReq.canDecide && pendingReq.requestedBy !== myId && <span className="text-[12px] text-(--ink-soft)">รอ CEO หรือคนเปิดใบงานอนุมัติ</span>}
        </div>
      )}

      {history.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 text-[12.5px] text-(--ink-soft)">
          <span className={r.status === "approved" ? "rounded-full bg-green-100 px-2 py-0.5 font-bold text-green-800" : "rounded-full bg-red-100 px-2 py-0.5 font-bold text-red-700"}>
            {r.status === "approved" ? "อนุมัติแล้ว" : "ไม่อนุมัติ"}
          </span>
          <span>{r.requestedByName} ขอ {th(r.previousDate)} → {th(r.newDate)}{r.decidedByName ? ` · โดย ${r.decidedByName}` : ""}{r.decisionNote ? ` · ${r.decisionNote}` : ""}</span>
        </div>
      ))}
    </div>
  );
}
