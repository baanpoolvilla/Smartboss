"use client";

import { useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { Field, Pill, inputClass } from "@/modules/hr/components/ui";
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
            {correction.work_date} · {INTENT_LABEL[correction.event_intent ?? ""] ?? correction.adjustment_type}
            {correction.punch_at &&
              ` เวลา ${new Date(correction.punch_at).toLocaleTimeString("th-TH", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Bangkok",
              })}`}
          </p>
        </div>
        <StageBadge stage={correction.approval_stage} />
      </div>

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
          <Button type="button" variant="ghost" onClick={() => setShowApprove((v) => !v)}>
            อนุมัติ
          </Button>
          <Button type="button" variant="ghost" onClick={() => setShowReject((v) => !v)}>
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
          <Button type="submit" variant="ghost" className="shrink-0">
            ยืนยันปฏิเสธ
          </Button>
        </form>
      )}
    </div>
  );
}
