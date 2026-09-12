"use client";

import { useRef, useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { ConfirmDestructive } from "@/components/module/confirm-destructive";
import { deleteEnrollmentsAction } from "../../actions";

/** ลบลายนิ้วมือทุกเครื่องของคนคนนี้ — อธิบายผลก่อนกด แทนปุ่มแดงลอย ๆ (สเปคข้อ 4.10) */
export function DeleteEnrollmentsButton({
  employmentId,
  employeeName,
}: {
  employmentId: string;
  employeeName: string;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <Button type="button" size="sm" variant="danger" onClick={() => setOpen(true)}>
        ลบทุกเครื่อง
      </Button>
      {open && (
        <ConfirmDestructive
          title={`ลบลายนิ้วมือของ ${employeeName}?`}
          confirmLabel="ลบทุกเครื่อง"
          onClose={() => setOpen(false)}
          onConfirm={() => formRef.current?.requestSubmit()}
          description={
            <>
              จะลบการผูกลายนิ้วมือของคนนี้ <strong>ทุกเครื่องพร้อมกัน</strong> — สแกนที่เครื่องใดก็ตามจะใช้ไม่ได้
              จนกว่าจะผูกใหม่ (ระบบไม่รองรับลบทีละเครื่อง)
            </>
          }
        />
      )}
      <form ref={formRef} action={deleteEnrollmentsAction} className="hidden">
        <input type="hidden" name="employmentId" value={employmentId} />
      </form>
    </>
  );
}
