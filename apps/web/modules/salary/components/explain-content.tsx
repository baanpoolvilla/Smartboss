import { fmtBaht, type SsoParams } from "../lib/types";

/*
 * ข้อความอธิบายที่ใช้ซ้ำ (drawer ของ HR/CEO · สลิปพนักงาน) — ตัวเลขดึงจากอัตราที่ตั้งไว้ ไม่เขียนตายตัว
 * forEmployee = พูดกับพนักงานเอง ("คุณ") ตัดรายละเอียดงานหลังบ้าน
 */

export function SalaryExplain({ forEmployee = false }: { forEmployee?: boolean }) {
  return (
    <>
      <div>• ทำงานครบงวด → ได้เต็มเดือน ไม่ว่าเดือนนั้นมี 28 หรือ 31 วัน</div>
      <div>• เข้า/ออกกลางงวด → เงินเดือน ÷ 30 × วันที่ทำงาน</div>
      <div>• ขึ้นเงินเดือนกลางงวด → แบ่งตามวัน เช่น 25,000 × 15 วัน + 27,000 × 15 วัน ÷ 30 = 26,000</div>
      <div>• ลาไม่รับค่าจ้าง → หักวันละ เงินเดือน ÷ 30 เฉพาะวันที่ลงลา</div>
      {!forEmployee && <div className="text-(--ink-soft)">เงินเดือนแก้ที่ &quot;รายชื่อพนักงาน&quot; (มีวันมีผล เก็บประวัติ) ไม่ใช่แก้ในรอบ</div>}
    </>
  );
}

export function SsoExplain({ p, forEmployee = false }: { p: SsoParams; forEmployee?: boolean }) {
  return (
    <>
      <div>
        หัก {p.employeeRate}% ของค่าจ้าง โดยคิดจากค่าจ้าง<strong> ไม่ต่ำกว่า {fmtBaht(p.wageFloor)} และไม่เกิน {fmtBaht(p.wageCeiling)}</strong> → หักมากสุดเดือนละ {fmtBaht(p.maxContribution)}
      </div>
      <div>{forEmployee ? "บริษัทจ่ายสมทบให้คุณอีกเท่ากัน โดยไม่หักจากเงินเดือน" : `บริษัทจ่ายสมทบเพิ่มอีก ${p.employerRate}% (ไม่หักจากพนักงาน)`}</div>
      {forEmployee ? (
        <div>เงินเข้ากองทุนประกันสังคมในชื่อของคุณ ใช้เป็นสิทธิรักษาพยาบาล · ว่างงาน · คลอดบุตร · เงินชราภาพ</div>
      ) : (
        <div className="text-(--ink-soft)">ค่าจ้างที่นับ = เงินเดือน + รายการที่ติ๊ก &quot;นับเป็นค่าจ้างประกันสังคม&quot; (+ OT ถ้าเปิดไว้ที่ตั้งค่า) · นำส่งภายในวันที่ 15 ของเดือนถัดไป</div>
      )}
    </>
  );
}

export function AdvanceExplain({ forEmployee = false }: { forEmployee?: boolean }) {
  return forEmployee ? (
    <div>เงินที่คุณเบิกไปก่อนวันจ่ายเงินเดือน หักคืนในงวดนี้ (ดูรายละเอียดใบเบิกได้ที่เมนู เบิกจ่าย &amp; OT)</div>
  ) : (
    <>
      <div>ดึงจากใบเบิกล่วงหน้าที่จ่ายแล้วใน เบิกจ่าย &amp; OT — กดบันทึกจ่ายรอบนี้แล้วใบเบิกปิดเป็น &quot;หักแล้ว&quot; เอง</div>
      <div>หักทีเดียวแล้วเงินเหลือน้อยเกิน? กด &quot;เลื่อนไปหักงวดหน้า&quot; (CEO เห็นในกล่องควรดู)</div>
    </>
  );
}

/** "ติ๊กอันไหนดี" ตอนเพิ่มรายการเอง */
export function FlagsExplain() {
  const rows: [string, string, string][] = [
    ["ค่าตำแหน่ง · เบี้ยขยัน (ได้ทุกเดือน)", "✓", "✓"],
    ["โบนัส · รางวัล (นาน ๆ ครั้ง)", "✓", "—"],
    ["ค่าเดินทางตามจริงที่มีใบเสร็จ", "—", "—"],
  ];
  return (
    <>
      <div className="font-semibold">ติ๊กอันไหนดี (โดยทั่วไป)</div>
      <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_5rem] gap-x-2 gap-y-1">
        <span className="font-semibold text-(--ink-soft)">ตัวอย่าง</span>
        <span className="font-semibold text-(--ink-soft)">คิดภาษี</span>
        <span className="font-semibold text-(--ink-soft)">ประกันสังคม</span>
        {rows.map(([a, b, c]) => (
          <div key={a} className="contents"><span>{a}</span><span>{b}</span><span>{c}</span></div>
        ))}
      </div>
      <div className="text-(--ink-soft)">ไม่แน่ใจให้ถามนักบัญชี · ตั้งชื่อรายการถาวรที่ ตั้งค่า แล้วไม่ต้องติ๊กทุกครั้ง</div>
    </>
  );
}
