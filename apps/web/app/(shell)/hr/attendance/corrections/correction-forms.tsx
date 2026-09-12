"use client";

import { useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { Field, Pill, inputClass } from "@/modules/hr/components/ui";
import { formatDate, formatTime } from "@/modules/hr/lib/labels";
import type { AttendanceCorrection, Employment } from "@/modules/hr/lib/api";
import {
  approveAttendanceCorrectionAction,
  rejectAttendanceCorrectionAction,
  requestManualAttendanceAction,
} from "../../actions";

const STAGE_LABEL: Record<AttendanceCorrection["approval_stage"], { text: string; tone: string }> = {
  AWAITING_FIRST_APPROVAL: { text: "รอผู้จัดการคนที่ 1", tone: "var(--tone-warn)" },
  AWAITING_SECOND_APPROVAL: { text: "รอผู้จัดการคนที่ 2 (ต้องคนละคนกับคนแรก)", tone: "var(--tone-warn)" },
  APPROVED: { text: "อนุมัติครบแล้ว", tone: "var(--tone-ok)" },
  REJECTED: { text: "ถูกปฏิเสธ", tone: "var(--tone-danger)" },
  CANCELLED: { text: "ยกเลิก", tone: "var(--tone-muted)" },
};

const INTENT_LABEL: Record<string, string> = {
  CLOCK_IN: "เข้างาน",
  CLOCK_OUT: "ออกงาน",
};

export function StageBadge({ stage }: { stage: AttendanceCorrection["approval_stage"] }) {
  const { text, tone } = STAGE_LABEL[stage];
  return <Pill tone={tone}>{text}</Pill>;
}

/**
 * แถบขั้นตอนอนุมัติ — ผู้ขอ → อนุมัติคนที่ 1 → อนุมัติคนที่ 2 เห็นความคืบหน้า
 * เป็นภาพแทนข้อความ "ยังไม่มี" ที่อ่านแล้วไม่รู้ว่าใกล้เสร็จแค่ไหน (สเปคข้อ 4.2)
 */
function ApprovalStepper({ correction }: { correction: AttendanceCorrection }) {
  const rejected = correction.status === "REJECTED" || correction.status === "CANCELLED";
  const step =
    correction.approval_stage === "AWAITING_FIRST_APPROVAL"
      ? 0
      : correction.approval_stage === "AWAITING_SECOND_APPROVAL"
        ? 1
        : 2;
  const dots: { label: string; done: boolean }[] = [
    { label: "ผู้ขอ", done: true },
    { label: "อนุมัติ 1", done: step >= 1 },
    { label: "อนุมัติ 2", done: step >= 2 && !rejected },
  ];
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      {dots.map((d, i) => (
        <span key={d.label} className="flex items-center gap-1.5">
          <span className="flex items-center gap-1">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor: rejected && i === dots.length - 1
                  ? "var(--tone-danger)"
                  : d.done
                    ? "var(--tone-ok)"
                    : "var(--line)",
              }}
            />
            <span className={d.done ? "text-(--ink)" : "text-(--ink-faint,var(--ink-soft))"}>
              {d.label}
            </span>
          </span>
          {i < dots.length - 1 && <span className="h-px w-4 bg-(--line)" aria-hidden />}
        </span>
      ))}
    </div>
  );
}

/**
 * สรุปเดิม/ใหม่แบบตรงไปตรงมา — แสดงเฉพาะสิ่งที่ API ให้มาจริง ไม่เดา/ไม่แต่งค่า
 * ผลกระทบต่อคะแนน (เช่น "+5") เพราะสูตรคะแนนเป็นค่าตั้งค่าต่อบริษัท ไม่ใช่ค่าคงที่
 * ที่หน้านี้จะรู้ล่วงหน้าได้ (ดูกฎ "ห้าม hard code" ของโปรเจกต์)
 */
function CorrectionDiff({ correction }: { correction: AttendanceCorrection }) {
  const after =
    correction.adjustment_type === "IGNORE_EVENT"
      ? "เพิกเฉยรายการสแกนนี้"
      : `${INTENT_LABEL[correction.event_intent ?? ""] ?? correction.adjustment_type}${
          correction.punch_at ? ` ${formatTime(correction.punch_at)}` : ""
        }`;
  const before = correction.adjustment_type === "ADD_PUNCH" ? "ไม่มีข้อมูล" : "มีข้อมูลเดิมอยู่แล้ว";

  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 rounded-(--radius) bg-(--bg-soft) px-3 py-2 text-xs">
      <span><span className="text-(--ink-soft)">เดิม:</span> {before}</span>
      <span><span className="text-(--ink-soft)">→ ใหม่:</span> <strong className="text-(--ink)">{after}</strong></span>
    </div>
  );
}

export function ManualAttendanceForm({ employees }: { employees: Employment[] }) {
  return (
    <form action={requestManualAttendanceAction} className="grid grid-cols-1 gap-3 sm:grid-cols-6">
      <Field label="พนักงาน *">
        <select name="employment_id" required className={inputClass}>
          <option value="">— เลือกพนักงาน —</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.employee_code} · {employee.full_name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="วันที่ *">
        <input type="date" name="work_date" required className={inputClass} />
      </Field>

      <Field label="เวลา *">
        <input type="time" name="time" required className={inputClass} />
      </Field>

      <Field label="ประเภท *">
        <select name="event_intent" required className={inputClass} defaultValue="CLOCK_IN">
          <option value="CLOCK_IN">เข้างาน</option>
          <option value="CLOCK_OUT">ออกงาน</option>
        </select>
      </Field>

      <Field label="เหตุผล *" hint="เช่น ลืมสแกน / เครื่องเสีย — ใช้เป็นหลักฐานตอนตรวจสอบ">
        <input
          name="reason"
          required
          maxLength={500}
          placeholder="ลืมสแกนตอนเข้างาน มีหัวหน้างานยืนยัน"
          className={inputClass}
        />
      </Field>

      <div className="flex items-end">
        <Button type="submit">ส่งคำขอ</Button>
      </div>

      <p className="text-xs text-(--ink-soft) sm:col-span-6">
        คำขอนี้ยังไม่มีผลทันที — ต้องมีผู้จัดการขึ้นไป <strong>สองคนที่ไม่ซ้ำกัน</strong> กดอนุมัติ
        ที่ตารางด้านล่างก่อน ระบบถึงจะคำนวณเวลาทำงานใหม่
      </p>
    </form>
  );
}

/**
 * การ์ดต่อหนึ่งคำขอ — แยกฟอร์มอนุมัติกับปฏิเสธออกจากกันเป็นคนละ `<form>`
 * (เหตุผลเดียวกับ SiteEditCard: เลี่ยงการแชร์ input ข้ามปุ่ม submit ในฟอร์มเดียว
 * ซึ่งเป็นแหล่งบั๊กที่โปรเจกต์นี้เคยเจอมาแล้ว — และเหตุผลอนุมัติ/ปฏิเสธก็เป็น
 * ข้อความคนละความหมายกันจริง ๆ ด้วย ไม่ใช่แค่กันบั๊ก)
 */
export function CorrectionCard({ correction }: { correction: AttendanceCorrection }) {
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const pending =
    correction.approval_stage === "AWAITING_FIRST_APPROVAL" ||
    correction.approval_stage === "AWAITING_SECOND_APPROVAL";

  return (
    <div className="rounded-(--radius) border border-(--line) p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-(--ink)">
            {correction.full_name}{" "}
            <span className="font-mono text-[11px] text-(--ink-soft)">
              {correction.employee_code}
            </span>
          </p>
          <p className="text-sm text-(--ink-soft)">
            {formatDate(correction.work_date)} ·{" "}
            {INTENT_LABEL[correction.event_intent ?? ""] ?? correction.adjustment_type}
            {correction.punch_at && ` เวลา ${formatTime(correction.punch_at)}`}
          </p>
        </div>
        <StageBadge stage={correction.approval_stage} />
      </div>

      <div className="mt-3">
        <ApprovalStepper correction={correction} />
      </div>

      <CorrectionDiff correction={correction} />

      <p className="mt-2 text-sm text-(--ink)">{correction.reason}</p>

      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-(--ink-soft) sm:grid-cols-3">
        <div>ผู้ขอ: {correction.requested_by_name ?? "—"}</div>
        <div>ผู้อนุมัติคนที่ 1: {correction.first_approved_by_name ?? "ยังไม่มี"}</div>
        <div>ผู้อนุมัติคนที่ 2: {correction.second_approved_by_name ?? "ยังไม่มี"}</div>
      </dl>
      {correction.status === "REJECTED" && correction.rejection_reason && (
        <p className="mt-2 text-xs text-(--tone-danger)">
          เหตุผลที่ปฏิเสธ ({correction.rejected_by_name ?? "—"}): {correction.rejection_reason}
        </p>
      )}

      {pending && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setShowApprove((v) => !v)}>
            อนุมัติ
          </Button>
          <Button type="button" variant="outline" onClick={() => setShowReject((v) => !v)}>
            ปฏิเสธ
          </Button>
        </div>
      )}

      {showApprove && (
        <form
          action={approveAttendanceCorrectionAction}
          className="mt-2 flex flex-col gap-2 rounded-(--radius) bg-(--bg-soft) p-2 sm:flex-row"
        >
          <input type="hidden" name="adjustment_id" value={correction.id} />
          <input
            name="reason"
            required
            maxLength={500}
            placeholder="เหตุผลที่อนุมัติ เช่น ตรวจสอบกับหัวหน้างานแล้ว"
            className={`${inputClass} h-9`}
          />
          <Button type="submit" className="shrink-0">
            ยืนยันอนุมัติ
          </Button>
        </form>
      )}

      {showReject && (
        <form
          action={rejectAttendanceCorrectionAction}
          className="mt-2 flex flex-col gap-2 rounded-(--radius) bg-(--bg-soft) p-2 sm:flex-row"
        >
          <input type="hidden" name="adjustment_id" value={correction.id} />
          <input
            name="reason"
            required
            maxLength={500}
            placeholder="เหตุผลที่ปฏิเสธ เช่น เวลาที่ขอไม่ตรงกับหลักฐาน"
            className={`${inputClass} h-9`}
          />
          <Button type="submit" variant="danger" className="shrink-0">
            ยืนยันปฏิเสธ
          </Button>
        </form>
      )}
    </div>
  );
}
