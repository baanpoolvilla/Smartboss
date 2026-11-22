"use client";

import { halfStepWeights } from "@/lib/grade-thresholds";

/**
 * เติมตัวคูณแบบเกรดเฉลี่ย (A+ 4.5 · A 4 · B+ 3.5 … D 1 · F 0) ลงช่องในตาราง — ยังไม่บันทึกจนกด "บันทึกตัวคูณ"
 * ชุด A–D เดิมได้ 4/3/2/1 = สัดส่วนเท่าค่าตั้งต้นเดิม (เงินที่แบ่งได้เท่าเดิม) เกรดบวกอยู่ครึ่งทาง
 */
export function HalfStepWeightsButton({ grades }: { grades: string[] }) {
  return (
    <button
      type="button"
      onClick={() => {
        const w = halfStepWeights(grades);
        for (const g of grades) {
          const el = document.getElementById(`commission-weight-${g}`) as HTMLInputElement | null;
          if (el) el.value = String(w[g] ?? 0);
        }
      }}
      className="inline-flex h-8 items-center rounded-lg border border-(--line) px-3 text-xs font-medium text-(--ink) hover:bg-(--bg-soft)"
    >
      เติมแบบไล่ทีละ 0.5 (A 4 · B+ 3.5 · B 3 …)
    </button>
  );
}
