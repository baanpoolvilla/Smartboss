import type { TaxBreak } from "../lib/compute";
import { fmtBaht } from "../lib/types";

/**
 * วิธีคิดภาษีทีละขั้นเป็นตาราง — ตัวเลขชุดเดียวกับที่ระบบใช้คิดจริง (เก็บไว้ตอนคำนวณ)
 * ใช้ทั้งใน drawer ของ HR/CEO และบนสลิปพนักงาน (forEmployee = ภาษาง่ายขึ้น ตัดรายละเอียดภายใน)
 */
export function TaxSteps({ b, forEmployee = false }: { b: TaxBreak; forEmployee?: boolean }) {
  const row = (label: React.ReactNode, sub: string | null, amount: number, minus = false) => (
    <div className="flex items-start justify-between gap-3 py-1">
      <div className="min-w-0">
        <div>{label}</div>
        {sub && <div className="text-xs text-(--ink-soft)">{sub}</div>}
      </div>
      <div className={`shrink-0 tabular-nums ${minus ? "text-red-800" : "font-semibold"}`}>{minus ? `−${fmtBaht(amount)}` : fmtBaht(amount)}</div>
    </div>
  );
  const incomeSub = [
    b.ytdIncome > 0 ? `จ่ายไปแล้ว/ยอดยกมา ${fmtBaht(b.ytdIncome)}` : null,
    `${fmtBaht(b.regular)} × ${b.regularPeriods} เดือน${b.gap > 0 ? " (รวมเดือนก่อนเริ่มใช้ระบบ ใช้ค่าประมาณ)" : ""}`,
    b.irregular > 0 ? `OT/โบนัสงวดนี้ ${fmtBaht(b.irregular)}` : null,
  ].filter(Boolean).join(" + ");
  const first = b.brackets[0]?.upTo ?? 150000;
  let n = 0;
  const no = () => `${++n}. `;
  const tiers = b.brackets.map((t, i) => {
    const from = i === 0 ? 0 : (b.brackets[i - 1]!.upTo ?? 0) + 1;
    return { text: t.upTo === null ? `${fmtBaht(from)} ขึ้นไป` : `${fmtBaht(from)} – ${fmtBaht(t.upTo)}`, rate: t.rate === 0 ? "ยกเว้น" : `${t.rate}%` };
  });
  return (
    <div className="flex flex-col text-[13px]">
      <div className="divide-y divide-(--line)">
        {row(`${no()}เงินได้ทั้งปีประมาณ`, incomeSub, b.income)}
        {row(`${no()}หักค่าใช้จ่าย`, "กฎหมายให้หัก 50% แต่ไม่เกิน 100,000 ไม่ต้องมีใบเสร็จ", b.expense, true)}
        {row(`${no()}ลดหย่อนส่วนตัว`, "ทุกคนได้", b.personal, true)}
        {b.sso > 0 && row(`${no()}ประกันสังคมทั้งปี`, null, b.sso, true)}
        {b.extra > 0 && row(`${no()}ลดหย่อนอื่น (ล.ย.01)`, forEmployee ? "ตามที่คุณแจ้งฝ่ายบุคคล" : "คู่สมรส บุตร ประกัน ฯลฯ ที่กรอกไว้", b.extra, true)}
        <div className="flex justify-between gap-3 py-1.5 font-bold"><span>= เงินได้สุทธิทั้งปี</span><span className="tabular-nums">{fmtBaht(b.net)}</span></div>
      </div>
      <details className="mt-1">
        <summary className="min-h-7 cursor-pointer text-xs font-semibold text-(--brand-navy,#1b2537)">อัตราภาษีขั้นบันได (ต่อปี)</summary>
        <div className="mt-1 grid grid-cols-2 gap-x-3 text-xs text-(--ink-soft)">
          {tiers.map((t) => (
            <div key={t.text} className="contents"><span className="tabular-nums">{t.text}</span><span>{t.rate}</span></div>
          ))}
        </div>
      </details>
      <div className="mt-1.5 rounded-(--radius) border border-dashed border-(--line) bg-(--bg) px-3 py-2">
        {b.annualTax === 0 ? (
          <>เงินได้สุทธิไม่เกิน {fmtBaht(first)} (ส่วนแรกที่ไม่ต้องเสียภาษี) → ภาษีทั้งปี 0 → {forEmployee ? "ปีนี้ยังไม่ต้องเสียภาษี" : "เดือนนี้หัก 0.00"}</>
        ) : (
          <>
            ภาษีทั้งปี <strong className="tabular-nums">{fmtBaht(b.annualTax)}</strong>
            {b.withheld > 0 && <> − หักไปแล้ว {fmtBaht(b.withheld)}</>}
            {b.assumedGap > 0 && <> − ส่วนของเดือนก่อนเริ่มใช้ระบบ {fmtBaht(b.assumedGap)}</>}
            {" "}÷ {b.periodsLeft} เดือนที่เหลือ = {fmtBaht(b.regularPart)}
            {b.irregularPart > 0 && <> + ภาษีของ OT/โบนัสงวดนี้ {fmtBaht(b.irregularPart)}</>}
            {" "}→ <strong>เดือนนี้ {fmtBaht(b.computed)}</strong>
          </>
        )}
      </div>
      {b.irregular > 0 && (
        <p className="mt-1.5 text-xs text-amber-900">เดือนที่มี OT/โบนัส ภาษีสูงกว่าปกติ เพราะเงินได้ไม่ประจำคิดภาษีทั้งก้อนในเดือนที่ได้ ไม่เฉลี่ย 12 เดือน</p>
      )}
    </div>
  );
}
