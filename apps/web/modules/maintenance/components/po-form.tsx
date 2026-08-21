"use client";

import { useState } from "react";
import {
  ReceiptText,
  ClipboardCheck,
  Plus,
  Trash2,
  Camera,
  Images,
  Send,
  AlertTriangle,
  ClipboardList,
} from "lucide-react";
import { Card } from "@smartboss/ui/components/card";
import { Input } from "@smartboss/ui/components/input";
import type { PickOption } from "./multi-picker";

const inputClass =
  "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) focus-visible:border-(--brand-green) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/30";

/** ใบงานต้นทาง เมื่อเปิด PR/PO มาจากหน้าใบงาน */
export interface LinkedWorkOrder {
  id: string;
  code: string;
  title: string;
  propertyName: string;
}

/**
 * ฟอร์มเปิด PR / PO — port ตรงจาก purchase_order_form_screen.dart
 * role สูง (อนุมัติ PO ได้) จะเห็นสวิตช์ "เปิด PR" / "เปิด PO เลย"
 *
 * workOrder != null = เปิดมาจากใบงาน ⇒ ล็อกบ้านตามใบงานนั้น ไม่ให้เลือกใหม่
 * (PR ที่ผูกใบงาน BS-M4 แต่ระบุบ้าน PT-BT2 คือข้อมูลที่ขัดกันเอง แล้วรายงาน
 *  ต้นทุนรายบ้านจะเชื่อไม่ได้)
 */
export function PoForm({
  action,
  properties,
  users,
  canOpenPo,
  workOrder,
}: {
  action: (formData: FormData) => void | Promise<void>;
  properties: PickOption[];
  users: PickOption[];
  canOpenPo: boolean;
  workOrder?: LinkedWorkOrder | null;
}) {
  const [openAsPo, setOpenAsPo] = useState(canOpenPo);
  const [isEmergency, setEmergency] = useState(false);
  const [items, setItems] = useState([{ name: "", qty: "1", price: "" }]);
  const [imgCount, setImgCount] = useState(0);

  const total = items.reduce(
    (s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0),
    0
  );

  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold text-(--ink)">
        {openAsPo ? "เปิด PO (สั่งซื้ออุปกรณ์)" : "เปิด PR (คำขอซื้ออุปกรณ์)"}
      </h1>

      <Card className="p-5">
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="openAsPo" value={openAsPo ? "1" : "0"} />
          <input type="hidden" name="isEmergency" value={isEmergency ? "1" : "0"} />
          {workOrder && (
            <input type="hidden" name="workOrderId" value={workOrder.id} />
          )}

          {workOrder && (
            <div
              className="flex items-start gap-2 rounded-[12px] border p-3 text-sm"
              style={{ backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" }}
            >
              <ClipboardList
                className="mt-0.5 h-4 w-4 shrink-0"
                style={{ color: "#0F766E" }}
              />
              <div className="min-w-0">
                <p className="font-bold" style={{ color: "#0F766E" }}>
                  เปิดจากใบงาน {workOrder.code}
                </p>
                <p className="truncate text-(--ink)">{workOrder.title}</p>
                <p className="text-xs text-(--ink-soft)">
                  {workOrder.propertyName
                    ? `บ้าน ${workOrder.propertyName} — `
                    : ""}
                  ค่าใช้จ่ายที่เกิดขึ้นจะถูกบันทึกเข้าใบงานนี้ให้อัตโนมัติ
                </p>
              </div>
            </div>
          )}

          {/* ─── สลับ PR / PO (เฉพาะ role สูง) ─── */}
          {canOpenPo && (
            <div>
              <div className="inline-flex overflow-hidden rounded-(--radius) border border-(--line)">
                <button
                  type="button"
                  onClick={() => setOpenAsPo(false)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm"
                  style={
                    !openAsPo
                      ? { backgroundColor: "#CCFBF1", color: "#0F766E", fontWeight: 700 }
                      : { color: "var(--ink-soft)" }
                  }
                >
                  <ReceiptText className="h-4 w-4" /> เปิด PR
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpenAsPo(true);
                    setEmergency(false);
                  }}
                  className="flex items-center gap-1.5 border-l border-(--line) px-4 py-2 text-sm"
                  style={
                    openAsPo
                      ? { backgroundColor: "#CCFBF1", color: "#0F766E", fontWeight: 700 }
                      : { color: "var(--ink-soft)" }
                  }
                >
                  <ClipboardCheck className="h-4 w-4" /> เปิด PO เลย
                </button>
              </div>
              <p className="mt-1.5 text-xs text-(--ink-soft)">
                {openAsPo
                  ? "เปิด PO เลย — ข้ามการรออนุมัติ มอบหมายคนไปซื้อได้ทันที"
                  : "เปิด PR — ส่งให้ CEO อนุมัติก่อน"}
              </p>
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-(--ink)">
              {openAsPo ? "ชื่อ PO *" : "ชื่อ PR *"}
            </span>
            <Input
              name="title"
              required
              maxLength={200}
              /* ตัดที่ 200 ให้ตรงกับ zod max(200) ฝั่ง action — ถ้าเกิน action จะ
                 return เงียบ ๆ ไม่มีอะไรขึ้นบนจอ ซึ่งหาสาเหตุยากมาก */
              defaultValue={
                workOrder
                  ? `อุปกรณ์สำหรับ: ${workOrder.title}`.slice(0, 200)
                  : ""
              }
              placeholder="เช่น สั่งซื้ออุปกรณ์ซ่อมแอร์"
            />
          </label>

          {openAsPo && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-(--ink)">
                มอบหมายให้ไปซื้อ
              </span>
              <select name="poAssignedTo" defaultValue="" className={inputClass}>
                <option value="">— ยังไม่ระบุ —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.sub ? `${u.label} (${u.sub})` : u.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!workOrder && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-(--ink)">
                บ้าน / ทรัพย์สิน
              </span>
              <select name="propertyId" defaultValue="" className={inputClass}>
                <option value="">— ไม่ระบุ —</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-(--ink)">รายละเอียด</span>
            <textarea
              name="description"
              rows={2}
              placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"
              className="w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink)"
            />
          </label>

          {/* ─── รายการอุปกรณ์ ─── */}
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-(--ink)">
                รายการอุปกรณ์ที่ต้องการ
              </h2>
              <button
                type="button"
                onClick={() => setItems([...items, { name: "", qty: "1", price: "" }])}
                className="inline-flex items-center gap-1 text-sm text-[#0F766E]"
              >
                <Plus className="h-4 w-4" /> เพิ่มรายการ
              </button>
            </div>
            <p className="mt-1 text-xs text-(--ink-soft)">
              {isEmergency
                ? "ใส่ชื่ออุปกรณ์ จำนวน และราคาที่จ่ายไปแล้ว"
                : openAsPo
                  ? "ใส่ชื่ออุปกรณ์ — ผู้รับ PO จะกรอกจำนวนและราคาตอนไปซื้อ"
                  : "ใส่ชื่ออุปกรณ์ — CEO จะใส่จำนวนและราคาตอนอนุมัติ"}
            </p>

            <div className="mt-2 flex flex-col gap-2">
              {items.map((item, i) => (
                <div key={i} className="flex items-start gap-2">
                  <input
                    name="itemName"
                    value={item.name}
                    onChange={(e) =>
                      setItems(
                        items.map((it, j) =>
                          j === i ? { ...it, name: e.target.value } : it
                        )
                      )
                    }
                    placeholder={`อุปกรณ์ที่ ${i + 1}`}
                    aria-label={`อุปกรณ์ที่ ${i + 1}`}
                    className={`${inputClass} flex-3`}
                  />
                  {isEmergency && (
                    <>
                      <input
                        name="itemQty"
                        value={item.qty}
                        inputMode="numeric"
                        onChange={(e) =>
                          setItems(
                            items.map((it, j) =>
                              j === i ? { ...it, qty: e.target.value } : it
                            )
                          )
                        }
                        placeholder="จำนวน"
                        aria-label="จำนวน"
                        className={`${inputClass} w-20 flex-none`}
                      />
                      <input
                        name="itemPrice"
                        value={item.price}
                        inputMode="decimal"
                        onChange={(e) =>
                          setItems(
                            items.map((it, j) =>
                              j === i ? { ...it, price: e.target.value } : it
                            )
                          )
                        }
                        placeholder="ราคา/หน่วย"
                        aria-label="ราคา/หน่วย"
                        className={`${inputClass} w-28 flex-none`}
                      />
                    </>
                  )}
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setItems(items.filter((_, j) => j !== i))}
                      aria-label="ลบรายการ"
                      className="mt-2.5 text-[#DC2626]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {isEmergency && (
              <p className="mt-2 border-t border-(--line) pt-2 text-right text-base font-bold text-[#B91C1C]">
                รวม: ฿{total.toFixed(2)}
              </p>
            )}
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-(--ink)">หมายเหตุ</span>
            <textarea
              name="notes"
              rows={2}
              placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)"
              className="w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink)"
            />
          </label>

          {/* ─── รูปประกอบ ─── */}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-(--ink)">
                {isEmergency ? "แนบใบเสร็จ / รูปสินค้า *" : "รูปประกอบ PR (ถ้ามี)"}
              </span>
              <label
                className="ml-auto cursor-pointer rounded-(--radius) p-1.5 text-(--ink-soft) hover:bg-(--bg-soft)"
                title="ถ่ายรูป"
              >
                <Camera className="h-5 w-5" />
                <input
                  type="file"
                  name="prImages"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => setImgCount(e.target.files?.length ?? 0)}
                />
              </label>
              <label
                className="cursor-pointer rounded-(--radius) p-1.5 text-(--ink-soft) hover:bg-(--bg-soft)"
                title="แกลเลอรี่ (หลายรูป)"
              >
                <Images className="h-5 w-5" />
                <input
                  type="file"
                  name="prImages"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => setImgCount(e.target.files?.length ?? 0)}
                />
              </label>
            </div>
            {imgCount > 0 ? (
              <p
                className="mt-2 rounded-(--radius) px-3 py-2 text-sm font-bold"
                style={{ backgroundColor: "#EFF6FF", border: "1px solid #BFDBFE", color: "#1D4ED8" }}
              >
                {imgCount} รูป
              </p>
            ) : (
              <p className="mt-1 text-xs text-(--ink-soft)">
                {isEmergency
                  ? "แนบรูปใบเสร็จ หรือรูปสินค้าที่ซื้อมาแล้ว"
                  : "แนบรูปอ้างอิง เช่น รูปของที่ชำรุด หรืออุปกรณ์ที่ต้องการ"}
              </p>
            )}
          </div>

          {/* ─── กรณีฉุกเฉิน (ซ่อนเมื่อเปิด PO เลย) ─── */}
          {!openAsPo && (
            <div
              className="rounded-[12px] border p-3"
              style={
                isEmergency
                  ? { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" }
                  : { backgroundColor: "var(--bg-soft)", borderColor: "var(--line)" }
              }
            >
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={isEmergency}
                  onChange={(e) => setEmergency(e.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <span
                    className="block text-sm font-bold"
                    style={isEmergency ? { color: "#B91C1C" } : undefined}
                  >
                    กรณีฉุกเฉิน — ซื้อของแล้ว / จบงานแล้ว
                  </span>
                  <span
                    className="block text-xs"
                    style={{ color: isEmergency ? "#DC2626" : "var(--ink-soft)" }}
                  >
                    ใส่ราคาได้เลย — CEO อนุมัติแล้วจบทันที
                  </span>
                </span>
              </label>
              {isEmergency && (
                <textarea
                  name="emergencyReason"
                  required
                  rows={2}
                  placeholder="ระบุเหตุผลที่ต้องซื้อก่อน"
                  aria-label="เหตุผลกรณีฉุกเฉิน"
                  className="mt-3 w-full rounded-[8px] border border-(--line) bg-white px-3 py-2 text-sm text-(--ink)"
                />
              )}
            </div>
          )}

          <button
            type="submit"
            className="flex h-11 w-full items-center justify-center gap-2 rounded-(--radius) text-sm font-medium text-white hover:brightness-95"
            style={{
              backgroundColor:
                isEmergency && !openAsPo ? "#B91C1C" : "var(--brand-green)",
            }}
          >
            {openAsPo ? (
              <>
                <ClipboardCheck className="h-4 w-4" /> เปิด PO — มอบหมายให้ไปซื้อ
              </>
            ) : isEmergency ? (
              <>
                <AlertTriangle className="h-4 w-4" /> เปิด PR (ฉุกเฉิน) — ส่งให้ CEO อนุมัติ
              </>
            ) : (
              <>
                <Send className="h-4 w-4" /> เปิด PR — ส่งให้ CEO อนุมัติ
              </>
            )}
          </button>
        </form>
      </Card>
    </>
  );
}
