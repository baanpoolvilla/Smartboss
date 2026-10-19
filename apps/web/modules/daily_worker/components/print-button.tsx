"use client";

/** เปิดหน้าต่างพิมพ์ของเบราว์เซอร์ — เลือก "บันทึกเป็น PDF" ได้จากหน้าต่างเดียวกัน */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-full bg-(--ink) px-4 py-1.5 text-sm font-semibold text-(--bg)">
      พิมพ์ / บันทึก PDF
    </button>
  );
}
