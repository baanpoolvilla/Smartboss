"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smartboss/ui/components/button";

/**
 * ตรวจใบแจ้งซ่อม (ผู้ใช้ 10/11/2569 "ตรวจผ่าน/ไม่ผ่านแบบ task") — กล่องในหน้าใบงาน
 *   รอตรวจ + คนเปิดใบ/บอส: ปุ่ม ผ่าน / ไม่ผ่าน (ไม่ผ่าน = เหตุผล + กำหนดส่งใหม่)
 *   รอตรวจ + คนอื่น: บอกว่ารอใครตรวจ · ผ่านแล้ว: ใครตรวจเมื่อไหร่ · ไม่ผ่าน: เหตุผล + กำหนดส่งใหม่
 */
export function WorkOrderReviewBox({
  id,
  state,
  canReview,
  reviewerName,
  reviewedByName,
  reviewedAtLabel,
  note,
  dueLabel,
  today,
  open,
  action,
}: {
  id: string;
  state: "pending" | "passed" | "failed";
  canReview: boolean;
  reviewerName: string;
  reviewedByName: string | null;
  reviewedAtLabel: string | null;
  note: string | null;
  dueLabel: string | null;
  /** YYYY-MM-DD วันนี้ (เวลาไทย) — กำหนดส่งใหม่ห้ามย้อนหลัง */
  today: string;
  /** ใบยังเปิดอยู่ (ไม่ผ่านแล้วกลับมาแก้) */
  open: boolean;
  action: (formData: FormData) => Promise<{ error?: string }>;
}) {
  const router = useRouter();
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState("");
  const [due, setDue] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = (decision: "pass" | "fail") => {
    setError(null);
    const fd = new FormData();
    fd.set("id", id);
    fd.set("decision", decision);
    if (decision === "fail") {
      fd.set("note", reason);
      fd.set("dueDate", due);
    }
    start(async () => {
      const r = await action(fd);
      if (r.error) return setError(r.error);
      setFailing(false);
      router.refresh();
    });
  };

  if (state === "passed") {
    return (
      <div className="mt-3 rounded-(--radius) border border-[#c6ead1] bg-[#effaf2] px-3 py-2 text-sm text-[#166534]" data-testid="wo-review-passed">
        ✓ <b>ผ่านการตรวจ</b>
        {reviewedByName ? ` โดย ${reviewedByName}` : ""}
        {reviewedAtLabel ? ` · ${reviewedAtLabel}` : ""}
      </div>
    );
  }
  if (state === "failed") {
    if (!open) return null;
    return (
      <div className="mt-3 rounded-(--radius) border border-[#f5c2bd] bg-[#fdecea] px-3 py-2 text-sm text-[#7a1d14]" data-testid="wo-review-failed-box">
        ↩ <b>ไม่ผ่านการตรวจ</b>
        {reviewedByName ? ` (${reviewedByName})` : ""} — {note}
        {dueLabel ? ` · กำหนดส่งใหม่ ${dueLabel}` : ""}
        <div className="mt-0.5 text-xs text-[#9b2c20]">แก้แล้วกด &quot;ยืนยันงานเสร็จ&quot; อีกครั้ง ระบบส่งให้ตรวจใหม่</div>
      </div>
    );
  }
  if (!canReview) {
    return (
      <div className="mt-3 rounded-(--radius) border border-[#c6ead1] bg-[#effaf2] px-3 py-2 text-sm text-[#166534]" data-testid="wo-review-waiting">
        ✓ ส่งงานแล้ว · รอ <b>{reviewerName}</b> ตรวจ — ยังไม่ไปขั้นบันทึกค่าใช้จ่ายจนกว่าจะผ่าน
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-2 rounded-(--radius) border-2 border-(--brand-navy,#1b2537) p-3" data-testid="wo-review-box">
      <div>
        <p className="text-sm font-bold text-(--ink)">ตรวจงานนี้</p>
        <p className="text-xs text-(--ink-soft)">ผ่าน = ส่งต่อไปบันทึกค่าใช้จ่าย · ไม่ผ่าน = ส่งกลับให้แก้ พร้อมกำหนดส่งใหม่</p>
      </div>
      {failing && (
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-(--ink)">
            เหตุผลที่ไม่ผ่าน
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="เช่น น้ำยังซึมที่ข้อต่อ ขันใหม่อีกรอบ"
              className="mt-1 block w-full rounded-md border border-(--line) bg-(--bg) px-2 py-1.5 text-sm font-normal"
              data-testid="wo-review-note"
            />
          </label>
          <label className="block text-xs font-semibold text-(--ink)">
            กำหนดส่งใหม่
            <input
              type="date"
              value={due}
              min={today}
              onChange={(e) => setDue(e.target.value)}
              className="mt-1 block w-full rounded-md border border-(--line) bg-(--bg) px-2 py-1.5 text-sm font-normal"
              data-testid="wo-review-due"
            />
          </label>
        </div>
      )}
      <div className="flex gap-2">
        {!failing && (
          <Button type="button" className="h-11 flex-1" onClick={() => send("pass")} disabled={pending} data-testid="wo-review-pass">
            ✓ ผ่าน
          </Button>
        )}
        {failing ? (
          <>
            <Button type="button" variant="outline" className="h-11 flex-1" onClick={() => setFailing(false)} disabled={pending}>
              ยกเลิก
            </Button>
            <Button type="button" className="h-11 flex-1 bg-[#b42318] hover:bg-[#912018]" onClick={() => send("fail")} disabled={pending || reason.trim().length < 2 || !due} data-testid="wo-review-fail-confirm">
              ยืนยันไม่ผ่าน
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" className="h-11 flex-1 border-[#dc2626] text-[#b42318]" onClick={() => setFailing(true)} disabled={pending} data-testid="wo-review-fail">
            ✗ ไม่ผ่าน
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-[#b42318]">{error}</p>}
    </div>
  );
}
