import Link from "next/link";

import { baht, changedAfterPay, minutesToHm, type DayCell, type DayMoney, type PaymentEntry } from "../lib/types";

const thDate = (date: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d}/${m}/${y + 543}`;
};
const thTime = (iso: string) =>
  iso ? new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";

/**
 * "ที่มาของตัวเลข" ของเงินคนงานหนึ่งวัน (ผู้ใช้ขอ 19/10/2569 "ให้รู้ว่าเงินตรงนี้มาจากไหน อ้างอิงจากไหนให้ชัดเจน")
 * ยกมา → ได้วันนี้ (ค่าแรง ใครตั้ง · สาย/กลับก่อน จากเวลาไหน กะไหน · OT) → จ่าย (ใคร เมื่อไร เพราะอะไร) → คงเหลือ
 * ใช้ทั้งหน้าจ่ายเงิน หน้ารายคน และ PDF — ข้อความเดียวกันทุกที่
 */
export function MoneySource({
  day,
  cell,
  employmentId,
  allPayments,
  showLinks = true,
}: {
  day: DayMoney;
  cell: DayCell | undefined;
  employmentId: string;
  /** การจ่ายทั้งเดือนของคนนี้ (รวมที่ยกเลิก) — ไว้เช็กว่ายอดเปลี่ยนหลังจ่าย */
  allPayments: PaymentEntry[];
  showLinks?: boolean;
}) {
  const changed = cell?.pay ? changedAfterPay(day.date, cell.pay.total, allPayments) : null;
  const perMin = cell?.rate ? cell.rate.wage / 480 : 0;
  return (
    <div className="grid gap-1.5 text-[12.5px] leading-relaxed">
      <Row k={`ยกมา ${baht(day.carried)}`}>
        คงเหลือสิ้นวันก่อนหน้า
        {showLinks && (
          <>
            {" "}
            <Link href={`/daily-workers/w/${employmentId}?month=${day.date.slice(0, 7)}`} className="font-semibold text-sky-700 hover:underline dark:text-sky-300">
              ดูบัญชีรายคน →
            </Link>
          </>
        )}
      </Row>

      <Row k={`ได้วันนี้ ${day.earned ? `+${baht(day.earned)}` : "0"}`}>
        {cell?.pay && cell.rate ? (
          <>
            ค่าแรง <b>{baht(cell.rate.wage)}</b>{" "}
            <span className="text-(--ink-soft)">
              ← {cell.rate.origin === "module" ? `ตั้งโดย ${cell.rate.byName ?? "-"} มีผล ${thDate(cell.rate.from)}` : `เงินเดือนแบบรายวันในระบบบุคคล มีผล ${thDate(cell.rate.from)}`}
            </span>
            <br />
            {(cell.lateMin ?? 0) > 0 && (
              <>
                − สาย <b>{cell.lateMin} นาที</b> × {baht(Math.round(perMin * 100) / 100)} = <b>{baht(Math.round((cell.lateMin ?? 0) * perMin * 100) / 100)}</b>{" "}
                <span className="text-(--ink-soft)">
                  ← เข้า {cell.inAt}
                  {cell.shift && ` · กะวันนั้น ${minutesToHm(cell.shift.start)}–${minutesToHm(cell.shift.end)}`}
                </span>
                <br />
              </>
            )}
            {(cell.earlyMin ?? 0) > 0 && (
              <>
                − กลับก่อน <b>{cell.earlyMin} นาที</b> = <b>{baht(Math.round((cell.earlyMin ?? 0) * perMin * 100) / 100)}</b>{" "}
                <span className="text-(--ink-soft)">← ออก {cell.outAt}</span>
                <br />
              </>
            )}
            {cell.ot && (
              <>
                + OT <b>{cell.ot.start}–{cell.ot.end}</b> × {cell.rate.otPercent}% = <b>{baht(cell.pay.ot)}</b>{" "}
                <span className="text-(--ink-soft)">
                  ← ลงโดย {cell.ot.byName}
                  {cell.rate.otFromCompany ? " · % กลางของบริษัท" : " · % เฉพาะคนนี้"}
                </span>
                <br />
              </>
            )}
            {!cell.lateMin && !cell.earlyMin && (
              <span className="text-(--ink-soft)">
                เข้า {cell.inAt ?? "--:--"} ออก {cell.outAt ?? (cell.ot ? "(วัน OT ไม่ดูเวลาออก)" : "--:--")} ไม่สาย ไม่กลับก่อน
                <br />
              </span>
            )}
            {cell.edit && (
              <span className="text-(--ink-soft)">
                เวลาที่ใช้คิดแก้โดย {cell.edit.byName} ({thTime(cell.edit.at)}): {cell.edit.reason} · สแกนจริง {cell.edit.scannedIn ?? "--:--"}–{cell.edit.scannedOut ?? "--:--"}
                <br />
              </span>
            )}
            = <b>{baht(cell.pay.total)}</b>
          </>
        ) : cell?.s === "x" ? (
          <span>ขาด (ลงเข้า {cell.inAt ?? "--:--"} แต่ไม่ลงออก) ไม่ได้ค่าแรง</span>
        ) : cell?.s === "o" || cell?.s === "l" || cell?.s === "r" ? (
          <span>หยุด/ลา</span>
        ) : cell?.s === "m" || cell?.s === "s" ? (
          <span className="text-(--tone-warn)">มาแต่ยังคิดเงินไม่ได้ (ยังไม่ตั้งค่าแรง หรือยังไม่ลงออก)</span>
        ) : (
          <span className="text-(--ink-soft)">ไม่มีการลงเวลา</span>
        )}
        {changed && (
          <span className="mt-1 block rounded bg-(--tone-warn)/15 px-2 py-0.5 text-(--tone-warn)">
            ยอดวันนี้เปลี่ยนหลังจ่าย: ตอนจ่าย ({thTime(changed.paidAt)}) คิดได้ {baht(changed.was)} → ตอนนี้ {baht(changed.now)} (
            {changed.now - changed.was > 0 ? "+" : "−"}
            {baht(Math.abs(Math.round((changed.now - changed.was) * 100) / 100))}) ส่วนต่างอยู่ในคงเหลือแล้ว
          </span>
        )}
      </Row>

      {day.payments.map((p) => (
        <Row key={p.id} k={`จ่าย −${baht(p.amount)}`}>
          {p.kind === "advance" ? <b className="text-(--tone-danger)">เบิกล่วงหน้า </b> : "ค่าแรง "}
          {p.note && `"${p.note}" `}
          <span className="text-(--ink-soft)">· บันทึกโดย {p.byName} {thTime(p.at)}</span>
        </Row>
      ))}

      <Row k={`คงเหลือ ${baht(day.balance)}`}>
        {baht(day.carried)} {day.earned >= 0 ? "+" : "−"} {baht(Math.abs(day.earned))}
        {day.paid ? ` − ${baht(day.paid)}` : ""} ={" "}
        <b className={day.balance < 0 ? "text-(--tone-danger)" : ""}>{baht(day.balance)}</b>{" "}
        <span className="text-(--ink-soft)">{day.balance < 0 ? "· เบิกเกิน หักจากค่าแรงวันถัดไปเอง" : day.balance > 0 ? "· ค้างจ่าย ยกไปวันถัดไป" : "· จ่ายครบ"}</span>
      </Row>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-3 sm:grid-cols-[130px_1fr]">
      <span className="font-semibold tabular-nums">{k}</span>
      <span>{children}</span>
    </div>
  );
}
