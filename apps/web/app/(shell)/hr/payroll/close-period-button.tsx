"use client";

import { useRef, useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { ConfirmDestructive } from "@/components/module/confirm-destructive";
import { inputClass } from "@/modules/hr/components/ui";
import { closeTimesheetAction } from "../actions";

/**
 * ปิดงวด — กู้คืนไม่ได้ (แก้เวลาหลังจากนี้ไม่กระทบงวดที่ปิดแล้วอีก) จึงบังคับ
 * พิมพ์ชื่องวดยืนยันก่อน (สเปคข้อ 4.7/3.6) ฟอร์มจริงยังเป็น
 * closeTimesheetAction ตัวเดิมเป๊ะ — ที่เพิ่มมาเป็นแค่ชั้น UI ยืนยัน
 */
export function ClosePeriodButton({ periodId, periodName }: { periodId: string; periodName: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        ปิดงวด
      </Button>
      {open && (
        <ConfirmDestructive
          title={`ปิดงวด "${periodName}"?`}
          confirmLabel="ปิดงวด"
          requireTypedConfirmation={periodName}
          onClose={() => setOpen(false)}
          onConfirm={() => formRef.current?.requestSubmit()}
          description={
            <div className="flex flex-col gap-3">
              <p>
                ปิดแล้วข้อมูลจะถูกตรึงเป็น snapshot — การแก้เวลาหลังจากนี้จะไม่กระทบงวดนี้อีก
                ต้องเปิดงวดใหม่ถ้าต้องแก้
              </p>
              <form ref={formRef} action={closeTimesheetAction} className="flex flex-col gap-1.5">
                <input type="hidden" name="periodId" value={periodId} />
                <label className="text-xs font-medium text-(--ink-soft)">เหตุผลที่ปิดงวด</label>
                <input
                  name="reason"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="เช่น ตรวจเวลาครบทุกคนแล้ว"
                  className={inputClass}
                />
              </form>
            </div>
          }
        />
      )}
    </>
  );
}
