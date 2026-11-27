"use client";

import { useState } from "react";
import { Building2, Loader2, Plus } from "lucide-react";

import { Notice } from "@/modules/requests/components/ui";
import { retireCompanyAction, saveCompanyAction, setPayCompanyAction, type CompanyInput } from "../actions";
import type { PayCompany } from "../lib/companies";
import { card, field, hint, label, labelText, navy, outline } from "./ui";
import { useRun } from "./use-run";

/**
 * บริษัทที่ออกเงินเดือน (ผู้ใช้ 27/11/2569) — การ์ดละบริษัท เพิ่ม/แก้/เลิกใช้
 * บริษัทหลัก = กล่อง "ข้อมูลบริษัท" ด้านบน (แก้ที่นั่น) · ที่นี่แก้ได้เฉพาะบริษัทที่เพิ่มเอง
 */
export function CompaniesSection({ companies, people }: { companies: PayCompany[]; people: Record<string, number> }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const { busy, error, run } = useRun();
  const shown = companies.filter((c) => !c.retired);
  const retired = companies.filter((c) => c.retired);
  return (
    <section className={`${card} flex flex-col gap-3 p-4 sm:p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-(--ink)">บริษัทที่ออกเงินเดือน ({shown.length})</h2>
        {editing === null && (
          <button type="button" className={outline} onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" aria-hidden /> เพิ่มบริษัท
          </button>
        )}
      </div>
      <p className={hint}>
        มีหลายบริษัท: เลือกรายคนได้ที่แท็บพนักงาน ว่าใครออกเงินเดือนในนามบริษัทไหน · รอบเงินเดือนยังทำรอบเดียว แต่แยกยอด สลิป และไฟล์ประกันสังคม / ภ.ง.ด.1 / ไฟล์โอนตามบริษัท ·
        คนที่ยังไม่ได้เลือกอยู่บริษัทหลัก
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((c) =>
          editing === c.id ? (
            <CompanyForm key={c.id} initial={c} onDone={() => setEditing(null)} />
          ) : (
            <div key={c.id} className="flex min-w-0 flex-col gap-2 rounded-(--radius-lg) border border-(--line) p-3">
              <div className="flex flex-wrap items-center gap-2 font-bold text-(--ink)">
                <Building2 className="h-4 w-4 shrink-0 text-(--ink-soft)" aria-hidden />
                <span className="min-w-0 break-words">{c.name}</span>
                {c.main && <span className="rounded-md bg-(--bg-soft) px-2 py-0.5 text-[11px] font-semibold text-(--ink-soft)">หลัก</span>}
              </div>
              <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs">
                <dt className="text-(--ink-soft)">เลขผู้เสียภาษี</dt><dd className="break-words">{c.taxId || "ยังไม่ได้ใส่"}</dd>
                <dt className="text-(--ink-soft)">สาขา</dt><dd>{c.branch}{c.branch === "000000" ? " (สำนักงานใหญ่)" : ""}</dd>
                <dt className="text-(--ink-soft)">เลขนายจ้าง สปส.</dt><dd className="break-words">{c.ssoEmployerNo || "ยังไม่ได้ใส่"}</dd>
                <dt className="text-(--ink-soft)">บัญชีจ่ายเงินเดือน</dt><dd className="break-words">{[c.payBankName, c.payBankAccount].filter(Boolean).join(" ") || "ยังไม่ได้ใส่"}</dd>
                <dt className="text-(--ink-soft)">ที่อยู่บนสลิป</dt><dd className="break-words">{c.address || "ไม่แสดง"}</dd>
                <dt className="text-(--ink-soft)">พนักงาน</dt><dd>{people[c.id] ?? 0} คน</dd>
              </dl>
              {c.main ? (
                <p className={hint}>แก้ที่กล่อง &quot;ข้อมูลบริษัท&quot; ด้านบน</p>
              ) : (
                editing === null && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={`${outline} h-9 px-3 text-xs`} onClick={() => setEditing(c.id)}>แก้ไข</button>
                    <button
                      type="button"
                      className={`${outline} h-9 px-3 text-xs`}
                      disabled={busy || (people[c.id] ?? 0) > 0}
                      title={(people[c.id] ?? 0) > 0 ? "ย้ายพนักงานไปบริษัทอื่นก่อน" : undefined}
                      onClick={() => {
                        if (confirm(`เลิกใช้ "${c.name}"? (รอบเงินเดือนเก่ายังเห็นชื่อเดิม · กลับมาใช้ใหม่ได้)`)) run(() => retireCompanyAction({ id: c.id, retire: true }));
                      }}
                    >
                      เลิกใช้
                    </button>
                  </div>
                )
              )}
            </div>
          ),
        )}
        {editing === "new" && <CompanyForm onDone={() => setEditing(null)} />}
      </div>
      {retired.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-(--ink-soft)">
          เลิกใช้แล้ว:
          {retired.map((c) => (
            <button key={c.id} type="button" disabled={busy} className="rounded-md border border-(--line) px-2 py-1 hover:bg-(--bg-soft)" onClick={() => run(() => retireCompanyAction({ id: c.id, retire: false }))}>
              {c.name} · กลับมาใช้
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function CompanyForm({ initial, onDone }: { initial?: PayCompany; onDone: () => void }) {
  const [v, setV] = useState<CompanyInput>({
    id: initial?.id,
    name: initial?.name ?? "",
    taxId: initial?.taxId ?? "",
    branch: initial?.branch ?? "000000",
    ssoEmployerNo: initial?.ssoEmployerNo ?? "",
    payBankName: initial?.payBankName ?? "",
    payBankAccount: initial?.payBankAccount ?? "",
    address: initial?.address ?? "",
  });
  const { busy, error, run } = useRun();
  const set = (p: Partial<CompanyInput>) => setV({ ...v, ...p });
  return (
    <form
      className="flex min-w-0 flex-col gap-2 rounded-(--radius-lg) border-2 border-(--brand-navy,#1b2537) p-3 md:col-span-2 xl:col-span-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveCompanyAction(v), onDone);
      }}
    >
      <div className="text-sm font-bold">{initial ? `แก้ไข ${initial.name}` : "เพิ่มบริษัทที่ออกเงินเดือน"}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={`${label} sm:col-span-2`}><span className={labelText}>ชื่อบริษัท (ตามที่จดทะเบียน)</span><input required className={field} value={v.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className={label}><span className={labelText}>เลขผู้เสียภาษี (13 หลัก)</span><input inputMode="numeric" className={field} value={v.taxId} onChange={(e) => set({ taxId: e.target.value })} /></label>
        <label className={label}><span className={labelText}>ลำดับที่สาขา (สำนักงานใหญ่ = 000000)</span><input inputMode="numeric" className={field} value={v.branch} onChange={(e) => set({ branch: e.target.value })} /></label>
        <label className={label}><span className={labelText}>เลขบัญชีนายจ้าง ประกันสังคม (10 หลัก)</span><input inputMode="numeric" className={field} value={v.ssoEmployerNo} onChange={(e) => set({ ssoEmployerNo: e.target.value })} /></label>
        <label className={label}><span className={labelText}>บัญชีบริษัทที่ใช้จ่ายเงินเดือน</span>
          <div className="grid grid-cols-2 gap-2">
            <input aria-label="ธนาคาร" className={field} value={v.payBankName} onChange={(e) => set({ payBankName: e.target.value })} placeholder="ธนาคาร" />
            <input aria-label="เลขบัญชี" inputMode="numeric" className={field} value={v.payBankAccount} onChange={(e) => set({ payBankAccount: e.target.value })} placeholder="เลขบัญชี" />
          </div>
        </label>
        <label className={`${label} sm:col-span-2`}><span className={labelText}>ที่อยู่บริษัท (แสดงบนหัวสลิป · เว้นว่างได้)</span>
          <textarea rows={2} className={`${field} h-auto py-2`} value={v.address} onChange={(e) => set({ address: e.target.value })} />
        </label>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={navy} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}บันทึก</button>
        <button type="button" className={outline} disabled={busy} onClick={onDone}>ยกเลิก</button>
      </div>
    </form>
  );
}

/** เลือกบริษัทรายคน — ในตารางพนักงานและหน้าพนักงาน · เปลี่ยนแล้วบันทึกทันที */
export function PayCompanySelect({ employmentId, value, companies, name }: { employmentId: string; value: string; companies: PayCompany[]; name: string }) {
  const { busy, error, run } = useRun();
  const options = companies.filter((c) => !c.retired || c.id === value);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <select
        aria-label={`ออกเงินเดือนในนามบริษัท — ${name}`}
        className={`${field} h-9 min-w-[11rem] text-xs`}
        value={value}
        disabled={busy}
        onChange={(e) => run(() => setPayCompanyAction({ employmentIds: [employmentId], companyId: e.target.value }))}
      >
        {options.map((c) => <option key={c.id} value={c.id}>{c.name}{c.retired ? " (เลิกใช้)" : ""}</option>)}
      </select>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

/** ย้ายหลายคนพร้อมกัน — ติ๊กชื่อแล้วเลือกบริษัทปลายทาง */
export function BulkCompanyMove({ staff, companies }: { staff: { employmentId: string; name: string; companyId: string }[]; companies: PayCompany[] }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const active = companies.filter((c) => !c.retired);
  const [to, setTo] = useState(active[0]?.id ?? "");
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run } = useRun();
  const nameOf = (id: string) => companies.find((c) => c.id === id)?.name ?? "";
  if (!open) {
    return (
      <button type="button" className={`${outline} self-start`} onClick={() => { setOpen(true); setDone(null); }}>
        <Building2 className="h-4 w-4" aria-hidden /> ย้ายบริษัทหลายคนพร้อมกัน
      </button>
    );
  }
  return (
    <section className={`${card} flex flex-col gap-3 p-4`}>
      <div className="flex flex-wrap items-end gap-3">
        <label className={label}><span className={labelText}>ย้ายไปออกเงินเดือนในนาม</span>
          <select className={`${field} min-w-[14rem]`} value={to} onChange={(e) => setTo(e.target.value)}>
            {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <button
          type="button"
          className={navy}
          disabled={busy || picked.length === 0}
          onClick={() =>
            run(
              () => setPayCompanyAction({ employmentIds: picked, companyId: to }),
              () => { setDone(`ย้าย ${picked.length} คนไป "${nameOf(to)}" แล้ว`); setPicked([]); },
            )
          }
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}ย้าย {picked.length} คน
        </button>
        <button type="button" className={outline} onClick={() => setOpen(false)}>ปิด</button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {done && <Notice tone="ok">{done}</Notice>}
      <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {staff.map((s) => (
          <label key={s.employmentId} className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={picked.includes(s.employmentId)}
              onChange={(e) => setPicked(e.target.checked ? [...picked, s.employmentId] : picked.filter((x) => x !== s.employmentId))}
            />
            <span className="min-w-0 truncate">{s.name}</span>
            <span className="shrink-0 text-xs text-(--ink-soft)">· {nameOf(s.companyId)}</span>
          </label>
        ))}
      </div>
      <p className={hint}>มีผลกับรอบที่ยังเป็นร่างเมื่อกดคำนวณใหม่ · รอบที่ส่งอนุมัติ/จ่ายแล้วไม่เปลี่ยน · บันทึกใน Log การบันทึกระบบบุคคล</p>
    </section>
  );
}
