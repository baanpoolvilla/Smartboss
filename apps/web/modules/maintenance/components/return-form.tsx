"use client";

import { useState } from "react";
import { Camera, Images, Undo2 } from "lucide-react";
import { Card } from "@smartboss/ui/components/card";
import { RETURN_PROBLEM_OPTIONS } from "@/modules/maintenance/lib/returns";

const inputClass =
  "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) focus-visible:border-(--brand-green) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/30";

export interface ReturnPoOption {
  id: string;
  title: string;
  items: string[];
}

/** ฟอร์มแจ้งคืนของ / ของมีปัญหา — port จาก equipment_return_form_screen.dart */
export function ReturnForm({
  action,
  pos,
  initialPoId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  pos: ReturnPoOption[];
  initialPoId?: string;
}) {
  const [poId, setPoId] = useState(
    initialPoId && pos.some((p) => p.id === initialPoId) ? initialPoId : ""
  );
  const [imgCount, setImgCount] = useState(0);
  const items = pos.find((p) => p.id === poId)?.items ?? [];

  return (
    <Card className="p-5">
      <form action={action} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-(--ink)">
            รายการสั่งซื้อ (PO) *
          </span>
          <select
            name="purchaseOrderId"
            required
            value={poId}
            onChange={(e) => setPoId(e.target.value)}
            className={inputClass}
          >
            <option value="">— เลือกรายการสั่งซื้อ —</option>
            {pos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          {pos.length === 0 && (
            <span className="text-xs text-[#DC2626]">
              ยังไม่มี PO ที่อนุมัติ/รับของแล้วให้เลือก
            </span>
          )}
        </label>

        {items.length > 0 && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-(--ink)">
              อุปกรณ์ที่มีปัญหา
            </span>
            <select name="itemName" defaultValue="" className={inputClass}>
              <option value="">— ทั้งรายการ / ไม่ระบุ —</option>
              {items.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-end gap-3">
          <label className="flex flex-3 flex-col gap-1.5">
            <span className="text-sm font-medium text-(--ink)">
              ชนิดปัญหา *
            </span>
            <select
              name="problemType"
              defaultValue="defective"
              className={inputClass}
            >
              {RETURN_PROBLEM_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-[90px] flex-none flex-col gap-1.5">
            <span className="text-sm font-medium text-(--ink)">จำนวน</span>
            <input
              name="qty"
              defaultValue="1"
              inputMode="numeric"
              required
              className={inputClass}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-(--ink)">
            รายละเอียดปัญหา *
          </span>
          <textarea
            name="reason"
            required
            rows={3}
            placeholder="อธิบายว่าของมีปัญหาอย่างไร / ต้องการคืนเพราะอะไร"
            className="w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink)"
          />
        </label>

        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-(--ink)">
              รูปของที่มีปัญหา (ถ้ามี)
            </span>
            <label
              className="ml-auto cursor-pointer rounded-(--radius) p-1.5 text-(--ink-soft) hover:bg-(--bg-soft)"
              title="ถ่ายรูป"
            >
              <Camera className="h-5 w-5" />
              <input
                type="file"
                name="images"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => setImgCount(e.target.files?.length ?? 0)}
              />
            </label>
            <label
              className="cursor-pointer rounded-(--radius) p-1.5 text-(--ink-soft) hover:bg-(--bg-soft)"
              title="แกลเลอรี่"
            >
              <Images className="h-5 w-5" />
              <input
                type="file"
                name="images"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => setImgCount(e.target.files?.length ?? 0)}
              />
            </label>
          </div>
          {imgCount > 0 && (
            <p
              className="mt-2 rounded-(--radius) px-3 py-2 text-sm font-bold"
              style={{ backgroundColor: "#EFF6FF", border: "1px solid #BFDBFE", color: "#1D4ED8" }}
            >
              {imgCount} รูป
            </p>
          )}
        </div>

        <button
          type="submit"
          className="flex h-11 w-full items-center justify-center gap-2 rounded-(--radius) bg-(--brand-green) text-sm font-medium text-white hover:brightness-95"
        >
          <Undo2 className="h-4 w-4" /> แจ้งคืน / ปัญหา
        </button>
      </form>
    </Card>
  );
}
