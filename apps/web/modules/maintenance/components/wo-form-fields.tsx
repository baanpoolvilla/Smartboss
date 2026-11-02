"use client";

import { useState } from "react";
import { ChevronDown, Settings2 } from "lucide-react";

import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";

/**
 * ช่องของฟอร์มสร้างใบงานที่ต้องมี state ฝั่งเครื่อง (ผู้ใช้ 2/11/2569 "ให้เหมือนรูปแบบของ task")
 * ส่งค่าผ่าน input ชื่อเดิมทุกช่อง (dueDate, noExpense, openPr) — createWorkOrderAction ไม่ต้องแก้
 */

/** วันครบกำหนด แสดง วัน/เดือน/ปี (ช่องวันที่ของเบราว์เซอร์ขึ้น mm/dd/yyyy ตามภาษาเครื่อง) */
export function WoDueDateField({ defaultValue, minDate }: { defaultValue?: string; minDate: string }) {
  const [value, setValue] = useState(defaultValue ?? "");
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-(--ink-soft)">วันครบกำหนด (ไม่ใส่ก็ได้)</span>
      <div className="flex items-center gap-2">
        <DatePickerField value={value} minDate={minDate} onChange={setValue} className="h-10 max-w-56 text-(--ink)" />
        {value && (
          <button type="button" onClick={() => setValue("")} className="text-xs text-(--ink-soft) hover:underline">
            ล้างวันที่
          </button>
        )}
      </div>
      <input type="hidden" name="dueDate" value={value} />
      <span className="text-xs text-(--ink-soft)">
        เลยวันนี้แล้วยังไม่ปิดงาน ใบงานจะขึ้นแดงว่าเลยกำหนด และนับเป็นงานค้างของผู้รับผิดชอบ
      </span>
    </div>
  );
}

/** ตัวเลือกเพิ่มเติม (พับไว้): ค่าใช้จ่าย + เปิด PR ต่อ — เลือก "ไม่มีค่าใช้จ่าย" แล้วหัวข้อบอกไว้ให้เห็นตอนพับ */
export function WoAdvancedOptions({ canOpenPr }: { canOpenPr: boolean }) {
  const [open, setOpen] = useState(false);
  const [noExpense, setNoExpense] = useState(false);
  const [openPr, setOpenPr] = useState(false);
  const summary = [noExpense ? "ไม่มีค่าใช้จ่าย" : null, openPr ? "เปิด PR ต่อ" : null].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex w-fit items-center gap-1.5 rounded-(--radius) border border-(--line) px-3 py-1.5 text-sm font-semibold text-(--ink) hover:bg-(--bg-soft)"
      >
        <Settings2 className="h-4 w-4" aria-hidden="true" />
        ตัวเลือกเพิ่มเติม
        {summary && <span className="font-normal text-(--ink-soft)">· {summary}</span>}
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {/* ค่าอยู่ในฟอร์มเสมอ แม้พับไว้ */}
      {noExpense && <input type="hidden" name="noExpense" value="1" />}
      {openPr && <input type="hidden" name="openPr" value="1" />}

      {open && (
        <div className="flex flex-col gap-4 rounded-(--radius) border border-(--line) p-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-(--ink-soft)">ค่าใช้จ่าย</span>
            <div role="radiogroup" aria-label="ค่าใช้จ่าย" className="inline-flex w-fit gap-0.5 rounded-(--radius) border border-(--line) bg-(--bg-soft) p-0.5">
              {[
                { v: false, label: "มีค่าใช้จ่าย" },
                { v: true, label: "ไม่มีค่าใช้จ่าย" },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={noExpense === o.v}
                  onClick={() => setNoExpense(o.v)}
                  className={
                    noExpense === o.v
                      ? "rounded-[calc(var(--radius)-2px)] bg-(--bg) px-3 py-1 text-sm font-semibold text-(--brand-navy) shadow-sm"
                      : "rounded-[calc(var(--radius)-2px)] px-3 py-1 text-sm text-(--ink-soft)"
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-(--ink-soft)">
              ไม่มีค่าใช้จ่าย เช่น งานที่จ้างเหมารายปีไว้แล้ว — ตอนปิดงานจะไม่ถามค่าใช้จ่าย และไม่ถูกทวงในรายงาน
            </span>
          </div>

          {canOpenPr && (
            <label className="flex items-start gap-2.5">
              <input type="checkbox" checked={openPr} onChange={(e) => setOpenPr(e.target.checked)} className="mt-0.5 h-4 w-4" />
              <span>
                <span className="block text-sm font-medium text-(--ink)">เปิด PR ขอซื้ออุปกรณ์ต่อเลย</span>
                <span className="block text-xs text-(--ink-soft)">บันทึกใบงานเสร็จแล้ว พาไปหน้าเปิด PR ที่ผูกกับใบงานนี้ทันที</span>
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
