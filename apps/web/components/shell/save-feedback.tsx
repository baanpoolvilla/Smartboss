"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/**
 * เด้งข้อความ "บันทึกสำเร็จ" ทุกครั้งที่กดส่งฟอร์มที่ยิง server action — ทั้งระบบ
 *
 * เดิมกดบันทึกแล้วหน้าจอแค่รีเฟรชเงียบ ๆ ผู้ใช้ไม่รู้ว่าบันทึกไปแล้วหรือยัง
 * ("ตอนนี้ไม่รู้เลยว่าบันทึกแล้วหรือยัง") ฟอร์มมีเป็นร้อยจุดกระจายทุกโมดูล
 * จึงทำที่เดียวตรงนี้แทนการไล่แก้ทีละฟอร์ม
 *
 * วิธีรู้ว่า "สำเร็จจริง" ไม่ใช่เดา:
 *   1. ฟังการ submit ของฟอร์ม (capture) → จำไว้ว่าเพิ่งกดปุ่มอะไร
 *   2. ครอบ fetch — คำขอ server action ของ Next มี header `next-action` เสมอ
 *      และถ้า action โยน error ฝั่งเซิร์ฟเวอร์ Next ตอบ 500
 *      (next/dist/server/app-render/action-handler.js) ⇒ res.ok = สำเร็จจริง
 *   เงื่อนไขต้องครบทั้งสองข้อ — action ที่ถูกเรียกจากโค้ดเฉย ๆ (ไม่ได้มาจากการกดฟอร์ม)
 *   และคำขอ fetch อื่นทั้งหมดไม่ถูกแตะ ส่งผ่านตรง ๆ ไม่อ่าน body
 *
 * ปิดเฉพาะฟอร์ม: data-save-toast="off" — ใช้กับฟอร์ม useActionState ที่ action คืน
 * { error } แบบไม่โยน (ตอบ 200 ทั้งที่ไม่สำเร็จ) และแสดงผลในหน้าของตัวเองอยู่แล้ว
 * เปลี่ยนข้อความ: data-save-toast="ข้อความ" บนปุ่มหรือฟอร์ม
 */

/** submit กับการยิง action เกิดติดกันแทบทันที — เผื่อไว้สำหรับเครื่องช้า */
const SUBMIT_TO_ACTION_MS = 3000;
const MAX_LABEL_LENGTH = 30;
const FALLBACK_LABEL = "บันทึกสำเร็จ";

let pending: { at: number; label: string } | null = null;

function submitterLabel(form: HTMLFormElement, submitter: HTMLElement | null): string | null {
  const override = submitter?.dataset.saveToast ?? form.dataset.saveToast;
  if (override === "off") return null;
  if (override) return override;

  const text = (submitter?.getAttribute("aria-label") || submitter?.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length > MAX_LABEL_LENGTH) return FALLBACK_LABEL;
  return /(สำเร็จ|แล้ว)$/.test(text) ? text : `${text}สำเร็จ`;
}

/** ฟอร์มที่ส่งไป URL ปกติ (เช่นฟอร์มค้นหา method=GET) เป็นการเปลี่ยนหน้า ไม่ใช่การบันทึก */
function targetsServerAction(form: HTMLFormElement, submitter: HTMLElement | null): boolean {
  const target = submitter?.getAttribute("formaction") ?? form.getAttribute("action");
  if (target && !target.startsWith("javascript:")) return false;
  return (form.getAttribute("method") ?? "").toLowerCase() !== "get";
}

function isServerActionRequest(init: RequestInit | undefined): boolean {
  const headers = init?.headers;
  if (!headers) return false;
  if (headers instanceof Headers) return headers.has("next-action");
  if (Array.isArray(headers)) return headers.some(([key]) => key.toLowerCase() === "next-action");
  return Object.keys(headers).some((key) => key.toLowerCase() === "next-action");
}

export function SaveFeedback() {
  useEffect(() => {
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const submitter = event.submitter instanceof HTMLElement ? event.submitter : null;
      if (!targetsServerAction(form, submitter)) return;
      const label = submitterLabel(form, submitter);
      pending = label === null ? null : { at: Date.now(), label };
    };

    const original = window.fetch;
    const wrapped: typeof window.fetch = async (input, init) => {
      const claim =
        pending !== null && Date.now() - pending.at < SUBMIT_TO_ACTION_MS && isServerActionRequest(init)
          ? pending
          : null;
      if (claim === null) return original(input, init);
      pending = null;

      const id = toast.loading("กำลังบันทึก…");
      try {
        const res = await original(input, init);
        if (res.ok) toast.success(claim.label, { id });
        else toast.error("บันทึกไม่สำเร็จ", { id, description: "ข้อมูลยังไม่ถูกบันทึก ลองใหม่อีกครั้ง" });
        return res;
      } catch (error) {
        toast.error("บันทึกไม่สำเร็จ", { id, description: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่" });
        throw error;
      }
    };

    document.addEventListener("submit", onSubmit, true);
    window.fetch = wrapped;
    return () => {
      document.removeEventListener("submit", onSubmit, true);
      if (window.fetch === wrapped) window.fetch = original;
    };
  }, []);

  return null;
}
