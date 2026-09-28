"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

/** AlertDialog/SimpleDialog แบบเดียวกับของเดิม — พื้นขาว มุมโค้ง 20 ทับทั้งจอ */
export function Modal({
  title,
  onClose,
  children,
  actions,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  actions?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // วาดที่ document.body แทนที่จุดที่เรียกใช้ — Modal ถูกเรียกจากในแถบบน
  // (ปุ่มออกจากระบบ) ซึ่งอยู่ใต้ layout แบบเต็มจอของบางหน้า (Kanban ฯลฯ) ถ้า
  // บรรพบุรุษตัวไหนสร้าง stacking context/containing block (z-index, transform,
  // overflow) `fixed inset-0` จะไม่คลุมทั้งจอจริง — ถูกซ่อนหรือตัดทิ้ง กดแล้ว
  // เหมือนไม่มีอะไรเกิดขึ้น ("กดออกจากระบบจากหน้านี้ไม่ได้") — เจอจริง: แถบบนอยู่ใน
  // sticky z-30 ทำให้ Modal (z-90) ติดอยู่ในชั้น z-30 แถบตัวกรองของหน้าลอยทับ
  // Modal เปิดจากการกดของผู้ใช้เสมอ (ไม่เคยเปิดค้างตอน SSR) — เช็คกันไว้เผื่อ
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-90 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[20px] border border-(--line) bg-(--bg) sm:rounded-[20px] ${
          wide ? "sm:max-w-2xl" : "sm:max-w-md"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-(--line) px-5 py-4">
          <h2 className="text-base font-bold text-(--ink)">{title}</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {actions && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-(--line) px-5 py-3">
            {actions}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
