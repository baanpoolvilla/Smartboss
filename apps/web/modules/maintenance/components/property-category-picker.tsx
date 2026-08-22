"use client";

import { useRef } from "react";
import { FolderInput } from "lucide-react";

/**
 * ย้ายบ้านเข้าหมวด จากหน้ารายชื่อบ้านโดยตรง
 *
 * เลือกแล้วส่งทันทีโดยไม่มีปุ่มบันทึก — งานนี้คือ "ลากบ้านไปอีกกอง" ซึ่งเป็น
 * การกระทำเดียวจบ ปุ่มบันทึกเพิ่มมาอีกคลิกโดยไม่ได้กันความผิดพลาดอะไรเลย
 * (เลือกผิดก็เลือกใหม่ได้ทันที ไม่มีอะไรเสียหาย)
 */
export function PropertyCategoryPicker({
  propertyId,
  categoryId,
  categories,
  action,
}: {
  propertyId: string;
  categoryId: string | null;
  categories: { id: string; displayName: string }[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={action} className="shrink-0">
      <input type="hidden" name="propertyId" value={propertyId} />
      <label
        className="inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors hover:bg-(--bg-soft)"
        style={{
          borderColor: categoryId ? "var(--line)" : "#EA580C66",
          color: categoryId ? "var(--ink-soft)" : "#EA580C",
        }}
        title="ย้ายเข้าหมวดอื่น"
      >
        <FolderInput className="h-3.5 w-3.5 shrink-0" />
        <select
          name="categoryId"
          defaultValue={categoryId ?? ""}
          onChange={() => formRef.current?.requestSubmit()}
          aria-label="หมวดหมู่ของบ้านนี้"
          className="cursor-pointer border-0 bg-transparent pr-1 text-xs outline-none"
        >
          <option value="">ยังไม่จัดหมวด</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}
