"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { Card } from "@smartboss/ui/components/card";

const inputClass =
  "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) focus-visible:border-(--brand-green) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/30";

type Row = { name: string; qty: string; price: string };

/**
 * ปุ่ม "แก้ไข" รายการอุปกรณ์ของ PR ที่ยังรออนุมัติ — หน้ารายละเอียดแสดงเฉพาะตอน pending
 * และคนที่แก้ได้ (คนเปิด PR / คนจัดการ PR/PO) · action เช็คซ้ำทั้งสิทธิ์และสถานะ
 * withPricing = PR ฉุกเฉิน (ซื้อแล้ว) มีจำนวนและราคา · PR ปกติใส่แค่ชื่อเหมือนตอนเปิด
 */
export function PoItemsEditButton({
  id,
  items,
  withPricing,
  action,
  children,
}: {
  id: string;
  items: { name: string; qty: number; unitPrice: number }[];
  withPricing: boolean;
  action: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
  /** รายการแบบอ่านอย่างเดียว — แสดงตอนไม่ได้แก้ */
  children: ReactNode;
}) {
  const initial = (): Row[] =>
    items.length > 0
      ? items.map((it) => ({ name: it.name, qty: String(it.qty || 1), price: it.unitPrice ? String(it.unitPrice) : "" }))
      : [{ name: "", qty: "1", price: "" }];
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Row[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const total = rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0), 0);

  const header = (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="text-base font-bold text-(--ink)">รายการอุปกรณ์</h2>
      {!editing && (
      <button
        type="button"
        onClick={() => {
          setRows(initial());
          setError(null);
          setEditing(true);
        }}
        className="inline-flex items-center gap-1 text-sm text-[#0F766E] hover:underline"
        data-testid="po-items-edit"
      >
        <Pencil className="h-3.5 w-3.5" /> แก้ไขรายการ
      </button>
      )}
    </div>
  );

  if (!editing) {
    return (
      <>
        {header}
        {children}
      </>
    );
  }

  return (
    <>
    {header}
    <Card className="mb-4 p-3">
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await action(fd);
          if (res.ok) setEditing(false);
          else setError(res.error ?? "บันทึกไม่สำเร็จ");
        });
      }}
    >
      <input type="hidden" name="id" value={id} />
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-2">
          <input
            name="itemName"
            value={r.name}
            onChange={(e) => set(i, { name: e.target.value })}
            placeholder={`อุปกรณ์ที่ ${i + 1}`}
            aria-label={`อุปกรณ์ที่ ${i + 1}`}
            maxLength={200}
            className={`${inputClass} flex-3`}
          />
          {withPricing && (
            <>
              <input
                name="itemQty"
                value={r.qty}
                inputMode="numeric"
                onChange={(e) => set(i, { qty: e.target.value })}
                placeholder="จำนวน"
                aria-label="จำนวน"
                className={`${inputClass} w-20 flex-none`}
              />
              <input
                name="itemPrice"
                value={r.price}
                inputMode="decimal"
                onChange={(e) => set(i, { price: e.target.value })}
                placeholder="ราคา/หน่วย"
                aria-label="ราคา/หน่วย"
                className={`${inputClass} w-28 flex-none`}
              />
            </>
          )}
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              aria-label="ลบรายการ"
              className="mt-2.5 text-[#DC2626]"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows([...rows, { name: "", qty: "1", price: "" }])}
        className="inline-flex items-center gap-1 self-start text-sm text-[#0F766E]"
      >
        <Plus className="h-4 w-4" /> เพิ่มรายการ
      </button>
      {withPricing && (
        <p className="border-t border-(--line) pt-2 text-right text-sm font-bold text-[#B91C1C]">รวม: ฿{total.toFixed(2)}</p>
      )}
      {error && <p className="text-sm text-[#DC2626]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={pending}>
          ยกเลิก
        </Button>
        <Button type="submit" size="sm" disabled={pending} data-testid="po-items-save">
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </Button>
      </div>
    </form>
    </Card>
    </>
  );
}
