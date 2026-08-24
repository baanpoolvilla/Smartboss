"use client";

import { useState } from "react";
import {
  Check,
  X,
  Truck,
  Package,
  ShoppingBag,
  AlertTriangle,
  Undo2,
  Camera,
  Images,
} from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "./dialog";
import type { PickOption } from "./multi-picker";

type Action = (formData: FormData) => void | Promise<void>;

export interface PoItemView {
  name: string;
  qty: number;
  unitPrice: number;
}

/** ตัวเลือกแนบรูป (กล้อง/แกลเลอรี) + สรุปจำนวนรูป — เหมือน _imagePickerRow เดิม */
function ImagePickerRow({ name = "receiptImages" }: { name?: string }) {
  const [count, setCount] = useState(0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-(--ink)">รูปใบเสร็จ</span>
        <label
          className="ml-auto cursor-pointer rounded-(--radius) p-1.5 text-(--ink-soft) hover:bg-(--bg-soft)"
          title="ถ่ายรูป"
        >
          <Camera className="h-5 w-5" />
          <input
            type="file"
            name={name}
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => setCount(e.target.files?.length ?? 0)}
          />
        </label>
        <label
          className="cursor-pointer rounded-(--radius) p-1.5 text-(--ink-soft) hover:bg-(--bg-soft)"
          title="แกลเลอรี่ (หลายรูป)"
        >
          <Images className="h-5 w-5" />
          <input
            type="file"
            name={name}
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => setCount(e.target.files?.length ?? 0)}
          />
        </label>
      </div>
      {count > 0 ? (
        <div
          className="flex items-center gap-2 rounded-(--radius) px-3 py-2 text-sm font-bold"
          style={{ backgroundColor: "#F0FDF4", border: "1px solid #BBF7D0", color: "#15803D" }}
        >
          <Check className="h-4 w-4" /> {count} รูป
        </div>
      ) : (
        <p className="text-xs text-(--ink-soft)">
          ยังไม่มีรูป — กดไอคอนกล้อง 📷 หรือแกลเลอรี่ 🖼️
        </p>
      )}
    </div>
  );
}

/** ตารางกรอกจำนวน + ราคา/หน่วย พร้อมยอดรวมสด ๆ */
function PricingRows({ items }: { items: PoItemView[] }) {
  const [rows, setRows] = useState(
    items.map((i) => ({
      qty: i.qty > 0 ? String(i.qty) : "1",
      price: i.unitPrice > 0 ? String(i.unitPrice) : "",
    }))
  );
  const total = rows.reduce(
    (s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0),
    0
  );

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, i) => (
        <div key={i}>
          <p className="text-sm font-bold text-(--ink)">{item.name}</p>
          <div className="mt-1.5 flex gap-3">
            <input
              name="itemQty"
              value={rows[i]!.qty}
              inputMode="numeric"
              aria-label="จำนวน"
              placeholder="จำนวน"
              onChange={(e) =>
                setRows(rows.map((r, j) => (j === i ? { ...r, qty: e.target.value } : r)))
              }
              className="h-10 flex-1 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)"
            />
            <input
              name="itemPrice"
              value={rows[i]!.price}
              inputMode="decimal"
              aria-label="ราคา/หน่วย"
              placeholder="ราคา/หน่วย (฿)"
              onChange={(e) =>
                setRows(rows.map((r, j) => (j === i ? { ...r, price: e.target.value } : r)))
              }
              className="h-10 flex-2 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)"
            />
          </div>
        </div>
      ))}
      <div className="border-t border-(--line) pt-2 text-right text-sm font-bold text-(--ink)">
        รวม: ฿{total.toFixed(2)}
      </div>
    </div>
  );
}

/** [1] CEO อนุมัติ PR ปกติ — เลือกผู้รับ PO */
export function ApproveNormalButton({
  id,
  users,
  action,
}: {
  id: string;
  users: PickOption[];
  action: Action;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-11 flex-1 items-center justify-center gap-2 rounded-(--radius) bg-[#2E7D32] text-sm font-medium text-white hover:brightness-95"
      >
        <Check className="h-4 w-4" /> อนุมัติ &amp; มอบ PO
      </button>
      {open && (
        <Modal
          title="อนุมัติ PR — มอบ PO ให้"
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="submit" form="approve-normal-form" size="sm">
                อนุมัติ &amp; มอบ PO
              </Button>
            </>
          }
        >
          <form id="approve-normal-form" action={action} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={id} />
            <p className="text-[13px] text-(--ink-soft)">
              ผู้รับ PO จะเป็นคนไปซื้อของ
              <br />
              และกรอกราคาตอนรับของ
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-(--ink)">มอบหมายให้</span>
              <select
                name="assignee"
                defaultValue=""
                className="h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)"
              >
                <option value="">— ไม่ระบุ —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.sub ? `${u.label} (${u.sub})` : u.label}
                  </option>
                ))}
              </select>
            </label>
          </form>
        </Modal>
      )}
    </>
  );
}

/** [2] CEO อนุมัติ PR ฉุกเฉิน → จบงานทันที */
export function ApproveEmergencyButton({
  id,
  total,
  reason,
  action,
}: {
  id: string;
  total: number;
  reason: string | null;
  action: Action;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-11 flex-1 items-center justify-center gap-2 rounded-(--radius) bg-[#B91C1C] text-sm font-medium text-white hover:brightness-95"
      >
        <AlertTriangle className="h-4 w-4" /> อนุมัติ (ฉุกเฉิน)
      </button>
      {open && (
        <Modal
          title="อนุมัติ PR ฉุกเฉิน"
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                ยกเลิก
              </Button>
              <form action={action}>
                <input type="hidden" name="id" value={id} />
                <Button type="submit" variant="danger" size="sm">
                  อนุมัติ (จบงาน)
                </Button>
              </form>
            </>
          }
        >
          <div
            className="rounded-(--radius) p-2.5"
            style={{ backgroundColor: "#FEF2F2", border: "1px solid #FECACA" }}
          >
            <p className="flex items-center gap-1.5 text-[13px] font-bold text-[#B91C1C]">
              <AlertTriangle className="h-4 w-4" /> ซื้อของแล้ว — จ่ายตังไปแล้ว
            </p>
            {reason && (
              <p className="mt-1 text-xs text-[#B91C1C]">เหตุผล: {reason}</p>
            )}
          </div>
          {total > 0 && (
            <p className="mt-3 text-base font-bold text-(--ink)">
              ยอดรวม: ฿{total.toFixed(2)}
            </p>
          )}
          <p className="mt-2 text-xs text-(--ink-soft)">
            เมื่ออนุมัติจะบันทึกสถานะเป็น &quot;เสร็จสิ้น&quot; ทันที
          </p>
        </Modal>
      )}
    </>
  );
}

/** [3] ยืนยันดำเนินการซื้อ: ราคา + รูป + มอบหมายผู้รับของ */
export function ConfirmOrderButton({
  id,
  items,
  users,
  defaultReceiverId,
  action,
}: {
  id: string;
  items: PoItemView[];
  users: PickOption[];
  /**
   * ตั้งต้นเป็นคนที่ถูกมอบให้ไปซื้อ — เคสที่พบบ่อยที่สุดคือคนเดียวกันไปซื้อและรับเอง
   * ส่วนเคสที่ต่างคน (สั่งออนไลน์ให้คนเฝ้าออฟฟิศเซ็นรับ) แค่เปลี่ยนใน dropdown
   */
  defaultReceiverId?: string | null;
  action: Action;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" className="w-full" onClick={() => setOpen(true)}>
        <Truck className="h-4 w-4" /> ยืนยันดำเนินการ — กรอกราคา + แนบรูป
      </Button>
      {open && (
        <Modal
          title="ยืนยันดำเนินการสั่งซื้อ"
          wide
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="submit" form="confirm-order-form" size="sm">
                ยืนยันสั่งซื้อ
              </Button>
            </>
          }
        >
          <form id="confirm-order-form" action={action} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={id} />
            <p className="text-xs text-(--ink-soft)">
              กรอกจำนวนและราคาของที่ซื้อ แล้วแนบรูปใบสั่งซื้อ (ถ้ามี)
            </p>
            <PricingRows items={items} />

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-(--ink)">
                มอบหมายผู้รับของ
              </span>
              <select
                name="receiverAssignedTo"
                defaultValue={defaultReceiverId ?? ""}
                className="h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)"
              >
                <option value="">— ยังไม่ระบุ —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.sub ? `${u.label} (${u.sub})` : u.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-(--ink-soft)">
                คนซื้อกับคนรับของไม่จำเป็นต้องเป็นคนเดียวกัน — คนที่เลือกไว้จะได้รับ
                แจ้งเตือน และกดปุ่ม &ldquo;รับของ&rdquo; ได้
              </span>
            </label>

            <ImagePickerRow />
          </form>
        </Modal>
      )}
    </>
  );
}

/** [4] รับของ: แนบรูปใบเสร็จ */
export function ReceiveButton({
  id,
  receiverName,
  action,
}: {
  id: string;
  /** ชื่อคนที่ถูกมอบหมายให้รับของ (ถ้ามี) — แสดงกันคนอื่นกดรับแทนโดยไม่ตั้งใจ */
  receiverName?: string | null;
  action: Action;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => setOpen(true)}
      >
        <Package className="h-4 w-4" /> รับของ — แนบรูปใบเสร็จ
      </Button>
      {open && (
        <Modal
          title="ยืนยันรับของ"
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="submit" form="receive-form" size="sm">
                ยืนยันรับของ
              </Button>
            </>
          }
        >
          <form id="receive-form" action={action} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={id} />
            {receiverName && (
              <p
                className="rounded-(--radius) px-3 py-2 text-[13px]"
                style={{ backgroundColor: "#EFF6FF", color: "#1D4ED8" }}
              >
                มอบหมายให้ <b>{receiverName}</b> เป็นผู้รับของ
              </p>
            )}
            <p className="text-xs text-(--ink-soft)">
              แนบรูปใบเสร็จหรือรูปสินค้าที่รับมา (ถ้ามี)
            </p>
            <ImagePickerRow />
          </form>
        </Modal>
      )}
    </>
  );
}

/** [5] ซื้อเอง: ราคา + รูป → จบ */
export function SelfReceiveButton({
  id,
  items,
  action,
}: {
  id: string;
  items: PoItemView[];
  action: Action;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-(--radius) bg-[#15803D] text-sm font-medium text-white hover:brightness-95"
      >
        <ShoppingBag className="h-4 w-4" /> รับของ → ถ่ายรูป + กรอกราคา
      </button>
      {open && (
        <Modal
          title="กรอกจำนวนและราคาที่ซื้อมา"
          wide
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="submit" form="self-receive-form" size="sm">
                บันทึก
              </Button>
            </>
          }
        >
          <form id="self-receive-form" action={action} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={id} />
            <PricingRows items={items} />
            <ImagePickerRow />
          </form>
        </Modal>
      )}
    </>
  );
}

/** ปฏิเสธ PR */
export function RejectButton({ id, action }: { id: string; action: Action }) {
  return (
    <form action={action} className="flex-1">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="flex h-11 w-full items-center justify-center gap-2 rounded-(--radius) border border-[#DC2626] text-sm font-medium text-[#DC2626] hover:bg-[#FEF2F2]"
      >
        <X className="h-4 w-4" /> ปฏิเสธ
      </button>
    </form>
  );
}

/** จบเรื่องการคืนของ — ใส่สรุปผล */
export function ResolveReturnButton({
  id,
  action,
}: {
  id: string;
  action: Action;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-11 flex-1 items-center justify-center gap-2 rounded-(--radius) bg-[#2E7D32] text-sm font-medium text-white hover:brightness-95"
      >
        <Check className="h-4 w-4" /> จบเรื่อง
      </button>
      {open && (
        <Modal
          title="จบเรื่อง — สรุปผล"
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="submit" form="resolve-return-form" size="sm">
                จบเรื่อง
              </Button>
            </>
          }
        >
          <form id="resolve-return-form" action={action}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="status" value="resolved" />
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-(--ink)">
                ผลการดำเนินการ
              </span>
              <textarea
                name="resolutionNote"
                rows={3}
                placeholder="เช่น คืนของแล้ว / เปลี่ยนตัวใหม่ / ได้เงินคืน"
                className="w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink)"
              />
            </label>
          </form>
        </Modal>
      )}
    </>
  );
}

/** ปุ่มเปลี่ยนสถานะรายการคืนของแบบกดทีเดียว */
export function ReturnStatusButton({
  id,
  status,
  label,
  action,
  tone = "primary",
}: {
  id: string;
  status: string;
  label: string;
  action: Action;
  tone?: "primary" | "danger";
}) {
  return (
    <form action={action} className="flex-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        className={
          tone === "danger"
            ? "flex h-11 w-full items-center justify-center gap-2 rounded-(--radius) border border-[#DC2626] text-sm font-medium text-[#DC2626] hover:bg-[#FEF2F2]"
            : "flex h-11 w-full items-center justify-center gap-2 rounded-(--radius) bg-(--brand-green) text-sm font-medium text-white hover:brightness-95"
        }
      >
        {tone === "danger" ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
        {label}
      </button>
    </form>
  );
}

/** ลิงก์แจ้งของมีปัญหา/คืนของ จากหน้า PO */
export function ReturnLinkButton({ poId }: { poId: string }) {
  return (
    <a
      href={`/maintenance/purchase-orders/returns/new?poId=${poId}`}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-(--radius) border border-[#795548] text-sm font-medium text-[#795548] hover:bg-[#EFEBE9]"
    >
      <Undo2 className="h-4 w-4" /> แจ้งของมีปัญหา / คืนของ
    </a>
  );
}
