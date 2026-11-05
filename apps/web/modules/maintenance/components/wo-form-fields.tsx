"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Flag, Lock, SlidersHorizontal } from "lucide-react";

import { MultiPicker, type PickOption } from "@/modules/maintenance/components/multi-picker";
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
    // เรียงแบบหน้าสร้างงาน: วันเริ่มซ้าย กำหนดส่งขวา (ผู้ใช้ 5/11/2569) · ใบงานไม่มีวันเริ่มให้ตั้ง ช่องซ้ายคือวันที่เปิดใบ แก้ไม่ได้
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs text-(--ink-soft)">วันที่เปิด</span>
          <div inert className="opacity-70" data-testid="wo-open-date">
            <DatePickerField value={minDate} onChange={() => {}} className="h-10 px-2 text-[13px] text-(--ink) max-[359px]:[&>svg]:hidden sm:px-3 sm:text-sm" />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center justify-between gap-2 text-xs text-(--ink-soft)">
            กำหนดส่ง
            {value && (
              <button type="button" onClick={() => setValue("")} className="hover:underline">
                ล้าง
              </button>
            )}
          </span>
          <DatePickerField value={value} minDate={minDate} onChange={setValue} className="h-10 px-2 text-[13px] text-(--ink) max-[359px]:[&>svg]:hidden sm:px-3 sm:text-sm" />
        </div>
      </div>
      <input type="hidden" name="dueDate" value={value} />
      <span className="text-[11px] text-(--ink-soft)" data-testid="wo-due-hint">ไม่ใส่ก็ได้ · เลยกำหนดหักคะแนน</span>
    </div>
  );
}

/** ตัวเลือกเพิ่มเติม (พับไว้): ค่าใช้จ่าย + เปิด PR ต่อ — เลือก "ไม่มีค่าใช้จ่าย" แล้วหัวข้อบอกไว้ให้เห็นตอนพับ */
export function WoAdvancedOptions({
  canOpenPr,
  defaultNoExpense = false,
  ccOptions,
}: {
  canOpenPr: boolean;
  defaultNoExpense?: boolean;
  /** ผู้รับสำเนา — ย้ายมาจากแถวผู้รับผิดชอบ ให้แถวหลักไม่กินที่ (ผู้ใช้ 5/11/2569) */
  ccOptions: PickOption[];
}) {
  const [open, setOpen] = useState(false);
  const [ccCount, setCcCount] = useState(0);
  // คนที่เป็นผู้รับผิดชอบอยู่แล้วไม่ต้องอยู่ใน CC — ช่องอยู่คนละส่วนของฟอร์ม อ่านค่าจาก select
  const [assignee, setAssignee] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const read = () => setAssignee(form.querySelector<HTMLSelectElement>('select[name="assignedTo"]')?.value ?? "");
    read();
    form.addEventListener("change", read);
    return () => form.removeEventListener("change", read);
  }, []);
  // สร้างจากแผน PM ที่ตั้ง "ไม่มีค่าใช้จ่าย" ⇒ เลือกไว้ให้ก่อน (เปลี่ยนเองได้) — ดู pmPlansSkipExpense
  const [noExpense, setNoExpense] = useState(defaultNoExpense);
  const [openPr, setOpenPr] = useState(false);
  const summary = [ccCount > 0 ? `CC ${ccCount} คน` : null, noExpense ? "ไม่มีค่าใช้จ่าย" : null, openPr ? "เปิด PR ต่อ" : null].filter(Boolean).join(" · ");

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-(--line) bg-white px-3 py-1.5 text-[13px] font-semibold text-(--ink) hover:bg-(--bg-soft)"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        {open ? "ซ่อนตัวเลือกขั้นสูง" : "ตัวเลือกขั้นสูง"}
        {summary && <span className="font-normal text-(--ink-soft)">· {summary}</span>}
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {/* ค่าอยู่ในฟอร์มเสมอ แม้พับไว้ */}
      {noExpense && <input type="hidden" name="noExpense" value="1" />}
      {openPr && <input type="hidden" name="openPr" value="1" />}

      {/* พับด้วย class ไม่ถอดออก — รายชื่อ CC ที่เลือกต้องอยู่ในฟอร์มตลอด */}
      <div className={open ? "flex flex-col gap-3 rounded-(--radius) border border-(--line) p-3" : "hidden"}>
          <MultiPicker
            name="ccUserIds"
            title="เพิ่ม CC (แจ้งสำเนา)"
            heading="CC (แจ้งสำเนา)"
            boxed
            hint="เลือกผู้รับสำเนาการแจ้งเตือน (LINE + in-app)"
            emptyText="เลือก CC (ไม่บังคับ)"
            addLabel="เพิ่ม CC"
            options={ccOptions}
            exclude={assignee ? [assignee] : []}
            chipBg="#FFF7ED"
            icon="user"
            onChange={(ids) => setCcCount(ids.length)}
          />
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
                      ? "whitespace-nowrap rounded-[calc(var(--radius)-2px)] bg-(--bg) px-2.5 py-1 text-xs font-semibold text-(--brand-navy) shadow-sm sm:px-3 sm:text-sm"
                      : "whitespace-nowrap rounded-[calc(var(--radius)-2px)] px-2.5 py-1 text-xs text-(--ink-soft) sm:px-3 sm:text-sm"
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-(--ink-soft)">ไม่มีค่าใช้จ่าย = ปิดงานได้โดยไม่ต้องกรอกยอด</span>
          </div>

          {canOpenPr && (
            <label className="flex items-start gap-2.5">
              <input type="checkbox" checked={openPr} onChange={(e) => setOpenPr(e.target.checked)} className="mt-0.5 h-4 w-4" />
              <span>
                <span className="block text-sm font-medium text-(--ink)">เปิด PR ขอซื้ออุปกรณ์ต่อเลย</span>
                <span className="block text-xs text-(--ink-soft)">บันทึกแล้วพาไปหน้าเปิด PR</span>
              </span>
            </label>
          )}
      </div>
    </div>
  );
}
