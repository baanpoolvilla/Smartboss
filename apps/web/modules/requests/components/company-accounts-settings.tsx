"use client";

import { Plus, Trash2 } from "lucide-react";

import type { CompanyAccount } from "../lib/company-accounts";

const field = "h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 text-sm text-(--ink)";

export interface AccountsState {
  companyAccounts: CompanyAccount[];
  whtCompanyOnly: boolean;
  whtBorneAllowed: boolean;
  payerName: string;
  payerTaxId: string;
  payerAddress: string;
}

/**
 * ช่องทางการเงินของบริษัท + ผู้จ่ายเงินใน 50 ทวิ (ลอกแนว PEAK — ผู้ใช้ 22/11/2569)
 * บัญชีธนาคารบริษัท → เลือกตอนบันทึกโอน · สวิตช์ "หัก ณ ที่จ่ายต้องโอนจากบัญชีบริษัท" (ปิด = แบบเดิม)
 */
export function CompanyAccountsSettings({ value, onChange }: { value: AccountsState; onChange: (v: AccountsState) => void }) {
  const set = (patch: Partial<AccountsState>) => onChange({ ...value, ...patch });
  const setAcc = (i: number, patch: Partial<CompanyAccount>) => set({ companyAccounts: value.companyAccounts.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  return (
    <section className="flex flex-col gap-4 rounded-(--radius-lg) border border-(--line) bg-(--bg) p-4">
      <div>
        <h2 className="text-sm font-bold text-(--ink)">บัญชีธนาคารบริษัท (ช่องทางการเงิน)</h2>
        <p className="text-xs text-(--ink-soft)">ตอนบันทึกโอนเลือกได้ว่าโอนจากบัญชีไหน · ระบบอ่านชื่อ/เลขบัญชีผู้โอนจากสลิปมาเทียบให้ · Excel รายงานมีคอลัมน์ “โอนจากบัญชี”</p>
      </div>
      {value.companyAccounts.map((a, i) => (
        <div key={a.id} className="grid grid-cols-1 gap-2 rounded-(--radius) border border-(--line) p-3 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
          <input className={field} value={a.bankName} onChange={(e) => setAcc(i, { bankName: e.target.value })} placeholder="ธนาคาร เช่น กสิกรไทย" aria-label={`ธนาคารบัญชีที่ ${i + 1}`} />
          <input className={field} value={a.accountNo} onChange={(e) => setAcc(i, { accountNo: e.target.value })} placeholder="เลขบัญชี" inputMode="numeric" aria-label={`เลขบัญชีที่ ${i + 1}`} />
          <input className={field} value={a.accountName} onChange={(e) => setAcc(i, { accountName: e.target.value })} placeholder="ชื่อบัญชี (ตรงกับในสลิป)" aria-label={`ชื่อบัญชีที่ ${i + 1}`} />
          <button type="button" onClick={() => set({ companyAccounts: value.companyAccounts.filter((_, j) => j !== i) })} aria-label={`ลบบัญชีที่ ${i + 1}`} className="flex h-11 w-11 items-center justify-center rounded-(--radius) border border-(--line) text-(--ink-soft) hover:bg-(--bg-soft)">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => set({ companyAccounts: [...value.companyAccounts, { id: `acc-${Date.now().toString(36)}`, bankName: "", accountNo: "", accountName: "" }] })}
        className="inline-flex items-center gap-1 self-start text-sm font-medium text-(--app-strong) hover:underline"
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> เพิ่มบัญชีบริษัท
      </button>

      <label className="flex items-start gap-3 text-sm text-(--ink)">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={value.whtCompanyOnly} onChange={(e) => set({ whtCompanyOnly: e.target.checked })} />
        <span>
          รายการที่หัก ณ ที่จ่าย ต้องโอนจากบัญชีบริษัทเท่านั้น
          <span className="block text-xs text-(--ink-soft)">ค่าช่าง/ค่าบริการที่หักภาษี (เช่น 3%) จ่ายเงินสด/เงินสดย่อย/บัญชีส่วนตัวไม่ได้ ต้องเลือกบัญชีบริษัท + แนบสลิป · เงินสดย่อย “ซื้อของเอง” ที่มีหัก ณ ที่จ่ายจะให้ลงเป็นใบ “จ่ายช่าง / ร้านค้า” แทน</span>
        </span>
      </label>

      <label className="flex items-start gap-3 text-sm text-(--ink)">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={value.whtBorneAllowed} onChange={(e) => set({ whtBorneAllowed: e.target.checked })} />
        <span>
          ให้ลงใบที่จ่ายร้านไปเต็มแล้ว (ไม่ได้หัก) — บริษัทออกภาษีให้
          <span className="block text-xs text-(--ink-soft)">ใบ “จ่ายช่าง / ร้านค้า” มีช่องติ๊ก “จ่ายไปเต็มแล้ว” · ระบบคิดภาษีที่บริษัทต้องนำส่งเอง (เช่น จ่ายไป 1,500 → ภาษี 46.39) · ต้องให้ CEO อนุมัติทุกใบ · 50 ทวิ ติ๊ก “ออกให้ครั้งเดียว”</span>
        </span>
      </label>

      <div className="h-px bg-(--line)" />
      <div>
        <h3 className="text-sm font-semibold text-(--ink)">ผู้จ่ายเงิน ในหนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)</h3>
        <p className="text-xs text-(--ink-soft)">ใช้พิมพ์ 50 ทวิจากใบที่จ่ายแล้ว (ปุ่มในใบ “จ่ายช่าง / ร้านค้า”)</p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input className={field} value={value.payerName} onChange={(e) => set({ payerName: e.target.value })} placeholder="ชื่อบริษัท (ตามหนังสือรับรอง)" aria-label="ชื่อผู้จ่ายเงิน" />
        <input className={field} value={value.payerTaxId} onChange={(e) => set({ payerTaxId: e.target.value })} placeholder="เลขประจำตัวผู้เสียภาษี 13 หลัก" inputMode="numeric" aria-label="เลขผู้เสียภาษีผู้จ่ายเงิน" />
        <input className={`${field} sm:col-span-2`} value={value.payerAddress} onChange={(e) => set({ payerAddress: e.target.value })} placeholder="ที่อยู่บริษัท" aria-label="ที่อยู่ผู้จ่ายเงิน" />
      </div>
    </section>
  );
}
