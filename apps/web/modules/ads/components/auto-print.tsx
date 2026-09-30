"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";

/** เปิดหน้าต่างพิมพ์ให้เองเมื่อโหลดเสร็จ — ผู้ใช้เลือก "บันทึกเป็น PDF" */
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, []);
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-9 items-center gap-1.5 rounded-(--radius) bg-[#1A73E8] px-4 text-sm font-medium text-white print:hidden"
    >
      <Printer className="h-4 w-4" /> พิมพ์ / บันทึกเป็น PDF
    </button>
  );
}
