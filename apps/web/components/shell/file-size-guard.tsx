"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import { FORM_UPLOAD_MAX_BYTES, MB, firstTooLarge, totalTooLargeMessage } from "@/lib/file-limits";

/**
 * ตัวกันไฟล์ใหญ่เกินของ "ฟอร์มที่ส่งไฟล์ไปกับการกดบันทึก" ทุกหน้าในที่เดียว (งานซ่อม, ใบสั่งซื้อ,
 * ค่าใช้จ่าย, รูปทรัพย์สิน/บ้าน, ลิงก์อัปโหลดภายนอก ฯลฯ) — วางครั้งเดียวที่ Shell (+ หน้าอัปโหลดสาธารณะ)
 *
 * เดิมฟอร์มพวกนี้ไม่เช็คเลย เลือกรูปจากกล้องมือถือหลายรูปรวมเกิน 25MB แล้วกดบันทึก = คำขอถูกปฏิเสธ
 * ขึ้นหน้า error ของเว็บเฉย ๆ ไม่รู้ว่าผิดอะไร · ตอนนี้:
 *  - ตอนเลือกไฟล์: ไฟล์ไหนเกิน → เตือน (ขนาดจริง + เพดาน) แล้วล้างช่องนั้น ให้เลือกใหม่
 *  - ตอนกดบันทึก: ไฟล์ทุกช่องในฟอร์มรวมกันเกิน → เตือนและไม่ส่ง
 *
 * ครอบเฉพาะ <input type="file" name=…> ในฟอร์ม (ส่งไปกับฟอร์มจริง) — ช่องที่หน้าเว็บอัปโหลดเองด้วยโค้ด
 * (แชท, รายงาน, ไฟล์บริษัท) ไม่มี name และเช็คขนาดของตัวเองแล้ว (ข้อความรูปแบบเดียวกัน lib/file-limits.ts)
 * ข้ามได้ด้วย data-file-guard="off" (เช่น รูปโปรไฟล์ที่ย่อรูปก่อนส่ง) · ปรับเพดานต่อช่อง/ฟอร์มด้วย data-max-mb
 */
function limitOf(el: Element | null, fallback: number): number {
  const mb = Number(el?.getAttribute("data-max-mb"));
  return Number.isFinite(mb) && mb > 0 ? mb * MB : fallback;
}

function guarded(input: HTMLInputElement): boolean {
  return input.type === "file" && Boolean(input.name) && Boolean(input.form) && !input.closest('[data-file-guard="off"]');
}

export function FileSizeGuard() {
  useEffect(() => {
    // capture: ทำงานก่อนตัวจัดการของ React — ล้างช่องก่อนหน้าเว็บจะไปทำพรีวิวรูปที่ใช้ไม่ได้
    function onChange(e: Event) {
      const input = e.target;
      if (!(input instanceof HTMLInputElement) || !guarded(input) || !input.files?.length) return;
      const max = limitOf(input, limitOf(input.form, FORM_UPLOAD_MAX_BYTES));
      const message = firstTooLarge(Array.from(input.files), max);
      if (!message) return;
      toast.error(message, { duration: 8000 });
      input.value = "";
    }

    function onSubmit(e: Event) {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="file"]')).filter(guarded);
      if (inputs.length === 0) return;
      const files = inputs.flatMap((i) => Array.from(i.files ?? []));
      const maxEach = limitOf(form, FORM_UPLOAD_MAX_BYTES);
      const total = files.reduce((n, f) => n + f.size, 0);
      const message = firstTooLarge(files, maxEach) ?? (total > FORM_UPLOAD_MAX_BYTES ? totalTooLargeMessage(total, FORM_UPLOAD_MAX_BYTES) : null);
      if (!message) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      toast.error(message, { duration: 10000 });
    }

    document.addEventListener("change", onChange, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("change", onChange, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  return null;
}
