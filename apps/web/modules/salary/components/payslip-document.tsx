import type { PayLine } from "../lib/compute";
import type { SlipData } from "../lib/views";
import { fmtBaht, thaiDate } from "../lib/types";

/**
 * สลิปเงินเดือนแบบเอกสาร (ผู้ใช้ส่งตัวอย่างมา 28/10/2569) — หัวบริษัท · ชื่อเอกสาร · ข้อมูลพนักงาน · รอบ/วันจ่าย/บัญชี
 * ตาราง 3 ช่อง: เงินได้ · รายการหัก · ยอดสะสมทั้งปี + สรุปสุทธิ · หมายเหตุ · ลายเซ็น · ข้อความรักษาความลับ
 * แถวมาตรฐานขึ้นเสมอแม้เป็น 0 (แบบสลิปทั่วไป) · แถวที่บริษัทไม่ได้ใช้ (ภาษีเมื่อปิดภาษี, กยศ.) ไม่ขึ้น
 * รายการที่รวมเป็น "อื่นๆ" แจกแจงชื่อรายการไว้ใต้แถว — พนักงานรู้ว่าได้/โดนหักอะไร
 * จอแคบ: 3 ช่องเรียงลงมาเป็นแถวเดียว · พิมพ์: แนวนอน A4
 */

const ALLOWANCE = /เบี้ยเลี้ยง|ครองชีพ|ค่าตำแหน่ง|ค่าเดินทาง|ค่าน้ำมัน|ค่าโทร|ค่าที่พัก|ค่าอาหาร/;
const BONUS = /โบนัส|bonus/i;
const STUDENT_LOAN = /กยศ|กรอ/;

interface Row {
  th: string;
  en: string;
  amount: number;
  items?: PayLine[];
  /** แถวรวมหลายชื่อ (อื่นๆ/โบนัส/เบี้ยเลี้ยง) — แจกแจงชื่อเสมอ · แถวอื่นแจกแจงเมื่อมีหลายรายการ */
  bucket?: boolean;
}

const sum = (xs: PayLine[]) => Math.round(xs.reduce((n, x) => n + Math.round(x.amount * 100), 0)) / 100;

function earningRows(lines: PayLine[]): Row[] {
  const earn = lines.filter((x) => x.kind === "earning");
  const pick = (pred: (x: PayLine) => boolean) => earn.filter(pred);
  const salary = pick((x) => x.source === "salary");
  const ot = pick((x) => x.source === "ot");
  const comm = pick((x) => x.source === "commission");
  const dil = pick((x) => x.source === "diligence");
  const rest = pick((x) => !["salary", "ot", "commission", "diligence"].includes(x.source));
  const bonus = rest.filter((x) => BONUS.test(x.label));
  const allow = rest.filter((x) => !BONUS.test(x.label) && ALLOWANCE.test(x.label));
  const other = rest.filter((x) => !bonus.includes(x) && !allow.includes(x));
  return [
    { th: "เงินเดือน/ค่าจ้าง", en: "Salary/Wage", amount: sum(salary) },
    { th: "ค่าล่วงเวลา", en: "Overtime", amount: sum(ot) },
    { th: "ค่านายหน้า/ค่าคอมมิชชัน", en: "Commission", amount: sum(comm) },
    ...(dil.length ? [{ th: "เบี้ยขยัน", en: "Diligence allowance", amount: sum(dil) }] : []),
    { th: "ค่าเบี้ยเลี้ยง/ค่าครองชีพ", en: "Allowances/Cost of living", amount: sum(allow), items: allow, bucket: true },
    { th: "โบนัส", en: "Bonus", amount: sum(bonus), items: bonus, bucket: true },
    { th: "เงินได้อื่นๆ", en: "Others", amount: sum(other), items: other, bucket: true },
  ];
}

function deductionRows(lines: PayLine[]): Row[] {
  const ded = lines.filter((x) => x.kind === "deduction");
  const pick = (pred: (x: PayLine) => boolean) => ded.filter(pred);
  const sso = pick((x) => x.key === "sso");
  const tax = pick((x) => x.key === "tax");
  const adv = pick((x) => x.source === "advance");
  const absent = pick((x) => ["unpaid_leave", "absent", "late"].includes(x.source));
  const rest = pick((x) => !["sso", "tax"].includes(x.key) && !["advance", "unpaid_leave", "absent", "late"].includes(x.source));
  const loan = rest.filter((x) => STUDENT_LOAN.test(x.label));
  const other = rest.filter((x) => !loan.includes(x));
  return [
    { th: "ประกันสังคม", en: "Social Security Fund", amount: sum(sso) },
    // บริษัทปิดการคิดภาษี = ไม่มีบรรทัดภาษีในรอบ → ไม่ขึ้นแถวนี้
    ...(tax.length ? [{ th: "ภาษีหัก ณ ที่จ่าย", en: "Withholding tax", amount: sum(tax) }] : []),
    ...(loan.length ? [{ th: "เงินกู้ยืม กยศ./กรอ.", en: "Student Loan Fund", amount: sum(loan), items: loan, bucket: true }] : []),
    { th: "เงินเบิกล่วงหน้า", en: "Advance", amount: sum(adv), items: adv },
    { th: "ขาด/ลา/มาสาย", en: "Absent/Leave/Late", amount: sum(absent), items: absent },
    { th: "รายการหักอื่นๆ", en: "Others", amount: sum(other), items: other, bucket: true },
  ];
}

function Cell({ r }: { r: Row }) {
  return (
    <div className="flex flex-col py-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] leading-tight text-(--ink)">{r.th}</span>
        <span className="whitespace-nowrap text-[13px] tabular-nums text-(--ink)">{fmtBaht(r.amount)}</span>
      </div>
      <span className="text-[10.5px] leading-tight text-(--ink-soft)">{r.en}</span>
      {r.items && r.items.length > 0 && (r.items.length > 1 || (r.bucket && r.items[0]!.label !== r.th)) && (
        <ul className="mt-0.5 flex flex-col pl-2 text-[11px] leading-snug text-(--ink-soft)">
          {r.items.map((x) => (
            <li key={x.key} className="flex justify-between gap-2">
              <span>· {x.label}</span>
              <span className="tabular-nums">{fmtBaht(x.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Pair({ th, en, value, strong = false }: { th: string; en: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col py-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-[13px] leading-tight ${strong ? "font-bold" : ""}`}>{th}</span>
        <span className={`whitespace-nowrap tabular-nums ${strong ? "text-[15px] font-bold" : "text-[13px]"}`}>{value}</span>
      </div>
      <span className="text-[10.5px] leading-tight text-(--ink-soft)">{en}</span>
    </div>
  );
}

function Field({ th, en, value }: { th: string; en: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] items-baseline gap-2">
      <div className="flex flex-col">
        <span className="text-[13px] leading-tight">{th}</span>
        <span className="text-[10.5px] leading-tight text-(--ink-soft)">{en}</span>
      </div>
      <span className="text-[13px] font-medium">{value || "—"}</span>
    </div>
  );
}

export function PayslipDocument({
  s,
  company,
  companyTaxId,
  position,
}: {
  s: SlipData;
  company: string;
  companyTaxId?: string;
  /** ตำแหน่งจากระบบบุคคล — ไม่มีใช้แผนก */
  position?: string | null;
}) {
  const l = s.line;
  const year = Number(s.payDate.slice(0, 4));
  const earn = earningRows(l.lines);
  const ded = deductionRows(l.lines);
  const hasTax = l.lines.some((x) => x.key === "tax");
  // ยอดสะสมทั้งปี: รอบที่จ่ายแล้วรวมงวดนี้อยู่แล้ว · ตัวอย่าง (ยังไม่จ่าย) บวกงวดนี้เข้าไปให้เห็นยอดหลังจ่าย
  const add = s.status === "paid" ? { gross: 0, tax: 0, sso: 0 } : { gross: l.gross, tax: l.tax, sso: l.ssoEmployee };
  const ytd = { gross: s.ytd.gross + add.gross, tax: s.ytd.tax + add.tax, sso: s.ytd.sso + add.sso };
  const i = l.info;
  const remarks = [
    // OT แบบนับวัน: ใช้จำนวนวันที่จ่ายจริงในสลิปนี้ (ไม่ใช่วันที่มีใบ OT ทั้งหมดในงวด)
    i ? `มาทำงาน ${i.workedDays} วัน · ลา ${Math.max(0, (i.leaveDays ?? 0) - (i.offDays ?? 0))} วัน · ขาด ${i.absentDays ?? 0} วัน · สาย ${i.lateCount} ครั้ง${(i.otDaysPay?.days ?? i.otDays) ? ` · OT ${i.otDaysPay?.days ?? i.otDays} วัน` : ""}` : "",
    l.payChannel === "cash" ? "รับเป็นเงินสด" : "",
  ].filter(Boolean);
  const account = l.payChannel === "cash" ? "เงินสด" : l.bankAccount ? `${l.bankName ? `${l.bankName} ` : ""}•••${l.bankAccount.slice(-4)}` : "—";

  return (
    <article
      className="mx-auto w-full max-w-[60rem] bg-(--bg) px-5 py-6 text-(--ink) sm:px-8 print:max-w-none print:px-0 print:py-0"
      aria-label={`สลิปเงินเดือน ${l.name}`}
    >
      {/* หัวเอกสาร */}
      <header className="flex flex-col-reverse gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="text-base font-bold">{company}</div>
          {companyTaxId && <div className="text-xs text-(--ink-soft)">เลขประจำตัวผู้เสียภาษี {companyTaxId}</div>}
        </div>
        <div className="sm:text-right">
          <h1 className="text-xl font-bold tracking-tight">สลิปเงินเดือน / Pay Slip</h1>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-1 gap-x-10 gap-y-2 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Field th="ชื่อ-นามสกุล (รหัส)" en="Emp. name (Code)" value={`${l.name}${l.employeeCode ? ` (${l.employeeCode})` : ""}`} />
          <Field th={position ? "ตำแหน่ง" : "แผนก"} en={position ? "Position" : "Department"} value={position || l.department} />
        </div>
        <div className="flex flex-col gap-2">
          <Field th="รอบเงินเดือน" en="Payroll Period" value={`${thaiDate(s.startsOn, false)} – ${thaiDate(s.endsOn)}`} />
          <Field th="วันที่ชำระ" en="Payment Date" value={thaiDate(s.paidOn ?? s.payDate)} />
          <Field th="เลขที่บัญชี" en="Bank Account" value={account} />
        </div>
      </div>

      {/* ตาราง 3 ช่อง */}
      <div className="mt-5 grid grid-cols-1 border border-(--ink) md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
        <section className="flex flex-col border-b border-(--ink) md:border-b-0 md:border-r">
          <h2 className="flex flex-col items-center border-b border-(--ink) py-1 text-[13px] font-semibold leading-tight">
            เงินได้<span className="text-[10.5px] font-normal text-(--ink-soft)">Earnings</span>
          </h2>
          <div className="flex flex-1 flex-col px-3 py-1.5">
            {earn.map((r) => <Cell key={r.th} r={r} />)}
          </div>
        </section>
        <section className="flex flex-col border-b border-(--ink) md:border-b-0 md:border-r">
          <h2 className="flex flex-col items-center border-b border-(--ink) py-1 text-[13px] font-semibold leading-tight">
            รายการหัก<span className="text-[10.5px] font-normal text-(--ink-soft)">Deductions</span>
          </h2>
          <div className="flex flex-1 flex-col px-3 py-1.5">
            {ded.map((r) => <Cell key={r.th} r={r} />)}
          </div>
        </section>
        <section className="flex flex-col">
          <h2 className="flex flex-col items-center border-b border-(--ink) py-1 text-[13px] font-semibold leading-tight">
            ปี<span className="text-[10.5px] font-normal text-(--ink-soft)">{year + 543} ({year})</span>
          </h2>
          <div className="flex flex-col px-3 py-1.5">
            <Pair th="เงินได้สะสม" en="YTD earnings" value={fmtBaht(ytd.gross)} />
            {(hasTax || ytd.tax > 0) && <Pair th="ภาษีหัก ณ ที่จ่ายสะสม" en="YTD Withholding tax" value={fmtBaht(ytd.tax)} />}
            <Pair th="เงินประกันสังคมสะสม" en="Accumulated SSF" value={fmtBaht(ytd.sso)} />
          </div>
          <div className="mt-auto flex flex-col border-t border-(--ink) px-3 py-1.5">
            <Pair th="รวมเงินได้" en="Total earnings" value={fmtBaht(l.gross)} />
            <Pair th="รวมรายการหัก" en="Total deductions" value={fmtBaht(l.deductions)} />
            <div className="mt-1 border-t border-(--line) pt-1">
              <Pair th="เงินได้สุทธิ" en="Net pay" value={fmtBaht(l.net)} strong />
            </div>
          </div>
        </section>
      </div>

      {/* หมายเหตุ + ลายเซ็น */}
      <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex flex-col gap-0.5">
          <div className="flex flex-col">
            <span className="text-[13px]">หมายเหตุ:</span>
            <span className="text-[10.5px] text-(--ink-soft)">Remarks</span>
          </div>
          {remarks.map((r) => <p key={r} className="text-xs text-(--ink-soft)">{r}</p>)}
        </div>
        <div className="flex flex-col justify-end gap-1">
          <div className="h-10 border-b border-dotted border-(--ink)" aria-hidden="true" />
          <div className="flex flex-col text-center">
            <span className="text-[13px]">ลายเซ็นผู้จ่ายเงิน</span>
            <span className="text-[10.5px] text-(--ink-soft)">Employer&apos;s Signature</span>
          </div>
        </div>
      </div>

      <footer className="mt-5 border-t border-(--line) pt-2 text-center text-[10.5px] leading-snug text-(--ink-soft)">
        <p>ข้อมูลเงินเดือนและค่าจ้างเป็นข้อมูลส่วนบุคคล ห้ามเปิดเผยโดยเด็ดขาด เอกสารนี้จะสมบูรณ์เมื่อมีลายเซ็นผู้มีอำนาจและตราประทับบริษัท</p>
        <p>Salary and wages are confidential information. Disclosure is strictly prohibited. This document is only valid with an authorized signature and company stamp.</p>
      </footer>
    </article>
  );
}
