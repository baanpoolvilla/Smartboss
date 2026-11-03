"use client";

import { useRef, useState } from "react";
import { Loader2, Receipt, Sparkles } from "lucide-react";
import type { ReceiptData } from "@/modules/maintenance/lib/receipt-read";

/**
 * ช่องค่าใช้จ่ายแบบสั้นตอนช่างปิดงาน (เปิดใช้กำหนดบันทึกแล้ว) — ผู้ใช้ 3/11/2569 "ไม่ต้องเยอะขนาดนั้น"
 * แนบใบเสร็จแล้วระบบอ่านให้ · อ่านไม่ได้/ไม่มีใบเสร็จ กรอกราคากับรายการแปปเดียว · ไม่มีค่าใช้จ่ายติ๊กจบ
 * ยังไม่ลงยอด — เก็บไว้ให้ผู้บันทึกตรวจแล้วบันทึก (completeWorkOrderAction)
 */
export function QuickExpenseFields({ workOrderId, onValidChange }: { workOrderId: string; onValidChange: (ok: boolean) => void }) {
  const [none, setNone] = useState(false);
  const [noReceipt, setNoReceipt] = useState(false);
  const [hasFile, setHasFile] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [ai, setAi] = useState<ReceiptData | null>(null);
  const seq = useRef(0);

  const report = (next: { none?: boolean; hasFile?: boolean; name?: string; price?: string }) => {
    const n = next.none ?? none;
    const f = next.hasFile ?? hasFile;
    const nm = next.name ?? name;
    const p = next.price ?? price;
    // ไม่มีค่าใช้จ่าย จบ · ไม่งั้นต้องมีรูป หรือบอกว่าจ่ายค่าอะไร · ราคาใส่ได้เฉพาะตัวเลข
    const num = Number(p.replace(/[\s,฿]/g, ""));
    const priceOk = p.trim() === "" || (Number.isFinite(num) && num >= 0);
    onValidChange(n || ((f || nm.trim() !== "") && priceOk));
  };

  async function read(file: File) {
    const mine = ++seq.current;
    setReading(true);
    setNote(null);
    setWarnings([]);
    setAi(null);
    try {
      const body = new FormData();
      body.append("receipt", file);
      body.append("workOrderId", workOrderId);
      const res = await fetch("/api/maintenance/receipt-read", { method: "POST", body });
      const json = (await res.json().catch(() => null)) as { data?: ReceiptData; warnings?: string[]; error?: string } | null;
      if (mine !== seq.current) return;
      setWarnings(json?.warnings ?? []);
      const d = json?.data;
      if (!d || (d.amount === null && !d.summary)) {
        setNote(json?.error ?? "อ่านรูปนี้ไม่ได้ กรอกราคากับรายการเองได้เลย");
        return;
      }
      setAi(d);
      if (d.amount !== null) setPrice(String(d.amount));
      if (d.summary) setName((cur) => cur || d.summary!);
      setNote("ระบบอ่านให้แล้ว ถ้าเลขผิดแก้ได้เลย");
      report({ hasFile: true, price: d.amount !== null ? String(d.amount) : undefined, name: d.summary ?? undefined });
    } catch {
      if (mine === seq.current) setNote("อ่านไม่สำเร็จ กรอกราคากับรายการเองได้เลย");
    } finally {
      if (mine === seq.current) setReading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-(--radius) border border-(--line) p-3" data-testid="quick-expense">
      <p className="text-sm font-bold text-(--ink)">ค่าใช้จ่าย</p>
      <label className="inline-flex w-fit items-center gap-2 text-sm text-(--ink)">
        <input
          type="checkbox"
          name="noExpense"
          value="1"
          checked={none}
          onChange={(e) => {
            setNone(e.target.checked);
            report({ none: e.target.checked });
          }}
          className="h-4 w-4"
        />
        งานนี้ไม่มีค่าใช้จ่าย
      </label>

      {!none && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {!noReceipt && (
              <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-(--radius) border border-[#0D9488] px-3 py-2 text-sm text-[#0F766E]">
                <Receipt className="h-4 w-4" />
                {hasFile ? "เปลี่ยนรูปใบเสร็จ" : "แนบรูปใบเสร็จ"}
                <input
                  type="file"
                  name="expenseReceipt"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setHasFile(!!f);
                    report({ hasFile: !!f });
                    if (f) void read(f);
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
                    seq.current++;
                    setReading(false);
                    setHasFile(false);
                    setNote(null);
                    setWarnings([]);
                    setAi(null);
                    report({ hasFile: false });
                  }
                }}
                className="h-4 w-4"
              />
              ไม่มีใบเสร็จ
            </label>
          </div>
          {reading && (
            <p className="inline-flex items-center gap-1.5 text-xs text-(--ink-soft)">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังอ่านใบเสร็จ...
            </p>
          )}
          {note && (
            <p role="status" className="inline-flex items-center gap-1.5 text-xs text-[#0F766E]">
              <Sparkles className="h-3.5 w-3.5" /> {note}
            </p>
          )}
          {warnings.map((w) => (
            <p key={w} className="rounded-(--radius) bg-amber-50 px-2 py-1 text-xs text-amber-800">
              ⚠ {w}
            </p>
          ))}
          <div className="flex items-start gap-2">
            <input
              name="itemName"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                report({ name: e.target.value });
              }}
              placeholder="จ่ายค่าอะไร เช่น ค่าอะไหล่"
              aria-label="รายการ"
              className="h-10 flex-3 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)"
            />
            <input
              name="itemPrice"
              value={price}
              inputMode="decimal"
              onChange={(e) => {
                setPrice(e.target.value);
                report({ price: e.target.value });
              }}
              placeholder="฿ ราคา"
              aria-label="ราคา"
              className="h-10 flex-2 rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)"
            />
          </div>
          {ai && <input type="hidden" name="receiptAi" value={JSON.stringify(ai)} />}
          <p className="text-xs text-(--ink-soft)">ผู้บันทึกค่าใช้จ่ายจะตรวจและลงยอดให้ · ยังไม่รู้ราคาเว้นว่างได้</p>
        </>
      )}
    </div>
  );
}
