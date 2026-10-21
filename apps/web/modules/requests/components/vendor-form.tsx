"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { saveVendorAction, type VendorInput } from "../actions";
import { Notice } from "./ui";

const field = "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)";

const EMPTY: VendorInput = { id: null, name: "", kind: "person", taxId: "", phone: "", address: "", bankName: "", bankAccount: "", accountName: "", whtPercent: 3, vatRegistered: false, note: "", active: true };

export function VendorForm({ initial, whtRates, onDone }: { initial?: VendorInput | null; whtRates: number[]; onDone?: () => void }) {
  const router = useRouter();
  const [v, setV] = useState<VendorInput>(initial ?? EMPTY);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof VendorInput>(k: K, value: VendorInput[K]) => setV((x) => ({ ...x, [k]: value }));

  function save() {
    setError(null);
    start(async () => {
      const res = await saveVendorAction(v);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (!initial) setV(EMPTY);
      onDone?.();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          <span className="font-semibold">ชื่อช่าง / ร้าน</span>
          <input className={field} value={v.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">ประเภท</span>
          <select className={field} value={v.kind} onChange={(e) => set("kind", e.target.value as VendorInput["kind"])}>
            <option value="person">บุคคล (ช่างอิสระ)</option>
            <option value="company">บริษัท / ร้าน</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">เลขผู้เสียภาษี / บัตรประชาชน (13 หลัก)</span>
          <input inputMode="numeric" className={field} value={v.taxId} onChange={(e) => set("taxId", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">เบอร์โทร</span>
          <input inputMode="tel" className={field} value={v.phone} onChange={(e) => set("phone", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">หัก ณ ที่จ่ายตั้งต้น</span>
          <select className={field} value={v.whtPercent} onChange={(e) => set("whtPercent", Number(e.target.value))}>
            {[...new Set([...whtRates, v.whtPercent])].sort((a, b) => a - b).map((w) => (
              <option key={w} value={w}>{w === 0 ? "ไม่หัก" : `${w}%`}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">ธนาคาร</span>
          <input className={field} value={v.bankName} onChange={(e) => set("bankName", e.target.value)} placeholder="เช่น กสิกรไทย" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">เลขบัญชี</span>
          <input inputMode="numeric" className={field} value={v.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          <span className="font-semibold">ชื่อบัญชี</span>
          <input className={field} value={v.accountName} onChange={(e) => set("accountName", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          <span className="font-semibold">ที่อยู่ (สำหรับหนังสือรับรองหัก ณ ที่จ่าย)</span>
          <input className={field} value={v.address} onChange={(e) => set("address", e.target.value)} />
        </label>
        <label className="flex h-11 items-center gap-2 rounded-(--radius) border border-(--line) px-3 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={v.vatRegistered} onChange={(e) => set("vatRegistered", e.target.checked)} />
          จด VAT (ราคาที่ลงเป็นก่อน VAT)
        </label>
        {initial && (
          <label className="flex h-11 items-center gap-2 rounded-(--radius) border border-(--line) px-3 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={v.active !== false} onChange={(e) => set("active", e.target.checked)} />
            ยังใช้งาน (ไม่ติ๊ก = ซ่อนจากตัวเลือก)
          </label>
        )}
        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          <span className="font-semibold">หมายเหตุ</span>
          <input className={field} value={v.note} onChange={(e) => set("note", e.target.value)} />
        </label>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <button type="button" onClick={save} disabled={busy || !v.name.trim()} className="inline-flex h-11 items-center justify-center gap-2 rounded-(--radius) bg-(--app) px-4 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50">
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {initial ? "บันทึกการแก้ไข" : "เพิ่มเข้าทะเบียน"}
      </button>
    </div>
  );
}

export function VendorEditToggle({ initial, whtRates }: { initial: VendorInput; whtRates: number[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="text-xs font-medium text-(--app-strong) hover:underline" onClick={() => setOpen(true)}>
        แก้ไข
      </button>
    );
  }
  return (
    <div className="mt-3 rounded-(--radius) border border-(--line) bg-(--bg-soft) p-3">
      <VendorForm initial={initial} whtRates={whtRates} onDone={() => setOpen(false)} />
    </div>
  );
}
