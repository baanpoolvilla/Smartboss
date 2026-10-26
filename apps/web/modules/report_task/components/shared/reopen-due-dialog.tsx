"use client";

import { useState } from "react";
import { Modal } from "@/components/module/dialog";
import { Button } from "@/modules/report_task/components/ui/button";
import { Input } from "@/modules/report_task/components/ui/input";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { canEditRecord } from "@/modules/report_task/lib/permissions";
import { formatDate } from "@/modules/report_task/lib/format";
import { todayIso } from "@/modules/report_task/lib/now";
import { statusMeta } from "@/modules/report_task/lib/task-meta";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";

/**
 * เปิดงาน "เสร็จสิ้น" กลับมาทำหลังกำหนดส่งผ่านไปแล้ว (moveTask → reopenRequest) — ต้องตั้งกำหนดส่งใหม่ก่อน
 * เดิมเปลี่ยนสถานะได้ตรง ๆ แล้วค่อยแก้วันทีหลัง ⇒ ช่วงนั้นงานเปิดอยู่แบบเลยกำหนด sweep หัก −3
 * ทั้งที่ส่งทันไปแล้ว (เจอจริง: BT5-Trip-Khwan) · บันทึกผ่าน "ส่งกลับให้แก้ไข" ทางเดิม
 */
export function ReopenDueDialog() {
  const request = useTaskStore((s) => s.reopenRequest);
  const task = useTaskStore((s) => (s.reopenRequest ? s.tasks.find((t) => t.id === s.reopenRequest!.taskId) : undefined));
  const clear = useTaskStore((s) => s.clearReopenRequest);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");

  if (!request || !task) return null;

  const close = () => {
    setDate("");
    setReason("");
    clear();
  };
  const canEdit = canEditRecord(task.assignedById, task.departmentIds, viewingAsUserId);

  const save = () => {
    if (!date) return;
    const store = useTaskStore.getState();
    if (task.taskMode === "group") store.reviseAllAssigneeDueDates(task.id, date, viewingAsUserId, true);
    else store.reviseDueDate(task.id, new Date(date).toISOString(), reason.trim(), viewingAsUserId, true);
    // ส่งกลับ = "กำลังทำ" · เลือกสถานะอื่นไว้ (เช่น "รอดำเนินการ") ย้ายต่อ — งานไม่ได้ "เสร็จสิ้น" แล้ว ไม่ติดด่านนี้ซ้ำ
    if (request.status !== "in_progress") store.moveTask(task.id, request.status);
    close();
  };

  return (
    <Modal
      title="ตั้งกำหนดส่งใหม่ก่อนเปิดงาน"
      onClose={close}
      actions={
        canEdit ? (
          <>
            <Button variant="ghost" onClick={close}>ยกเลิก</Button>
            <Button disabled={!date} onClick={save}>
              เปิดงาน → {statusMeta[request.status]?.label ?? "กำลังทำ"}
            </Button>
          </>
        ) : (
          <Button onClick={close}>ปิด</Button>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-[var(--ink-soft)]">
          &ldquo;{task.title}&rdquo; ส่งแล้ว และกำหนดส่ง {formatDate(task.dueDate)} ผ่านไปแล้ว — ถ้าเปิดกลับมาโดยไม่มีวันใหม่
          งานจะเลยกำหนดทันทีและโดนหักคะแนนอัตโนมัติ
        </p>
        {canEdit ? (
          <>
            <div className="space-y-1">
              <p className="text-xs font-medium">กำหนดส่งใหม่</p>
              <DatePickerField value={date} minDate={todayIso()} onChange={setDate} />
            </div>
            {task.taskMode !== "group" && (
              <div className="space-y-1">
                <p className="text-xs font-medium">เหตุผล (ไม่บังคับ)</p>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ขาดอีกอัน" />
              </div>
            )}
            <p className="text-xs text-[var(--ink-soft)]">ถ้าเป็นงานเพิ่ม ไม่ใช่แก้ของเดิม — ใช้ &ldquo;+ เพิ่มงานย่อย&rdquo; แทนได้ งานนี้ปิดไว้เหมือนเดิม</p>
          </>
        ) : (
          <p>ให้คนมอบหมายงานหรือหัวหน้าแผนกเป็นคนเปิดงานนี้กลับ (ตั้งกำหนดส่งใหม่ให้)</p>
        )}
      </div>
    </Modal>
  );
}
