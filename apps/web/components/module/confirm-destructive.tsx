"use client";

import { useState } from "react";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "./dialog";

/**
 * Modal ยืนยันก่อนทำ action ที่ทำลายข้อมูล/กู้คืนไม่ได้
 *
 * ต่อยอดจาก Modal ตัวเดิม (ไฟล์นี้) ที่ทุกโมดูลใช้ร่วมกันอยู่แล้ว แทนที่จะ
 * สร้างระบบ dialog คู่ขนานใหม่ — ผู้เรียกคุม mount/unmount เอง (เหมือน Modal)
 * ไม่มี prop `open` ในตัวมันเอง
 *
 * เมื่อใส่ `requireTypedConfirmation` ปุ่มยืนยันจะกดไม่ได้จนกว่าจะพิมพ์
 * ข้อความนั้นตรงเป๊ะ — ใช้กับการลบที่กู้คืนไม่ได้ตามสเปคข้อ 3.6/5.6
 */
export function ConfirmDestructive({
  title,
  description,
  confirmLabel = "ยืนยัน",
  cancelLabel = "ยกเลิก",
  requireTypedConfirmation,
  onClose,
  onConfirm,
  pending = false,
}: {
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** ต้องพิมพ์ข้อความนี้ให้ตรงเป๊ะก่อนปุ่มยืนยันจะกดได้ */
  requireTypedConfirmation?: string;
  onClose: () => void;
  onConfirm: () => void;
  pending?: boolean;
}) {
  const [typed, setTyped] = useState("");
  const locked =
    requireTypedConfirmation !== undefined && typed !== requireTypedConfirmation;

  return (
    <Modal
      title={title}
      onClose={onClose}
      actions={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={locked || pending}
            onClick={onConfirm}
          >
            {pending ? "กำลังดำเนินการ…" : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-(--ink)">{description}</div>
      {requireTypedConfirmation !== undefined && (
        <label className="mt-3 flex flex-col gap-1.5">
          <span className="text-xs text-(--ink-soft)">
            พิมพ์ <strong className="text-(--ink)">{requireTypedConfirmation}</strong>{" "}
            เพื่อยืนยัน
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className="flex h-10 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--danger)/30"
          />
        </label>
      )}
    </Modal>
  );
}
