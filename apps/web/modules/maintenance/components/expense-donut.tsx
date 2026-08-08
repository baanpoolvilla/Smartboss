"use client";

import { useState } from "react";

const COLORS = [
  "#4CAF50",
  "#2196F3",
  "#F44336",
  "#FF9800",
  "#9C27B0",
  "#00BCD4",
  "#FF5722",
  "#607D8B",
  "#E91E63",
  "#795548",
];

export interface DonutCategory {
  /** prefix ของหมวด */
  key: string;
  label: string;
  /** ยอดรายบ้านในหมวดนี้ */
  items: { key: string; label: string; value: number }[];
}

function baht(n: number): string {
  return "฿" + Math.round(n).toLocaleString("en-US");
}

/**
 * โดนัทค่าใช้จ่ายเดือนนี้ + ชิปหมวด (กดเพื่อ drill ลงรายบ้าน)
 * port จาก _buildExpenseChart + _DonutChartPainter
 */
export function ExpenseDonut({ categories }: { categories: DonutCategory[] }) {
  const [selected, setSelected] = useState<string | null>(null);

  const cat = selected ? categories.find((c) => c.key === selected) : null;
  const entries = cat
    ? [...cat.items].sort((a, b) => b.value - a.value)
    : categories
        .map((c) => ({
          key: c.key,
          label: c.label,
          value: c.items.reduce((s, i) => s + i.value, 0),
        }))
        .sort((a, b) => b.value - a.value);

  const total = entries.reduce((s, e) => s + e.value, 0);

  // วาดวงแหวนด้วย stroke-dasharray บนวงกลม SVG
  const R = 70;
  const C = 2 * Math.PI * R;
  /*
   * มุมเริ่มของแต่ละส่วน = ผลรวมของส่วนก่อนหน้า
   *
   * เดิมสะสมด้วยตัวแปร let ที่ถูกแก้ค่าใน .map() — ใช้ได้ผลถูกต้อง แต่ผิดกฎ
   * react-hooks/immutability (ห้ามแก้ค่าตัวแปรระหว่าง render) จึงเปลี่ยนมาคิด
   * ผลรวมสะสมล่วงหน้าแทน ผลลัพธ์เท่าเดิมและอ่านง่ายกว่า
   */
  const arcs = entries.map((e, i) => {
    const before = entries.slice(0, i).reduce((s, x) => s + x.value, 0);
    const frac = total > 0 ? e.value / total : 0;
    return {
      color: COLORS[i % COLORS.length]!,
      dash: `${frac * C} ${C}`,
      rotate: (before / (total || 1)) * 360 - 90,
    };
  });

  const chip = (active: boolean) =>
    active
      ? { color: "#0F766E", borderColor: "#0D9488", backgroundColor: "#CCFBF1" }
      : { color: "var(--ink-soft)", borderColor: "var(--line)" };

  return (
    <div>
      {categories.length > 1 && (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="shrink-0 rounded-full border px-3 py-1 text-xs"
            style={chip(selected === null)}
          >
            ทั้งหมด
          </button>
          {categories.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setSelected(selected === c.key ? null : c.key)}
              className="shrink-0 rounded-full border px-3 py-1 text-xs"
              style={chip(selected === c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex justify-center">
        <svg viewBox="0 0 200 200" className="h-[200px] w-[200px]">
          {arcs.map((a, i) => (
            <circle
              key={i}
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke={a.color}
              strokeWidth="26"
              strokeDasharray={a.dash}
              transform={`rotate(${a.rotate} 100 100)`}
            />
          ))}
          <text
            x="100"
            y="98"
            textAnchor="middle"
            className="fill-(--ink)"
            style={{ fontSize: 20, fontWeight: 700 }}
          >
            {baht(total)}
          </text>
          <text
            x="100"
            y="118"
            textAnchor="middle"
            className="fill-(--ink-soft)"
            style={{ fontSize: 12 }}
          >
            {cat ? cat.label : "รวม"}
          </text>
        </svg>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
        {entries.map((e, i) => {
          const pct = total > 0 ? (e.value / total) * 100 : 0;
          return (
            <span key={e.key} className="inline-flex items-center gap-1.5">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: COLORS[i % COLORS.length] }}
              />
              <span>
                <span className="block text-xs font-semibold text-(--ink)">
                  {e.label}
                </span>
                <span className="block text-xs text-(--ink-soft)">
                  {baht(e.value)} ({pct.toFixed(0)}%)
                </span>
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
