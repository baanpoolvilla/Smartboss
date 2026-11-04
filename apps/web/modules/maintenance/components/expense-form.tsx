"use client";

import { SubmitButton } from "./submit-button";

import { useActionState, useRef, useState } from "react";
import { Info, Loader2, Receipt, MinusCircle, Sparkles } from "lucide-react";
import { PAYMENT_METHODS, paymentMethodLabel, receiptDateWarning, receiptHasData, type ReceiptData } from "@/modules/maintenance/lib/receipt-read";
import type { ExpenseFormState } from "@/app/(shell)/maintenance/expenses/actions";
import { Card } from "@smartboss/ui/components/card";
import { PasteDropFiles } from "@/components/annotate/paste-drop-files";

const inputClass =
  "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink) focus-visible:border-(--brand-green) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/30";

export interface WoOption {
  id: string;
  title: string;
  propertyCount: number;
  /** ใบหลายบ้าน: ให้กรอกยอดจริงทีละบ้าน */
  houses?: { id: string; name: string }[];
}

/** ฟอร์มค่าใช้จ่าย — port ตรงจาก expense_form_screen.dart */
type ExpenseAction = (prev: ExpenseFormState, formData: FormData) => Promise<ExpenseFormState>;
const EMPTY: ExpenseFormState = {};

export function ExpenseForm({
  saveAction,
  noExpenseAction,
  workOrders,
  pmSchedules,
  lockedWorkOrderId,
  lockedPmScheduleId,
  returnTo,
  edit,
  prefill,
  expectedExpenses,
}: {
  saveAction: ExpenseAction;
  noExpenseAction: ExpenseAction;
  workOrders: WoOption[];
  pmSchedules: { id: string; title: string }[];
  lockedWorkOrderId?: string;
  lockedPmScheduleId?: string;
  /** บันทึกเสร็จแล้วกลับไปหน้านี้ (หน้าใบงานที่กดเข้ามา) — ไม่ส่ง = หน้ารวมค่าใช้จ่าย */
  returnTo?: string;
  /** แก้รายการที่บันทึกแล้ว */
  edit?: {
    id: string;
    amount: string;
    description: string;
    paidBy: string;
    receiptUrl: string | null;
    receiptNo: string;
    payee: string;
    payer: string;
    paidAt: string;
    paymentMethod: string;
    noReceipt: boolean;
  };
  /** จำนวนรายการของใบนี้ตอนเปิดฟอร์ม — กันบันทึกชนกับคนอื่น */
  expectedExpenses?: number;
  /** ที่ช่างกรอกตอนปิดงาน รอตรวจ */
  prefill?: {
    amount: string;
    description: string;
    paidBy: string;
    receiptUrl: string | null;
    receiptNo: string;
    payee: string;
    payer: string;
    paidAt: string;
    paymentMethod: string;
    noReceipt: boolean;
  };
}) {
  const locked = Boolean(lockedWorkOrderId || lockedPmScheduleId);
  const [costType, setCostType] = useState(
    lockedPmScheduleId ? "pm" : "work_order"
  );
  const [woId, setWoId] = useState(lockedWorkOrderId ?? "");
  const [receiptName, setReceiptName] = useState<string | null>(null);
  const init = edit ?? prefill;
  const [amount, setAmount] = useState(init?.amount ?? "");
  const [houseAmounts, setHouseAmounts] = useState<Record<string, string>>({});
  const [description, setDescription] = useState(init?.description ?? "");
  const [receiptNo, setReceiptNo] = useState(init?.receiptNo ?? "");
  const [payee, setPayee] = useState(init?.payee ?? "");
  const [payer, setPayer] = useState(init?.payer ?? "");
  const [paidAt, setPaidAt] = useState(init?.paidAt ?? "");
  const [paymentMethod, setPaymentMethod] = useState(init?.paymentMethod ?? "");
  const [noReceipt, setNoReceipt] = useState(init?.noReceipt ?? false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [aiRead, setAiRead] = useState<ReceiptData | null>(null);
  const dateWarning = receiptDateWarning(paidAt || null);
  // ช่องรายละเอียดพับไว้ (ผู้ใช้ 3/11/2569 "ไม่ต้องเยอะ") บรรทัดสรุปบอกว่าเติมอะไรแล้ว
  const detailSummary = [payee, paidAt ? paidAt.replace("T", " ") : "", receiptNo ? `เลขที่ ${receiptNo}` : "", paymentMethodLabel(paymentMethod) ?? ""].filter(Boolean).join(" · ");
  // อ่านใบเสร็จ: เติมลงช่องให้ คนตรวจแล้วกดบันทึกเอง (lib/receipt-read.ts) · เลือกรูปใหม่ระหว่างรอ = ทิ้งผลของรูปเก่า
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<{ ok: boolean; text: string } | null>(null);
  const readSeq = useRef(0);
  async function readReceipt(file: File) {
    const seq = ++readSeq.current;
    setReading(true);
    setReadNote(null);
    setWarnings([]);
    setAiRead(null);
    try {
      const body = new FormData();
      body.append("receipt", file);
      if (lockedWorkOrderId) body.append("workOrderId", lockedWorkOrderId);
      const res = await fetch("/api/maintenance/receipt-read", { method: "POST", body });
      const json = (await res.json().catch(() => null)) as { data?: ReceiptData; warnings?: string[]; error?: string } | null;
      if (seq !== readSeq.current) return;
      // เตือนวันที่คิดสดจากช่อง (แก้แล้วหายเอง) ไม่ใช้ของ route
      setWarnings((json?.warnings ?? []).filter((w) => !w.includes("วันที่บนใบเสร็จ")));
      const d = json?.data;
      if (!d || !receiptHasData(d)) {
        setReadNote({ ok: false, text: json?.error ?? "อ่านรูปนี้ไม่ได้ กรอกเองได้เลย" });
        return;
      }
      setAiRead(d);
      if (d.amount !== null) setAmount(String(d.amount));
      if (d.paidAt) setPaidAt(d.paidAt);
      if (d.receiptNo) setReceiptNo(d.receiptNo);
      if (d.payee) setPayee(d.payee);
      if (d.payer) setPayer(d.payer);
      if (d.paymentMethod) setPaymentMethod(d.paymentMethod);
      if (d.summary) setDescription((cur) => cur || d.summary!);
      setReadNote({ ok: true, text: "ระบบอ่านใบเสร็จให้แล้ว ตรวจให้ถูกก่อนกดบันทึก" });
    } catch {
      if (seq === readSeq.current) setReadNote({ ok: false, text: "อ่านใบเสร็จไม่สำเร็จ กรอกเองได้เลย" });
    } finally {
      if (seq === readSeq.current) setReading(false);
    }
  }
  // สองปุ่มเป็นคนละ action — ไม่ฝากค่าไว้กับตัวปุ่ม (formAction + name/value ค่าไม่ถูกส่งมา)
  const [saveState, save] = useActionState(saveAction, EMPTY);
  const [noExpState, saveNoExpense] = useActionState(noExpenseAction, EMPTY);
  const [lastPressed, setLastPressed] = useState<"save" | "none">("save");
  const error = lastPressed === "none" ? noExpState.error : saveState.error;

  const propertyCount =
    workOrders.find((w) => w.id === woId)?.propertyCount ?? 0;
  const splitHouses = !edit ? workOrders.find((w) => w.id === woId)?.houses : undefined;
  const asNumber = (v: string) => Number(v.replace(/[\s,฿]/g, "")) || 0;
  const splitSum = (splitHouses ?? []).reduce((n, h) => n + asNumber(houseAmounts[h.id] ?? ""), 0);

  return (
    <Card className="p-5">
      <PasteDropFiles label="ปล่อยเพื่อแนบรูปใบเสร็จ">
      {/* action คืน { error } แบบไม่โยน (ตอบ 200 ทั้งที่ไม่สำเร็จ) — ปิด toast กลาง แสดงผลเองข้างล่าง
          สำเร็จแล้วพาไปหน้ารายการค่าใช้จ่าย ซึ่งเห็นรายการที่เพิ่งบันทึก */}
      <form className="flex flex-col gap-4" data-save-toast="off">
        {propertyCount > 1 && !splitHouses && (
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

        {/* เปิดจากหน้าใบงานที่อุปกรณ์มี PM = ประเภทเป็น PM แต่ต้องส่งใบงานไปด้วย ให้ค่าใช้จ่ายผูกกับใบงานนั้น
            (ช่องเลือกใบงานข้างล่างไม่ได้แสดงตอนเป็น PM — เดิมเลยไม่ได้ส่ง ใบงานค้าง "ยังไม่บันทึกค่าใช้จ่าย") */}
        {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
        {edit && <input type="hidden" name="expenseId" value={edit.id} />}
        {expectedExpenses !== undefined && <input type="hidden" name="expectedExpenses" value={expectedExpenses} />}

        {costType === "pm" && lockedWorkOrderId && (
          <input type="hidden" name="workOrderId" value={lockedWorkOrderId} />
        )}

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
          <select name="paidBy" defaultValue={edit?.paidBy ?? "company"} className={inputClass}>
            <option value="company">บริษัท</option>
            <option value="owner">เจ้าของบ้าน</option>
          </select>
        </label>

        {/* ใบเสร็จอยู่ก่อนช่องกรอก — แนบแล้วระบบเติมช่องด้านล่างให้ */}
        <div className="flex flex-col gap-2 rounded-(--radius) border border-(--line) p-3">
          <div className="flex flex-wrap items-center gap-3">
            {!noReceipt && (
              <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-(--radius) border border-[#0D9488] px-3 py-2 text-sm text-[#0F766E]">
                <Receipt className="h-4 w-4" />
                {receiptName || init?.receiptUrl ? "เปลี่ยนรูปใบเสร็จ" : "แนบรูปใบเสร็จ"}
                <input
                  type="file"
                  name="receipt"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setReceiptName(f?.name ?? null);
                    if (f) void readReceipt(f);
                  }}
                />
              </label>
            )}
            <label className="inline-flex items-center gap-2 text-sm text-(--ink)">
              <input
                type="checkbox"
                name="noReceipt"
                value="1"
                checked={noReceipt}
                onChange={(e) => {
                  setNoReceipt(e.target.checked);
                  if (e.target.checked) {
                    readSeq.current++;
                    setReading(false);
                    setReadNote(null);
                    setWarnings([]);
                    setAiRead(null);
                    setPaymentMethod((m) => m || "cash");
                  }
                }}
                className="h-4 w-4"
              />
              ไม่มีใบเสร็จ (เช่น จ่ายเงินสด)
            </label>
          </div>
          {!noReceipt && receiptName && <p className="truncate text-xs text-(--ink-soft)">{receiptName}</p>}
          {!noReceipt && !receiptName && init?.receiptUrl && (
            <a href={init.receiptUrl} target="_blank" rel="noreferrer" className="w-fit text-xs text-[#0F766E] underline">
              {edit ? "ดูรูปใบเสร็จเดิม" : "ดูรูปใบเสร็จที่ช่างแนบ"}
            </a>
          )}
          {prefill && !edit && <p className="text-xs text-(--ink-soft)">ข้อมูลจากช่างตอนปิดงาน ตรวจให้ตรงกับใบเสร็จก่อนบันทึก</p>}
          {aiRead && <input type="hidden" name="receiptAi" value={JSON.stringify(aiRead)} />}
          {[...warnings, ...(dateWarning ? [dateWarning] : [])].map((w) => (
            <p key={w} className="rounded-(--radius) bg-amber-50 px-2 py-1 text-xs text-amber-800">
              ⚠ {w}
            </p>
          ))}
          {reading && (
            <p className="inline-flex items-center gap-1.5 text-xs text-(--ink-soft)">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังอ่านใบเสร็จ...
            </p>
          )}
          {readNote && (
            <p role="status" className={`inline-flex items-center gap-1.5 text-xs ${readNote.ok ? "text-[#0F766E]" : "text-(--ink-soft)"}`}>
              {readNote.ok && <Sparkles className="h-3.5 w-3.5" />}
              {readNote.text}
            </p>
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-(--ink)">
            จำนวนเงิน (บาท) *
          </span>
          <input name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
        </label>

        {splitHouses && splitHouses.length > 1 && (
          <div className="flex flex-col gap-2 rounded-(--radius) border border-(--line) p-3" data-testid="house-amounts">
            <span className="text-sm font-medium text-(--ink)">ยอดจริงของแต่ละบ้าน *</span>
            {splitHouses.map((h) => (
              <label key={h.id} className="flex items-center justify-between gap-3 text-sm text-(--ink)">
                <span className="min-w-0 truncate">{h.name}</span>
                <input type="hidden" name="houseId" value={h.id} />
                <input
                  name="houseAmount"
                  inputMode="decimal"
                  aria-label={`ยอดของ ${h.name}`}
                  placeholder="0"
                  value={houseAmounts[h.id] ?? ""}
                  onChange={(e) => setHouseAmounts((cur) => ({ ...cur, [h.id]: e.target.value }))}
                  className={`${inputClass} w-32 shrink-0 text-right`}
                />
              </label>
            ))}
            <p className={`text-xs ${Math.abs(splitSum - asNumber(amount)) > 0.005 ? "text-amber-700" : "text-(--ink-soft)"}`} data-testid="house-sum">
              รวมแยกบ้าน ฿{splitSum.toLocaleString()} จากยอดรวม ฿{asNumber(amount).toLocaleString()} · บ้านที่ไม่มีค่าใช้จ่ายเว้นว่างได้
            </p>
          </div>
        )}

        <details className="rounded-(--radius) border border-(--line) p-3" data-testid="receipt-details">
          <summary className="cursor-pointer text-sm text-(--ink)">
            รายละเอียดใบเสร็จ
            <span className="ml-2 text-xs text-(--ink-soft)">{detailSummary || "ร้าน วันเวลา เลขที่ วิธีจ่าย (ไม่บังคับ)"}</span>
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-(--ink)">จ่ายให้ใคร (ร้าน/ผู้รับเงิน)</span>
            <input name="payee" value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={200} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-(--ink)">ผู้จ่าย/ผู้โอน</span>
            <input name="payer" value={payer} onChange={(e) => setPayer(e.target.value)} maxLength={200} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-(--ink)">วันเวลาที่จ่าย</span>
            <input type="datetime-local" name="paidAt" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-(--ink)">เลขที่ใบเสร็จ/เลขอ้างอิง</span>
            <input name="receiptNo" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} maxLength={100} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-(--ink)">วิธีจ่าย</span>
            <select name="paymentMethod" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputClass}>
              <option value="">— ไม่ระบุ —</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          </div>
        </details>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-(--ink)">รายละเอียด</span>
          <textarea
            name="description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink)"
          />
        </label>

        {error && (
          <p role="alert" className="rounded-(--radius) border border-(--danger) px-3 py-2 text-sm text-(--danger)">
            ยังไม่ได้บันทึก — {error}
          </p>
        )}

        <div className="flex gap-3">
          {!edit && (
            <SubmitButton
              variant="outline"
              formAction={saveNoExpense}
              formNoValidate
              onClick={() => setLastPressed("none")}
              className="flex-1"
            >
              <MinusCircle className="h-4 w-4" /> ไม่มีค่าใช้จ่าย
            </SubmitButton>
          )}
          <SubmitButton
            formAction={save}
            onClick={() => setLastPressed("save")}
            className="flex-1"
          >
            {edit ? "บันทึกการแก้ไข" : "บันทึกค่าใช้จ่าย"}
          </SubmitButton>
        </div>
      </form>
      </PasteDropFiles>
    </Card>
  );
}
