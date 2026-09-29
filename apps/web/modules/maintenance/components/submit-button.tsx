"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@smartboss/ui/components/button";

/**
 * ปุ่มบันทึกที่กดซ้ำไม่ได้ระหว่างส่งฟอร์ม — ต้องอยู่ *ใน* <form> (useFormStatus อ่านจากฟอร์มที่ครอบอยู่)
 *
 * ฟอร์มที่แนบรูปใช้เวลาอัปโหลดหลายวินาทีบนมือถือ ระหว่างนั้นหน้าจอดูเหมือนไม่มีอะไรเกิดขึ้น
 * คนเลยกดซ้ำ แล้วทุกครั้งที่กดคือการส่งฟอร์มใหม่อีกรอบ ⇒ ใบงาน/PM/PR/ค่าใช้จ่ายเบิ้ล
 * (ใบงานมี server กันซ้ำอีกชั้นใน createWorkOrder — ปุ่มนี้กันไม่ให้เกิดตั้งแต่ต้น)
 *
 * `raw` = ปุ่ม <button> ธรรมดา สำหรับที่จัดสไตล์เองทั้งหมด (ไม่ใช้ Button ของ ui)
 */
type Props = React.ComponentProps<typeof Button> & { pendingText?: React.ReactNode; raw?: boolean };

export function SubmitButton({ children, pendingText = "กำลังบันทึก…", raw, disabled, ...rest }: Props) {
  const { pending } = useFormStatus();
  const common = { type: "submit" as const, disabled: disabled || pending, "aria-busy": pending };
  if (raw) {
    return (
      <button {...(rest as React.ComponentProps<"button">)} {...common}>
        {pending ? pendingText : children}
      </button>
    );
  }
  return (
    <Button {...rest} {...common}>
      {pending ? pendingText : children}
    </Button>
  );
}
