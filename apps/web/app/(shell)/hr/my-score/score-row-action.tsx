"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smartboss/ui/components/button";

import { Modal } from "@/components/module/dialog";
import { ManualAttendanceForm } from "@/app/(shell)/hr/attendance/corrections/correction-forms";
import { PenaltyRequestDialog, type PenaltyEventItem } from "@/app/(shell)/hr/employees/penalty-request-chip";
import { createScoreRequestAction } from "./score-request-actions";

/**
 * ปุ่ม "ขอแก้ไข" + สถานะ ใต้แต่ละรายการที่โดนหักในหน้า "คะแนนของฉัน" (ผู้ใช้ขอ 21/10/2569)
 * ปุ่มเดียวกันทุกหมวด แต่เปิดฟอร์มที่ถูกต้องของเรื่องนั้น — พนักงานไม่ต้องรู้ว่าไปยื่นที่ไหน:
 *   - มาสาย/ขาดงาน → ฟอร์มขอแก้เวลาตัวเดิม (HR/CEO อนุมัติ 2 คน · อนุมัติแล้วระบบคืนคะแนนเอง)
 *   - รายงาน → คำร้องขอแก้ไขคะแนนตัวเดิม (CEO)
 *   - งาน/ใบงาน/PM เลยกำหนด → คำขอแก้คะแนน (เจ้าของเรื่อง หรือ CEO) — lib/score-requests.ts
 */

export type RowTone = "wait" | "ok" | "no" | "lock";

export type RowOpen =
  | {
      kind: "score";
      eventId: string;
      label: string;
      title: string;
      points: number;
      day: string;
      approverText: string;
      reasonTags: string[];
    }
  | { kind: "report"; userId: string; category: "report_missed" | "report_late"; categoryLabel: string; item: PenaltyEventItem }
  | { kind: "attendance"; employmentId: string; day: string; intent: "CLOCK_IN" | "CLOCK_OUT"; label: string; points: number };

export interface RowActionSpec {
  status?: { tone: RowTone; text: string; sub?: string };
  open?: RowOpen;
  /** "ขอได้ถึง 25 ต.ค. 23:59" */
  deadline?: string;
}

const TONE: Record<RowTone, string> = {
  wait: "bg-amber-50 text-amber-800 ring-amber-200",
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  no: "bg-red-50 text-red-700 ring-red-200",
  lock: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function ScoreRowAction({ spec }: { spec: RowActionSpec }) {
  // เก็บสเปกของหน้าต่างไว้เอง — ส่งแล้วหน้ารีเฟรช แถวนี้กลายเป็น "รอพิจารณา" (spec.open หาย)
  // ถ้าอิง spec.open ตรง ๆ หน้าต่าง "ส่งคำขอแล้ว" จะปิดเองก่อนผู้ใช้ทันเห็น
  const [dialog, setDialog] = useState<RowOpen | null>(null);
  const [deadline, setDeadline] = useState<string | undefined>(undefined);
  const router = useRouter();
  const close = () => {
    setDialog(null);
    router.refresh();
  };

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      {spec.status && (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONE[spec.status.tone]}`}>
          {spec.status.text}
        </span>
      )}
      {spec.status?.sub && <span className="text-[11.5px] text-(--ink-soft)">{spec.status.sub}</span>}
      {spec.open && (
        <button
          type="button"
          onClick={() => {
            setDialog(spec.open ?? null);
            setDeadline(spec.deadline);
          }}
          className="inline-flex h-7 items-center rounded-full border border-(--brand-navy) bg-white px-3 text-xs font-semibold text-(--brand-navy) transition-colors hover:bg-[#dde3ee] active:scale-[0.97]"
        >
          ขอแก้ไข
        </button>
      )}
      {spec.open && spec.deadline && <span className="text-[11.5px] text-(--ink-soft)">{spec.deadline}</span>}

      {dialog?.kind === "score" && <ScoreRequestDialog spec={dialog} deadline={deadline} onClose={close} />}
      {dialog?.kind === "report" && (
        <PenaltyRequestDialog
          userId={dialog.userId}
          category={dialog.category}
          categoryLabel={dialog.categoryLabel}
          fixedItem={dialog.item}
          onClose={close}
        />
      )}
      {dialog?.kind === "attendance" && (
        <Modal title="ขอแก้เวลาเข้า-ออก" onClose={() => setDialog(null)} wide>
          <div className="flex flex-col gap-3">
            <WhatBox label={dialog.label} points={dialog.points} sub={`${dialog.day} · ใช้ฟอร์มเดียวกับหน้า "ลงเวลา"`} />
            <p className="rounded-(--radius) bg-[#eef3ff] px-3 py-2 text-xs text-[#1e3a8a]">
              ส่งให้ HR / CEO อนุมัติ (2 คน ต้องเป็นคนละคน) · อนุมัติแล้วระบบคิดวันนั้นใหม่และคืนคะแนนให้เอง
              {deadline ? ` · ต้องอนุมัติ${deadline.replace("ขอได้", "")} ถึงจะคืนคะแนนรอบนี้` : ""}
            </p>
            <ManualAttendanceForm
              employees={[]}
              selfEmploymentId={dialog.employmentId}
              initialDate={dialog.day}
              initialIntent={dialog.intent}
              onSubmitted={close}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

function WhatBox({ label, points, sub }: { label: string; points: number; sub: string }) {
  return (
    <div className="rounded-(--radius) border border-(--line) bg-(--bg-soft) px-3 py-2 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-(--ink)">{label}</span>
        <span className="font-semibold tabular-nums" style={{ color: "var(--danger)" }}>
          {points}
        </span>
      </div>
      <div className="text-xs text-(--ink-soft)">{sub}</div>
    </div>
  );
}

function ScoreRequestDialog({
  spec,
  deadline,
  onClose,
}: {
  spec: Extract<RowOpen, { kind: "score" }>;
  deadline?: string;
  onClose: () => void;
}) {
  const [tag, setTag] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const ready = !!tag && reason.trim().length >= 3;

  function submit() {
    setError(null);
    start(async () => {
      const r = await createScoreRequestAction({ eventId: spec.eventId, reasonTag: tag, reason });
      if (r.error) setError(r.error);
      else setDone(true);
    });
  }

  if (done) {
    return (
      <Modal title="ส่งคำขอแล้ว" onClose={onClose} actions={<Button onClick={onClose}>ปิด</Button>}>
        <p className="text-sm text-(--ink)">
          ส่งให้ {spec.approverText} พิจารณาแล้ว — คะแนนยังไม่เปลี่ยนจนกว่าจะได้รับอนุมัติ ติดตามสถานะได้ที่แถวนี้
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title={`ขอแก้คะแนน — ${spec.label}`}
      onClose={onClose}
      actions={
        <>
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={submit} disabled={!ready || pending}>
            {pending ? "กำลังส่ง..." : "ส่งคำขอ"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <WhatBox label={spec.title} points={spec.points} sub={`${spec.label} · ${spec.day}`} />
        <p className="rounded-(--radius) bg-[#eef3ff] px-3 py-2 text-xs text-[#1e3a8a]">
          ส่งให้ <b>{spec.approverText}</b> พิจารณา · อนุมัติแล้วคืนคะแนนทันที และบันทึกเหตุผลไว้ในประวัติ
        </p>
        <div>
          <div className="mb-1.5 text-sm font-medium text-(--ink)">เหตุผล (เหตุสุดวิสัย)</div>
          <div className="flex flex-wrap gap-1.5">
            {spec.reasonTags.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tag === t}
                onClick={() => setTag(t)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  tag === t
                    ? "border-(--brand-navy) bg-[#dde3ee] font-semibold text-(--brand-navy)"
                    : "border-(--line) bg-white text-(--ink) hover:bg-(--bg-soft)"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-(--ink)">รายละเอียด</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            className="rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink) focus-visible:border-(--brand-navy) focus-visible:outline-hidden"
            placeholder="เช่น ร้านส่งท่อช้า 3 วัน มีแชทกับร้านยืนยัน"
          />
        </label>
        <p className="text-xs text-(--ink-soft)">
          {deadline ? `ต้องอนุมัติ${deadline.replace("ขอได้", "")} ถึงจะคืนคะแนนรอบนี้ · ` : ""}
          ยังไม่เลยกำหนด ให้ใช้ &quot;ขอเลื่อนกำหนดส่ง&quot; แทน (ไม่โดนหักเลย)
        </p>
        {error && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
