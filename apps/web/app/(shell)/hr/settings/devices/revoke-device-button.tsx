"use client";

import { useRef, useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { ConfirmDestructive } from "@/components/module/confirm-destructive";
import { revokeDeviceAction } from "../../actions";

/** เพิกถอนเครื่อง — อธิบายผลก่อนกด (สเปคข้อ 4.10: "ต้องอธิบายผลลัพธ์ก่อนกด") */
export function RevokeDeviceButton({ deviceId, deviceCode }: { deviceId: string; deviceCode: string }) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <Button type="button" size="sm" variant="danger" onClick={() => setOpen(true)}>
        เพิกถอน
      </Button>
      {open && (
        <ConfirmDestructive
          title={`เพิกถอนเครื่อง ${deviceCode}?`}
          confirmLabel="เพิกถอน"
          onClose={() => setOpen(false)}
          onConfirm={() => formRef.current?.requestSubmit()}
          description="พนักงานจะสแกนนิ้วที่เครื่องนี้ไม่ได้ทันที ต้องออกโทเคนใหม่ถึงจะใช้ได้อีกครั้ง"
        />
      )}
      <form ref={formRef} action={revokeDeviceAction} className="hidden">
        <input type="hidden" name="deviceId" value={deviceId} />
      </form>
    </>
  );
}
