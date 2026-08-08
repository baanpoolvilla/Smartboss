"use client";

import { useState } from "react";
import { Info, Receipt, MinusCircle } from "lucide-react";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";

const inputClass =
  "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) focus-visible:border-(--brand-green) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/30";

export interface WoOption {
  id: string;
  title: string;
  propertyCount: number;
}

/** ฟอร์มค่าใช้จ่าย — port ตรงจาก expense_form_screen.dart */
export function ExpenseForm({
  action,
  workOrders,
  pmSchedules,
  lockedWorkOrderId,
  lockedPmScheduleId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  workOrders: WoOption[];
  pmSchedules: { id: string; title: string }[];
  lockedWorkOrderId?: string;
  lockedPmScheduleId?: string;
}) {
  const locked = Boolean(lockedWorkOrderId || lockedPmScheduleId);
  const [costType, setCostType] = useState(
    lockedPmScheduleId ? "pm" : "work_order"
  );
  const [woId, setWoId] = useState(lockedWorkOrderId ?? "");
  const [receiptName, setReceiptName] = useState<string | null>(null);

  const propertyCount =
    workOrders.find((w) => w.id === woId)?.propertyCount ?? 0;

  return (
    <Card className="p-5">
      <form className="flex flex-col gap-4">
        {propertyCount > 1 && (
          <div
            className="flex items-start gap-2 rounded-[8px] p-3 text-[13px]"
            style={{ backgroundColor: "#EFF6FF", border: "1px solid #BFDBFE", color: "#1E40AF" }}
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            ใบงานนี้มี {propertyCount} บ้าน — ระบบจะสร้าง {propertyCount}{" "}
            รายการค่าใช้จ่าย โดยแต่ละบ้านบันทึกยอดเต็มจำนวนเท่ากัน
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-(--ink)">
            ประเภทค่าใช้จ่าย *
          </span>
          <select
            name="costType"
            value={costType}
            disabled={locked}
            onChange={(e) => {
              setCostType(e.target.value);
              setWoId("");
            }}
            className={`${inputClass} ${locked ? "bg-(--bg-soft)" : ""}`}
          >
            <option value="work_order">ใบงาน</option>
            <option value="pm">PM (บำรุงรักษา)</option>
          </select>
          {locked && <input type="hidden" name="costType" value={costType} />}
        </label>

        {costType === "work_order" ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-(--ink)">ใบงาน *</span>
            <select
              name="workOrderId"
              required
              value={woId}
              disabled={Boolean(lockedWorkOrderId)}
              onChange={(e) => setWoId(e.target.value)}
              className={`${inputClass} ${lockedWorkOrderId ? "bg-(--bg-soft)" : ""}`}
            >
              <option value="">— เลือกใบงาน —</option>
              {workOrders.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.title}
                </option>
              ))}
            </select>
            {lockedWorkOrderId && (
              <input type="hidden" name="workOrderId" value={lockedWorkOrderId} />
            )}
          </label>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-(--ink)">
              รายการ PM *
            </span>
            <select
              name="pmScheduleId"
              required
              defaultValue={lockedPmScheduleId ?? ""}
              disabled={Boolean(lockedPmScheduleId)}
              className={`${inputClass} ${lockedPmScheduleId ? "bg-(--bg-soft)" : ""}`}
            >
              <option value="">— เลือกรายการ PM —</option>
              {pmSchedules.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            {lockedPmScheduleId && (
              <input
                type="hidden"
                name="pmScheduleId"
                value={lockedPmScheduleId}
              />
            )}
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-(--ink)">
            รับผิดชอบโดย *
          </span>
          <select name="paidBy" defaultValue="company" className={inputClass}>
            <option value="company">บริษัท</option>
            <option value="owner">เจ้าของบ้าน</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-(--ink)">
            จำนวนเงิน (บาท) *
          </span>
          <input name="amount" inputMode="decimal" className={inputClass} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-(--ink)">รายละเอียด</span>
          <textarea
            name="description"
            rows={3}
            className="w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink)"
          />
        </label>

        <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-(--radius) border border-[#0D9488] px-3 py-2 text-sm text-[#0F766E]">
          <Receipt className="h-4 w-4" />
          {receiptName ? "เปลี่ยนรูปใบเสร็จ" : "แนบรูปใบเสร็จ"}
          <input
            type="file"
            name="receipt"
            accept="image/*"
            className="hidden"
            onChange={(e) => setReceiptName(e.target.files?.[0]?.name ?? null)}
          />
        </label>
        {receiptName && (
          <p className="-mt-2 truncate text-xs text-(--ink-soft)">
            {receiptName}
          </p>
        )}

        <div className="flex gap-3">
          <Button
            type="submit"
            variant="outline"
            formAction={action}
            name="isNoExpense"
            value="1"
            className="flex-1"
          >
            <MinusCircle className="h-4 w-4" /> ไม่มีค่าใช้จ่าย
          </Button>
          <Button type="submit" formAction={action} className="flex-1">
            บันทึกค่าใช้จ่าย
          </Button>
        </div>
      </form>
    </Card>
  );
}
