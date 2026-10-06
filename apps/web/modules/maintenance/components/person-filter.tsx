"use client";

import { UserRound } from "lucide-react";

/** ค่าพิเศษของตัวกรอง: งานที่ยังไม่ได้มอบหมายให้ใคร */
export const UNASSIGNED = "__unassigned__";
/** ค่าพิเศษ: งานที่ฉันได้รับมอบหมาย */
export const ASSIGNED_TO_ME = "__to_me__";
/** ค่าพิเศษ: งานที่ฉันมอบหมายให้คนอื่น */
export const ASSIGNED_BY_ME = "__by_me__";

/**
 * กรองตามคน (ผู้รับผิดชอบ) — ใช้ทั้งกระดานใบงานและกระดาน PR/PO
 *
 * เป็น <select> ไม่ใช่ชิปทีละคน: คนในทีมมีเป็นสิบ ชิปจะกินแถวเพิ่มอีกหนึ่งถึงสองแถวเหนือกระดาน
 * ซึ่งแถวบ้าน/หมวดก็ใช้ที่ไปสองแถวแล้ว · แสดงเฉพาะคนที่มีงานบนกระดานนี้จริง
 */
export function PersonFilter({
  label,
  value,
  onChange,
  people,
  showUnassigned = false,
  showMine = false,
}: {
  /** เช่น "ผู้รับผิดชอบ" */
  label: string;
  /** null = ทุกคน */
  value: string | null;
  onChange: (value: string | null) => void;
  people: { id: string; name: string }[];
  showUnassigned?: boolean;
  /** แสดงตัวเลือกด่วน "ได้รับมอบหมาย (ฉัน)" / "ฉันมอบหมาย" ไว้บนสุด */
  showMine?: boolean;
}) {
  const active = value !== null;
  return (
    <label
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border px-2.5 text-[13px]"
      style={{
        backgroundColor: active ? "var(--app-soft)" : "var(--bg)",
        borderColor: "var(--line)",
        color: "#365B55",
      }}
    >
      <UserRound className="h-3.5 w-3.5 shrink-0" />
      <span className="sr-only">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        aria-label={label}
        className="max-w-[14rem] cursor-pointer bg-transparent outline-none"
      >
        <option value="">{label}: ทุกคน</option>
        {showMine && (
          <optgroup label="ของฉัน">
            <option value={ASSIGNED_TO_ME}>งานที่ฉันได้รับมอบหมาย</option>
            <option value={ASSIGNED_BY_ME}>งานที่ฉันมอบหมายให้คนอื่น</option>
          </optgroup>
        )}
        <optgroup label="รายคน">
          {showUnassigned && <option value={UNASSIGNED}>ยังไม่มอบหมาย</option>}
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}
