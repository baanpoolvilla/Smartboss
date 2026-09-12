"use client";

import { useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "@/components/module/dialog";
import { Field, inputClass } from "@/modules/hr/components/ui";
import { createTimesheetPeriodAction } from "../actions";

/** เดือนปัจจุบันแบบ YYYY-MM-01 / วันสุดท้ายของเดือน — ใช้เป็นค่าเริ่มต้นของฟอร์ม */
function currentMonthRange(): { from: string; to: string; label: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const from = new Date(y, m, 1).toISOString().slice(0, 10);
  const to = new Date(y, m + 1, 0).toISOString().slice(0, 10);
  const label = `งวด ${now.toLocaleDateString("th-TH", { month: "long", year: "numeric" })}`;
  return { from, to, label };
}

export function CreatePeriodButton({ companyId }: { companyId: string }) {
  const [open, setOpen] = useState(false);
  const range = currentMonthRange();

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        + สร้างงวดใหม่
      </Button>
      {open && (
        <Modal title="สร้างงวดใหม่" onClose={() => setOpen(false)}>
          {/* เสนอค่าเริ่มต้นเป็นเดือนปัจจุบันให้เลย แทนที่จะให้กรอกเปล่า (สเปคข้อ 4.7) */}
          <form action={createTimesheetPeriodAction} className="flex flex-col gap-3">
            <input type="hidden" name="company_id" value={companyId} />
            <Field label="ชื่องวด *">
              <input name="name" required maxLength={120} defaultValue={range.label} className={inputClass} />
            </Field>
            <Field label="ตั้งแต่ *">
              <input type="date" name="starts_on" required defaultValue={range.from} className={inputClass} />
            </Field>
            <Field label="ถึง *">
              <input type="date" name="ends_on" required defaultValue={range.to} className={inputClass} />
            </Field>
            <Button type="submit">สร้างงวด</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
