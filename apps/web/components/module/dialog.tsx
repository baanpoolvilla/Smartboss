"use client";

import { useEffect } from "react";

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

  return (
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
    </div>
  );
}
