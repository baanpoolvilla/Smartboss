"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "@/components/module/dialog";
import { decideLeaveAction } from "./actions";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="danger" disabled={pending} data-testid="reject-leave-confirm">
      {pending ? "กำลังบันทึก…" : "ยืนยันไม่อนุมัติ"}
    </Button>
  );
}

/**
 * "ไม่อนุมัติ" ถามยืนยันก่อน พร้อมบอกว่าเป็นใบของใคร — ปุ่มบนมือถือใหญ่ กดพลาดได้ง่าย และผลจะแจ้งเจ้าของใบทันที
 * ผู้ใช้ 5/11/2569 · ปุ่มอนุมัติยังกดแล้วมีผลทันทีตามเดิม
 */
export function RejectLeaveButton({ requestId, name, typeName, dateLabel }: { requestId: string; name: string; typeName: string; dateLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="danger" className="max-sm:h-10 max-sm:w-full" onClick={() => setOpen(true)}>
        ไม่อนุมัติ
      </Button>
      {open && (
        <Modal
          title="ยืนยันไม่อนุมัติใบลานี้?"
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
                กลับไปก่อน
              </Button>
              <form action={decideLeaveAction} onSubmit={() => setTimeout(() => setOpen(false), 0)}>
                <input type="hidden" name="requestId" value={requestId} />
                <input type="hidden" name="outcome" value="REJECTED" />
                <ConfirmButton />
              </form>
            </>
          }
        >
          <p className="text-sm text-(--ink)">
            <span className="font-semibold">{name}</span> · {typeName} · {dateLabel}
          </p>
          <p className="mt-1 text-sm text-(--ink-soft)">ระบบจะแจ้งผลให้เจ้าของใบทันที</p>
        </Modal>
      )}
    </>
  );
}
