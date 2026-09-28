"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * ช่องรหัสผ่านที่มีปุ่มรูปตา กดแล้วเห็นตัวอักษรที่กำลังพิมพ์ กันพิมพ์ผิด
 * (หน้าตาเดียวกับช่องรหัสผ่านในหน้า login) — แค่สลับ type ของ input
 * ไม่ได้ดึงรหัสผ่านเดิมมาโชว์ ระบบเก็บเป็น hash ย้อนกลับไม่ได้
 *
 * รับ props เหมือน <input> ทุกอย่าง (name/required/value/onChange ฯลฯ)
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={show ? "text" : "password"} className={`${className ?? ""} pr-11`} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-(--ink-soft) transition-colors hover:text-(--ink)"
        aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
        aria-pressed={show}
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
