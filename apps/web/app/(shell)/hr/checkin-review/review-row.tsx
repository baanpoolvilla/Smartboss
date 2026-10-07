"use client";

import { useState, useTransition } from "react";
import { Button } from "@smartboss/ui/components/button";
import { inputClass } from "@/modules/hr/components/ui";
import { reviewCheckinAction } from "./actions";

/**
 * ปุ่มจัดการรายการลงเวลาผิดปกติหนึ่งแถว
 *
 * - `counted` (นับเวลาไปแล้ว — ACCEPTED_WITH_WARNING): "ปกติ (ถามแล้ว)" = เก็บเรื่อง เวลายังนับ ·
 *   "ไม่นับรายการนี้" = เหมือนไม่เคยลงเวลาครั้งนั้น
 * - `pending` (นโยบายเก่า ค้างรออนุมัติ): "อนุมัติ นับเวลา" / "ไม่นับรายการนี้"
 *
 * ⚠ "ไม่นับ" กระทบคะแนน — ระบบคำนวณผลลงเวลาวันนั้นใหม่ วันนั้นอาจกลายเป็นสาย / ลืมลงเวลา / ขาดงาน
 * แล้วรอบหักคะแนนเช้าถัดไป (cron 08:00 lib/attendance-performance.ts) หักตามกติกาของบริษัท
 * และกดแล้วย้อนกลับไม่ได้ (ระบบบุคคลตรวจได้ครั้งเดียว) — แก้คืนได้ทางเดียวคือให้พนักงานยื่นขอแก้เวลา
 * ⇒ ต้องยืนยันพร้อมเหตุผลทุกครั้ง และบอกผลให้ชัดก่อนกด
 */
export function ReviewButtons({
  id,
  employmentId,
  at,
  mode,
}: {
  id: string;
  employmentId: string;
  at: string;
  mode: "counted" | "pending";
}) {
  const [busy, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(outcome: "APPROVED" | "REJECTED") {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("outcome", outcome);
    fd.set("employmentId", employmentId);
    fd.set("at", at);
    fd.set("reason", reason);
    setError(null);
    start(async () => {
      const result = await reviewCheckinAction(fd);
      if (result.error) setError(result.error);
    });
  }

  if (rejecting) {
    return (
      <div className="flex w-full flex-col gap-2 rounded-(--radius) border border-(--danger)/40 bg-(--danger)/5 p-3 sm:w-80">
        <p className="text-xs font-semibold text-(--danger)">ไม่นับการลงเวลาครั้งนี้?</p>
        <p className="text-xs text-(--ink-soft)">
          เหมือนไม่เคยลงเวลาครั้งนี้ — วันนั้นอาจกลายเป็น <b>สาย / ลืมลงเวลา / ขาดงาน</b> และ
          <b> หักคะแนนผลงาน</b>ในรอบเช้าถัดไป · กดแล้วย้อนกลับไม่ได้ (แก้คืนได้ด้วยการยื่นขอแก้เวลา)
        </p>
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="เหตุผล เช่น ถามแล้ว ฝากเพื่อนกดแทน"
          className={`${inputClass} h-9 text-xs`}
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting(false)}>
            ยกเลิก
          </Button>
          <Button size="sm" variant="danger" disabled={busy || reason.trim() === ""} onClick={() => submit("REJECTED")}>
            {busy ? "กำลังบันทึก…" : "ยืนยัน ไม่นับ"}
          </Button>
        </div>
        {error && <p className="text-xs text-(--danger)">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
          ไม่นับรายการนี้
        </Button>
        <Button size="sm" disabled={busy} onClick={() => submit("APPROVED")}>
          {busy ? "กำลังบันทึก…" : mode === "counted" ? "ปกติ (ถามแล้ว)" : "อนุมัติ นับเวลา"}
        </Button>
      </div>
      {error && <p className="text-xs text-(--danger)">{error}</p>}
    </div>
  );
}
