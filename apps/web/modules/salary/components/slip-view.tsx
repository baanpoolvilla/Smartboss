import type { SlipData } from "../lib/views";
import { fmtBaht, periodLabel, thaiDate } from "../lib/types";

/**
 * สลิปเงินเดือน — ผู้ใช้กำหนด 22/10/2569: "สลิปที่ user ได้รับต้องชัดเจน" · "แสดงเต็มก่อนโดนหัก" ·
 * "แจกแจงให้ชัดว่าหักอะไร แบบไหน"
 *   - บนสุด: เงินเข้าบัญชีเท่าไหร่ = ได้ − หัก
 *   - เงินได้ทุกบรรทัด + หักทุกบรรทัด แต่ละบรรทัดมีคำอธิบายว่าคิดยังไง (บรรทัดคำอธิบายอยู่ใต้ตัวเลข — มือถือไม่ซ้อน)
 *   - เงินเดือน / ประกันสังคม / ภาษี ขึ้นเสมอแม้เป็น 0 (แบบ FlowAccount)
 *   - เลขบัญชีโชว์แค่ 4 ตัวท้าย
 */
/** สลิปเป็นเอกสารของพนักงาน — ไม่ต้องบอกว่าใครในฝ่ายบุคคลเป็นคนกรอก (CEO/HR ดูได้ในหน้ารอบ) */
const slipHow = (how: string) => how.replace(/ · เพิ่มโดย [^·]+$/, "");

export function SlipView({ s, company }: { s: SlipData; company: string }) {
  const l = s.line;
  const earn = l.lines.filter((x) => x.kind === "earning");
  if (!earn.some((x) => x.source === "salary")) earn.unshift({ key: "salary", label: "เงินเดือน", kind: "earning", amount: 0, how: "", source: "salary", auto: true });
  const ded = l.lines.filter((x) => x.kind === "deduction");
  const employer = l.lines.find((x) => x.kind === "employer");
  return (
    <article className="flex flex-col gap-3 text-(--ink)" aria-label={`สลิปเงินเดือน ${periodLabel(s.period)}`}>
      <header className="flex flex-col gap-0.5">
        <div className="text-xs text-(--ink-soft)">{company}</div>
        <h1 className="text-xl font-bold">สลิปเงินเดือน {periodLabel(s.period, true)}</h1>
        <div className="text-sm text-(--ink-soft)">
          {l.name}
          {l.employeeCode ? ` · ${l.employeeCode}` : ""}
          {l.department ? ` · ${l.department}` : ""}
        </div>
        <div className="text-xs text-(--ink-soft)">
          ช่วงทำงาน {thaiDate(s.startsOn, false)} – {thaiDate(s.endsOn)} · วันที่จ่าย {thaiDate(s.paidOn ?? s.payDate)}
        </div>
      </header>

      <section className="rounded-(--radius-lg) bg-(--brand-navy,#1b2537) px-4 py-3 text-white">
        <div className="text-sm opacity-85">{l.payChannel === "cash" ? "รับเป็นเงินสด" : `เงินเข้าบัญชี ${l.bankName || ""} ${l.bankAccount ? `•••${l.bankAccount.slice(-4)}` : ""}`}</div>
        <div className="text-3xl font-bold tabular-nums">฿{fmtBaht(l.net)}</div>
        <div className="text-sm opacity-85">= เงินได้ {fmtBaht(l.gross)} − หัก {fmtBaht(l.deductions)}</div>
      </section>

      <section className="rounded-(--radius-lg) border border-(--line) bg-(--bg) px-4 py-3">
        <div className="flex justify-between pb-1.5 text-sm font-bold text-emerald-800"><span>เงินได้</span><span className="tabular-nums">{fmtBaht(l.gross)}</span></div>
        {earn.map((x) => (
          <div key={x.key} className="border-t border-(--line) py-2">
            <div className="flex justify-between gap-3 text-[15px]"><span>{x.label}</span><span className="whitespace-nowrap font-semibold tabular-nums">{fmtBaht(x.amount)}</span></div>
            {x.how && <div className="mt-0.5 text-xs text-(--ink-soft)">{slipHow(x.how)}</div>}
          </div>
        ))}
      </section>

      <section className="rounded-(--radius-lg) border border-(--line) bg-(--bg) px-4 py-3">
        <div className="flex justify-between pb-1.5 text-sm font-bold text-red-800"><span>รายการหัก</span><span className="tabular-nums">−{fmtBaht(l.deductions)}</span></div>
        {ded.map((x) => (
          <div key={x.key} className="border-t border-(--line) py-2">
            <div className="flex justify-between gap-3 text-[15px]"><span>{x.label}</span><span className="whitespace-nowrap font-semibold tabular-nums text-red-800">{x.amount > 0 ? `−${fmtBaht(x.amount)}` : "0.00"}</span></div>
            {x.how && <div className="mt-0.5 text-xs text-(--ink-soft)">{slipHow(x.how)}</div>}
          </div>
        ))}
      </section>

      <section className="rounded-(--radius-lg) border border-(--line) bg-(--bg) px-4 py-3 text-sm">
        <div className="pb-1 text-xs font-semibold text-(--ink-soft)">ข้อมูลประกอบ</div>
        {!!l.info?.workedDays && <div className="flex justify-between py-0.5"><span>วันที่มาทำงาน (มีสแกน)</span><span>{l.info.workedDays} วัน</span></div>}
        {(l.info?.leaveDays ?? 0) > 0 && <div className="flex justify-between py-0.5"><span>วันลา</span><span>{l.info.leaveDays} วัน</span></div>}
        {employer && <div className="flex justify-between py-0.5"><span>บริษัทจ่ายประกันสังคมให้อีก</span><span className="tabular-nums">{fmtBaht(employer.amount)}</span></div>}
        <div className="mt-1 border-t border-(--line) pt-1.5 text-xs font-semibold text-(--ink-soft)">สะสมตั้งแต่ต้นปี {Number(s.payDate.slice(0, 4)) + 543}</div>
        <div className="flex justify-between py-0.5"><span>เงินได้</span><span className="tabular-nums">{fmtBaht(s.ytd.gross)}</span></div>
        <div className="flex justify-between py-0.5"><span>ภาษีหัก ณ ที่จ่าย</span><span className="tabular-nums">{fmtBaht(s.ytd.tax)}</span></div>
        <div className="flex justify-between py-0.5"><span>ประกันสังคม</span><span className="tabular-nums">{fmtBaht(s.ytd.sso)}</span></div>
      </section>
    </article>
  );
}
