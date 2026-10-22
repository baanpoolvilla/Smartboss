"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";

import { Notice } from "@/modules/requests/components/ui";
import { addRateAction, saveAccessAction, saveItemAction, saveSettingsAction, type SettingsInput } from "../actions";
import { fmtBaht, thaiDate, type SsoParams, type TaxParams } from "../lib/types";
import { card, field, hint, label, labelText, navy, outline } from "./ui";
import { useRun } from "./use-run";

/** ใครเห็น/แก้เงินเดือนได้ — CEO เท่านั้นที่แก้ส่วนนี้ */
export function AccessForm({
  canManage,
  users,
  initial,
}: {
  canManage: boolean;
  users: { id: string; name: string; roles: string }[];
  initial: { editorUserIds: string[]; superAdminAccess: boolean };
}) {
  const [ids, setIds] = useState(initial.editorUserIds);
  const [superOn, setSuperOn] = useState(initial.superAdminAccess);
  const [pick, setPick] = useState("");
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useRun();
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? "ผู้ใช้ที่ปิดไปแล้ว";
  return (
    <section className={`${card} flex flex-col gap-3 border-2 border-(--brand-navy,#1b2537) p-4 sm:p-5`}>
      <div>
        <h2 className="text-base font-bold text-(--ink)">ใครเห็น / แก้ข้อมูลเงินเดือนได้</h2>
        <p className={hint}>CEO เห็นและแก้ได้เสมอ · เพิ่มคนอื่นได้เฉพาะ CEO · HR คนอื่นและผู้ดูแลบริษัท (IT) ไม่เห็นเงินเดือนของใคร · พนักงานทุกคนเห็นสลิปของตัวเอง</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {ids.length === 0 && <span className="text-sm text-(--ink-soft)">ยังไม่ได้เลือกใคร (นอกจาก CEO)</span>}
        {ids.map((id) => (
          <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-(--line) bg-(--bg-soft) py-1 pl-3 pr-1 text-sm">
            {nameOf(id)}
            {canManage && (
              <button type="button" aria-label={`เอา ${nameOf(id)} ออก`} onClick={() => { setSaved(false); setIds(ids.filter((x) => x !== id)); }} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-(--bg)">
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </span>
        ))}
      </div>
      {canManage && (
        <>
          <div className="flex flex-wrap gap-2">
            <select aria-label="เลือกคน" className={`${field} max-w-xs`} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">— เลือกคน (เช่น หัวหน้า HR) —</option>
              {users.filter((u) => !ids.includes(u.id)).map((u) => (
                <option key={u.id} value={u.id}>{u.name}{u.roles ? ` (${u.roles})` : ""}</option>
              ))}
            </select>
            <button type="button" className={outline} disabled={!pick} onClick={() => { setSaved(false); setIds([...ids, pick]); setPick(""); }}>+ เพิ่ม</button>
          </div>
          <label className="flex min-h-11 items-center gap-3 rounded-(--radius) border border-amber-200 bg-amber-50 px-3 text-sm text-amber-950">
            <input type="checkbox" className="h-5 w-5" checked={superOn} onChange={(e) => { setSaved(false); setSuperOn(e.target.checked); }} />
            ผู้ดูแลระบบสูงสุดเห็นข้อมูลเงินเดือนได้ (ช่วงติดตั้ง/แก้ปัญหา) — ปิดเมื่อพร้อมใช้จริง
          </label>
          {error && <Notice tone="danger">{error}</Notice>}
          {saved && <Notice tone="ok">บันทึกแล้ว — สิทธิ์ส่งไปที่ระบบบุคคลแล้ว · CEO คนอื่นได้แจ้งเตือน</Notice>}
          <div>
            <button type="button" className={navy} disabled={busy} onClick={() => run(() => saveAccessAction({ editorUserIds: ids, superAdminAccess: superOn }), () => setSaved(true))}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} บันทึกรายชื่อ
            </button>
          </div>
        </>
      )}
      {!canManage && <p className={hint}>เปลี่ยนรายชื่อได้เฉพาะ CEO</p>}
    </section>
  );
}

/** ตั้งค่าทั่วไป: ข้อมูลบริษัท · งวด/วันจ่าย · การอนุมัติ · สาย/ขาด/ลา · OT */
export function GeneralSettingsForm({ initial }: { initial: SettingsInput }) {
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useRun();
  const set = (p: Partial<SettingsInput>) => { setSaved(false); setV({ ...v, ...p }); };
  const radio = (on: boolean) => `flex min-h-11 items-center gap-3 text-sm ${on ? "font-semibold text-(--ink)" : "text-(--ink-soft)"}`;
  return (
    <div className="flex flex-col gap-4">
      <section className={`${card} flex flex-col gap-3 p-4 sm:p-5`}>
        <h2 className="text-base font-bold text-(--ink)">ข้อมูลบริษัท (ใช้ในไฟล์ประกันสังคม / ภ.ง.ด.1 / ไฟล์โอน)</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={label}><span className={labelText}>เลขผู้เสียภาษีบริษัท (13 หลัก)</span><input inputMode="numeric" className={field} value={v.companyTaxId} onChange={(e) => set({ companyTaxId: e.target.value })} /></label>
          <label className={label}><span className={labelText}>เลขบัญชีนายจ้าง ประกันสังคม (10 หลัก)</span><input inputMode="numeric" className={field} value={v.ssoEmployerNo} onChange={(e) => set({ ssoEmployerNo: e.target.value })} /></label>
          <label className={label}><span className={labelText}>ลำดับที่สาขา (สำนักงานใหญ่ = 000000)</span><input inputMode="numeric" className={field} value={v.ssoBranch} onChange={(e) => set({ ssoBranch: e.target.value })} /></label>
          <label className={label}><span className={labelText}>บัญชีบริษัทที่ใช้จ่ายเงินเดือน</span>
            <div className="grid grid-cols-2 gap-2">
              <input aria-label="ธนาคาร" className={field} value={v.payBankName} onChange={(e) => set({ payBankName: e.target.value })} placeholder="ธนาคาร" />
              <input aria-label="เลขบัญชี" inputMode="numeric" className={field} value={v.payBankAccount} onChange={(e) => set({ payBankAccount: e.target.value })} placeholder="เลขบัญชี" />
            </div>
          </label>
        </div>
      </section>

      <section className={`${card} flex flex-col gap-3 p-4 sm:p-5`}>
        <h2 className="text-base font-bold text-(--ink)">งวดและการอนุมัติ</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={label}><span className={labelText}>ตัดงวดทุกวันที่</span>
            <select className={field} value={v.cutoffDay} onChange={(e) => set({ cutoffDay: Number(e.target.value) })}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d === 31 ? "สิ้นเดือน" : d}</option>)}
            </select>
          </label>
          <label className={label}><span className={labelText}>จ่ายทุกวันที่</span>
            <select className={field} value={v.payDay} onChange={(e) => set({ payDay: Number(e.target.value) })}>
              <option value={0}>สิ้นเดือน</option>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        </div>
        <p className={hint}>เป็นค่าเริ่มต้นตอนสร้างรอบ — แก้วันของแต่ละรอบได้ตอนกด &quot;สร้างใหม่&quot;</p>
        <div role="radiogroup" aria-label="การอนุมัติ" className="flex flex-col">
          <label className={radio(v.approvalMode === "ceo")}><input type="radio" className="h-4 w-4" checked={v.approvalMode === "ceo"} onChange={() => set({ approvalMode: "ceo" })} /> CEO อนุมัติทุกงวด (แนะนำ)</label>
          <label className={radio(v.approvalMode === "ceo_on_change")}>
            <input type="radio" className="h-4 w-4" checked={v.approvalMode === "ceo_on_change"} onChange={() => set({ approvalMode: "ceo_on_change" })} />
            CEO อนุมัติเฉพาะเมื่อยอดต่างจากงวดก่อนเกิน
            <input aria-label="เปอร์เซ็นต์" inputMode="decimal" className={`${field} h-9 w-20`} value={v.changeThreshold} onChange={(e) => set({ changeThreshold: Number(e.target.value) || 0 })} />% หรือ HR เพิ่ม/ปรับรายการเอง
          </label>
          <label className={radio(v.approvalMode === "hr")}><input type="radio" className="h-4 w-4" checked={v.approvalMode === "hr"} onChange={() => set({ approvalMode: "hr" })} /> HR อนุมัติเอง (CEO ได้แจ้งเตือน)</label>
        </div>
      </section>

      <section className={`${card} flex flex-col gap-2 p-4 sm:p-5`}>
        <h2 className="text-base font-bold text-(--ink)">สาย / ขาด / ลา / OT</h2>
        <label className="flex min-h-11 flex-wrap items-center gap-3 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={v.deductLate} onChange={(e) => set({ deductLate: e.target.checked })} /> หักเงินมาสาย / กลับก่อน
          {v.deductLate && (
            <span className="flex flex-wrap items-center gap-2">
              <select aria-label="วิธีหักสาย" className={`${field} h-9 w-auto`} value={v.lateMode} onChange={(e) => set({ lateMode: e.target.value as SettingsInput["lateMode"] })}>
                <option value="minute">ตามนาทีจริง (เงินเดือน ÷ 30 ÷ 8 ÷ 60)</option>
                <option value="per_time">เป็นครั้ง</option>
              </select>
              {v.lateMode === "per_time" && <><span>ครั้งละ</span><input aria-label="บาทต่อครั้ง" inputMode="decimal" className={`${field} h-9 w-24`} value={v.latePerTime} onChange={(e) => set({ latePerTime: Number(e.target.value) || 0 })} /><span>บาท</span></>}
            </span>
          )}
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={v.deductAbsent} onChange={(e) => set({ deductAbsent: e.target.checked })} /> หักเงินขาดงาน (เงินเดือน ÷ 30 ต่อวัน)</label>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={v.deductUnpaidLeave} onChange={(e) => set({ deductUnpaidLeave: e.target.checked })} /> หักลาไม่รับค่าจ้าง เฉพาะวันที่ลง (เงินเดือน ÷ 30 ต่อวัน)</label>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={v.otSsoBase} onChange={(e) => set({ otSsoBase: e.target.checked })} /> นับค่า OT เป็นค่าจ้างคิดประกันสังคม (ตามนิยามค่าจ้างใน พ.ร.บ.ประกันสังคม — ให้นักบัญชียืนยัน)</label>
        <p className={hint}>ปิดสาย/ขาด = มีผลแค่คะแนนและเกรดเหมือนเดิม · OT ดึงจากใบที่อนุมัติในเบิกจ่าย &amp; OT เอง</p>
      </section>

      {error && <Notice tone="danger">{error}</Notice>}
      {saved && <Notice tone="ok">บันทึกแล้ว</Notice>}
      <div className="flex justify-end">
        <button type="button" className={navy} disabled={busy} onClick={() => run(() => saveSettingsAction(v), () => setSaved(true))}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} บันทึกตั้งค่า
        </button>
      </div>
    </div>
  );
}

/** อัตราประกันสังคม — มีวันเริ่มมีผล ปรับ = เพิ่มอัตราใหม่ (งวดเก่าคิดด้วยอัตราเดิม) */
export function SsoRates({ current, history, isDefault }: { current: SsoParams; history: { from: string; p: SsoParams }[]; isDefault: boolean }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(current);
  const [from, setFrom] = useState("");
  const { busy, error, run } = useRun();
  const num = (k: keyof SsoParams) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value.replace(/,/g, "")) || 0 });
  return (
    <section className={`${card} flex flex-col gap-3 p-4 sm:p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-(--ink)">ประกันสังคม (มาตรา 33)</h2>
        {!open && <button type="button" className="text-sm font-semibold text-(--app-strong) underline" onClick={() => setOpen(true)}>เพิ่มอัตราใหม่</button>}
      </div>
      <p className="text-sm">
        ตอนนี้: ลูกจ้าง {current.employeeRate}% · บริษัท {current.employerRate}% · ค่าจ้างที่ใช้คิด {fmtBaht(current.wageFloor)} – {fmtBaht(current.wageCeiling)} · สมทบสูงสุด {fmtBaht(current.maxContribution)}/เดือน
        {isDefault && <span className="text-(--ink-soft)"> (ค่าตั้งต้นปี 2569)</span>}
      </p>
      {history.length > 0 && <p className={hint}>ประวัติ: {history.map((h) => `${thaiDate(h.from)} เพดาน ${fmtBaht(h.p.wageCeiling)}`).join(" · ")}</p>}
      {open && (
        <div className="grid grid-cols-2 gap-3 rounded-(--radius) border border-dashed border-(--line) bg-(--bg-soft) p-3 sm:grid-cols-3">
          <label className={label}><span className={labelText}>มีผลตั้งแต่</span><input type="date" className={field} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className={label}><span className={labelText}>ลูกจ้าง %</span><input inputMode="decimal" className={field} defaultValue={v.employeeRate} onChange={num("employeeRate")} /></label>
          <label className={label}><span className={labelText}>บริษัท %</span><input inputMode="decimal" className={field} defaultValue={v.employerRate} onChange={num("employerRate")} /></label>
          <label className={label}><span className={labelText}>ค่าจ้างต่ำสุดที่ใช้คิด</span><input inputMode="decimal" className={field} defaultValue={v.wageFloor} onChange={num("wageFloor")} /></label>
          <label className={label}><span className={labelText}>เพดานค่าจ้าง</span><input inputMode="decimal" className={field} defaultValue={v.wageCeiling} onChange={num("wageCeiling")} /></label>
          <label className={label}><span className={labelText}>สมทบสูงสุด/เดือน</span><input inputMode="decimal" className={field} defaultValue={v.maxContribution} onChange={num("maxContribution")} /></label>
          <div className="col-span-2 flex gap-2 sm:col-span-3">
            <button type="button" className={outline} onClick={() => setOpen(false)} disabled={busy}>ยกเลิก</button>
            <button type="button" className={navy} disabled={busy || !from} onClick={() => run(() => addRateAction({ kind: "sso", effectiveFrom: from, params: v }), () => setOpen(false))}>บันทึกอัตราใหม่</button>
          </div>
        </div>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </section>
  );
}

export function TaxRates({ current, isDefault }: { current: TaxParams; isDefault: boolean }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(current);
  const [from, setFrom] = useState("");
  const { busy, error, run } = useRun();
  return (
    <section className={`${card} flex flex-col gap-3 p-4 sm:p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-(--ink)">ภาษีหัก ณ ที่จ่าย</h2>
        {!open && <button type="button" className="text-sm font-semibold text-(--app-strong) underline" onClick={() => setOpen(true)}>เพิ่มอัตราใหม่</button>}
      </div>
      <p className="text-sm">
        หักค่าใช้จ่าย {current.expenseRate}% ไม่เกิน {fmtBaht(current.expenseCap)} · ลดหย่อนส่วนตัว {fmtBaht(current.personalAllowance)}
        {isDefault && <span className="text-(--ink-soft)"> (ค่าตั้งต้นปัจจุบัน)</span>}
      </p>
      <p className="text-xs text-(--ink-soft)">
        ขั้นบันได: {current.brackets.map((b, i) => `${i === 0 ? "0" : fmtBaht(current.brackets[i - 1]!.upTo ?? 0)}–${b.upTo === null ? "ขึ้นไป" : fmtBaht(b.upTo)} ${b.rate}%`).join(" · ")}
      </p>
      <p className={hint}>วิธีคิด: ประมาณเงินได้ทั้งปี → หักค่าใช้จ่าย → หักลดหย่อน → คิดขั้นบันได → หักที่หักไปแล้ว → หารงวดที่เหลือ · โบนัส/OT คิดภาษีเฉพาะงวดที่จ่าย</p>
      {open && (
        <div className="flex flex-col gap-3 rounded-(--radius) border border-dashed border-(--line) bg-(--bg-soft) p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className={label}><span className={labelText}>มีผลตั้งแต่</span><input type="date" className={field} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className={label}><span className={labelText}>หักค่าใช้จ่าย %</span><input inputMode="decimal" className={field} defaultValue={v.expenseRate} onChange={(e) => setV({ ...v, expenseRate: Number(e.target.value) || 0 })} /></label>
            <label className={label}><span className={labelText}>ไม่เกิน (บาท)</span><input inputMode="decimal" className={field} defaultValue={v.expenseCap} onChange={(e) => setV({ ...v, expenseCap: Number(e.target.value.replace(/,/g, "")) || 0 })} /></label>
            <label className={label}><span className={labelText}>ลดหย่อนส่วนตัว</span><input inputMode="decimal" className={field} defaultValue={v.personalAllowance} onChange={(e) => setV({ ...v, personalAllowance: Number(e.target.value.replace(/,/g, "")) || 0 })} /></label>
          </div>
          <div className="text-sm font-semibold">ขั้นบันได (เงินได้สุทธิถึง · อัตรา %)</div>
          {v.brackets.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem] gap-2">
              <input aria-label={`ขั้นที่ ${i + 1} ถึง`} inputMode="decimal" className={field} value={b.upTo === null ? "" : String(b.upTo)} placeholder="ขึ้นไป (ขั้นสุดท้าย)" disabled={i === v.brackets.length - 1} onChange={(e) => setV({ ...v, brackets: v.brackets.map((x, j) => (j === i ? { ...x, upTo: Number(e.target.value.replace(/,/g, "")) || 0 } : x)) })} />
              <input aria-label={`ขั้นที่ ${i + 1} อัตรา`} inputMode="decimal" className={field} value={String(b.rate)} onChange={(e) => setV({ ...v, brackets: v.brackets.map((x, j) => (j === i ? { ...x, rate: Number(e.target.value) || 0 } : x)) })} />
            </div>
          ))}
          <div className="flex gap-2">
            <button type="button" className={outline} onClick={() => setOpen(false)} disabled={busy}>ยกเลิก</button>
            <button type="button" className={navy} disabled={busy || !from} onClick={() => run(() => addRateAction({ kind: "tax", effectiveFrom: from, params: v }), () => setOpen(false))}>บันทึกอัตราใหม่</button>
          </div>
        </div>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </section>
  );
}

/** ชื่อรายการปรับเพิ่ม/ปรับลด ของบริษัท */
export function ItemsList({ items }: { items: { id: string; name: string; kind: "earning" | "deduction"; taxable: boolean; ssoBase: boolean; active: boolean }[] }) {
  const [adding, setAdding] = useState(false);
  const [n, setN] = useState({ name: "", kind: "earning" as "earning" | "deduction", taxable: true, ssoBase: false });
  const { busy, error, run } = useRun();
  return (
    <section className={`${card} flex flex-col gap-3 p-4 sm:p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-(--ink)">ชื่อรายการปรับเพิ่ม / ปรับลด</h2>
        {!adding && <button type="button" className="text-sm font-semibold text-(--app-strong) underline" onClick={() => setAdding(true)}>+ เพิ่มชื่อรายการ</button>}
      </div>
      <p className={hint}>ใช้เลือกตอนเพิ่มรายการรายคน · ธงภาษี/ประกันสังคมเป็นค่าตั้งต้นที่พบบ่อย ให้นักบัญชีตรวจ · &quot;อื่นๆ (พิมพ์เอง)&quot; มีให้เสมอ</p>
      {adding && (
        <div className="grid grid-cols-1 gap-2 rounded-(--radius) border border-dashed border-(--line) bg-(--bg-soft) p-3 sm:grid-cols-[1fr_auto]">
          <input aria-label="ชื่อรายการ" className={field} value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} placeholder="ชื่อรายการ" />
          <select aria-label="ชนิด" className={field} value={n.kind} onChange={(e) => setN({ ...n, kind: e.target.value as "earning" | "deduction" })}>
            <option value="earning">ปรับเพิ่ม (เงินได้)</option>
            <option value="deduction">ปรับลด (รายการหัก)</option>
          </select>
          {n.kind === "earning" && (
            <div className="flex flex-wrap gap-4 text-sm sm:col-span-2">
              <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={n.taxable} onChange={(e) => setN({ ...n, taxable: e.target.checked })} /> คิดภาษี</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={n.ssoBase} onChange={(e) => setN({ ...n, ssoBase: e.target.checked })} /> นับเป็นค่าจ้างคิดประกันสังคม</label>
            </div>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" className={outline} onClick={() => setAdding(false)} disabled={busy}>ยกเลิก</button>
            <button type="button" className={navy} disabled={busy || !n.name.trim()} onClick={() => run(() => saveItemAction({ ...n, active: true }), () => { setAdding(false); setN({ name: "", kind: "earning", taxable: true, ssoBase: false }); })}>เพิ่ม</button>
          </div>
        </div>
      )}
      <ul className="flex flex-col divide-y divide-(--line)">
        {items.map((it) => (
          <ItemRow key={it.id} it={it} />
        ))}
      </ul>
      {error && <Notice tone="danger">{error}</Notice>}
    </section>
  );
}

function ItemRow({ it }: { it: { id: string; name: string; kind: "earning" | "deduction"; taxable: boolean; ssoBase: boolean; active: boolean } }) {
  const { busy, error, run } = useRun();
  const save = (patch: Partial<typeof it>) => run(() => saveItemAction({ ...it, ...patch }));
  return (
    <li className={`flex flex-wrap items-center justify-between gap-2 py-2 text-sm ${it.active ? "" : "opacity-60"}`}>
      <span><strong>{it.name}</strong> · {it.kind === "earning" ? "ปรับเพิ่ม" : "ปรับลด"}</span>
      <span className="flex flex-wrap items-center gap-3 text-xs">
        {it.kind === "earning" && (
          <>
            <label className="flex items-center gap-1.5"><input type="checkbox" className="h-4 w-4" checked={it.taxable} disabled={busy} onChange={(e) => save({ taxable: e.target.checked })} /> คิดภาษี</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" className="h-4 w-4" checked={it.ssoBase} disabled={busy} onChange={(e) => save({ ssoBase: e.target.checked })} /> คิดประกันสังคม</label>
          </>
        )}
        <button type="button" className="font-semibold text-(--app-strong) underline" disabled={busy} onClick={() => save({ active: !it.active })}>{it.active ? "ปิดใช้" : "เปิดใช้"}</button>
      </span>
      {error && <span className="w-full text-xs text-red-700">{error}</span>}
    </li>
  );
}
