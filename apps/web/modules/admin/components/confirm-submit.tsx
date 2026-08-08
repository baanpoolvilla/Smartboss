"use client";

import { Button } from "@smartboss/ui/components/button";

/**
 * ปุ่ม submit ที่ถามยืนยันก่อน — ใช้กับ action ที่ย้อนกลับไม่ได้ (ลบผู้ใช้/ลบบทบาท)
 * ต้องเป็น client component เพราะ onClick ทำงานฝั่ง browser
 */
export function ConfirmSubmit({
  message,
  children,
  disabled,
  variant = "outline",
}: {
  message: string;
  children: React.ReactNode;
  disabled?: boolean;
  variant?: "outline" | "danger" | "primary";
}) {
  return (
    <Button
      type="submit"
      size="sm"
      variant={variant}
      disabled={disabled}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}
