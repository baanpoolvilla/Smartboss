"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Flag, Lock, Settings2 } from "lucide-react";

import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";

/**
 * ช่องของฟอร์มสร้างใบงานที่ต้องมี state ฝั่งเครื่อง (ผู้ใช้ 2/11/2569 "ให้เหมือนรูปแบบของ task")
 * ส่งค่าผ่าน input ชื่อเดิมทุกช่อง (dueDate, noExpense, openPr) — createWorkOrderAction ไม่ต้องแก้
 */

/**
 * ตรวจช่องบังคับก่อนส่งฟอร์มสร้างใบงาน (ผู้ใช้ 2/11/2569 "กรอกไม่ครบทำไมสร้างได้และขึ้นสำเร็จ")
 *
 * ช่องที่เบราว์เซอร์ตรวจเองไม่ได้ — บ้าน (ช่องซ่อนจากตัวเลือก ไม่มี required) — เดิมส่งไปได้ เซิร์ฟเวอร์
 * ไม่สร้างแต่ตอบเงียบ ๆ แล้ว SaveFeedback ขึ้น "สร้างใบแจ้งซ่อมสำเร็จ" ทั้งที่ไม่มีใบเกิดขึ้น
 * ฟังที่ window (capture) ⇒ ทำงานก่อน SaveFeedback ที่ฟังบน document — ไม่ผ่านก็ไม่มีข้อความสำเร็จ ไม่ล็อกฟอร์ม
 * (หัวข้อ/ผู้รับผิดชอบมี required ให้เบราว์เซอร์เตือนอยู่แล้ว ตรวจซ้ำกันพลาด)
 */
export function WoRequiredGuard() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const onSubmit = (e: Event) => {
      if (e.target !== form) return;
      const missing: { text: string; el: Element | null }[] = [];
      const title = form.querySelector<HTMLInputElement>('input[name="title"]');
      if (!title?.value.trim()) missing.push({ text: "หัวข้องาน", el: title });
      if (form.querySelectorAll('input[name="propertyIds"]').length === 0)
        missing.push({ text: "บ้าน (อย่างน้อย 1 หลัง)", el: form.querySelector("[data-wo-field='house']") });
      const assignee = form.querySelector<HTMLSelectElement>('select[name="assignedTo"]');
      if (assignee && !assignee.disabled && !assignee.value) missing.push({ text: "ผู้รับผิดชอบ", el: assignee });
      if (missing.length === 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      toast.error("ยังสร้างใบแจ้งซ่อมไม่ได้ — ข้อมูลไม่ครบ", { description: `กรุณาใส่: ${missing.map((m) => m.text).join(", ")}` });
      missing[0]!.el?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.addEventListener("submit", onSubmit, true);
    return () => window.removeEventListener("submit", onSubmit, true);
  }, []);
  return <span ref={ref} hidden />;
}

/**
 * ติ๊ก "ส่วนตัว" แบบหน้าสร้างงาน (ผู้ใช้ 2/11/2569) — ใบกันลืมของตัวเอง
 * ติ๊กแล้วตั้ง data-private="1" ที่ฟอร์ม ⇒ ช่องผู้รับผิดชอบ/CC และตัวเลือกเพิ่มเติม (ค่าใช้จ่าย/PR) ซ่อนไป
 * (class group-data-[private=1]/wo:hidden ในหน้า) · เซิร์ฟเวอร์บังคับซ้ำ: ผู้รับคือคนเปิด ไม่มี CC ไม่มีค่าใช้จ่าย
 */
export function WoPrivateToggle() {
  const [on, setOn] = useState(false);
  const ref = useRef<HTMLLabelElement>(null);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <label
        ref={ref}
        className={`flex w-fit cursor-pointer items-center gap-1.5 text-xs font-medium ${on ? "text-(--brand-navy)" : "text-(--ink-soft)"}`}
        title="ใบงานส่วนตัว — เห็นเฉพาะคุณกับ CEO ไม่มีผลกับคะแนน"
      >
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            const form = ref.current?.closest("form");
            if (form) {
              form.dataset.private = e.target.checked ? "1" : "0";
              // ใบส่วนตัว: ผู้รับผิดชอบคือคนเปิดเอง — ช่องผู้รับผิดชอบซ่อนอยู่และบังคับเลือก ต้องปิดไว้ ไม่งั้นส่งฟอร์มไม่ได้
              const sel = form.querySelector<HTMLSelectElement>('select[name="assignedTo"]');
              if (sel) sel.disabled = e.target.checked;
            }
          }}
          aria-label="ใบงานส่วนตัว"
          className="h-4 w-4"
        />
        <Lock className="h-3 w-3" aria-hidden="true" />
        ส่วนตัว
      </label>
      {on && (
        <span className="text-xs text-(--ink-soft)">
          กันลืมของคุณเอง · เห็นเฉพาะคุณกับ CEO · ไม่หักคะแนน ไม่นับสถิติ ไม่แจ้งใคร
        </span>
      )}
      {on && <input type="hidden" name="isPrivate" value="1" />}
    </div>
  );
}

/** ใบงานมี 3 ระดับ (ไม่ใช่ 4 แบบงาน) — สีจุดใช้ชุดเดียวกับ priorityMeta ของงาน */
const WO_PRIORITIES = [
  { value: "urgent", label: "เร่งด่วน", color: "var(--chart-red)" },
  { value: "medium", label: "ปานกลาง", color: "var(--chart-green)" },
  { value: "low", label: "ต่ำ", color: "var(--chart-gray)" },
] as const;

/** ความสำคัญ — ป้ายเล็กท้ายหัวข้อ หน้าตาเดียวกับหน้าสร้างงาน (ผู้ใช้ 2/11/2569 "แก้ให้เหมือน task") */
export function WoPriorityField({ defaultValue }: { defaultValue?: string }) {
  const [value, setValue] = useState<string>(WO_PRIORITIES.some((p) => p.value === defaultValue) ? defaultValue! : "medium");
  const current = WO_PRIORITIES.find((p) => p.value === value) ?? WO_PRIORITIES[1];
  return (
    <>
      <Select value={value} onValueChange={(v) => v && setValue(v as string)}>
        <SelectTrigger
          size="sm"
          title="ความสำคัญ"
          aria-label="ความสำคัญ"
          className="h-7 w-auto shrink-0 gap-1 rounded-full border-transparent bg-transparent px-2 text-xs text-[var(--ink-soft)] shadow-none hover:border-[var(--line)] hover:bg-[var(--bg-soft)]"
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: current.color }} />
          <Flag className="h-3 w-3" />
          <SelectValue>{current.label}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end" alignItemWithTrigger={false}>
          {WO_PRIORITIES.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                {p.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input type="hidden" name="priority" value={value} />
    </>
  );
}

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
