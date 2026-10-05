"use client";

import { useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "@/components/module/dialog";
import type { Employment } from "@/modules/hr/lib/api";
import { ManualAttendanceForm, type AttendanceIssue } from "./correction-forms";

/**
 * ฟอร์มส่งคำขอลงเวลาใหม่ — เดิมกางอยู่ตลอดเวลาทั้งที่งานหลักของหน้านี้คือ
 * "ตรวจ" ไม่ใช่ "สร้าง" (สเปคข้อ 4.2) ยุบเป็นปุ่ม + Modal แทน
 *
 * `selfEmploymentId` = พนักงานยื่นให้ตัวเอง ไม่มีช่องเลือกพนักงาน
 */
export function NewCorrectionButton({
  employees = [],
  selfEmploymentId,
  issues = {},
}: {
  employees?: Employment[];
  selfEmploymentId?: string;
  issues?: Record<string, AttendanceIssue[]>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        + ส่งคำขอลงเวลาใหม่
      </Button>
      {open && (
        <Modal title="ส่งคำขอลงเวลาใหม่" onClose={() => setOpen(false)} wide>
          <ManualAttendanceForm
            employees={employees}
            issues={issues}
            {...(selfEmploymentId ? { selfEmploymentId } : {})}
          />
        </Modal>
      )}
    </>
  );
}
