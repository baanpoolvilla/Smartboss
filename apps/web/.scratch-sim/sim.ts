// รันสูตรเบี้ยขยันตัวจริงของระบบ (modules/salary/lib/compute.ts) ต่อกันทีละเดือน — ยอดเดือนนี้เป็น "ขั้นรอบก่อน" ของเดือนหน้า เหมือนตอนรอบจ่ายแล้ว
import { diligenceStep } from "../modules/salary/lib/compute";
const S = [500, 800, 1000];
type M = { leave?: number; late?: number; absent?: number };
const scenarios: Record<string, M[]> = {
  "ไม่ขาด ไม่ลา ไม่สาย ทั้งปี": Array(12).fill({}),
  "เดือนที่ 4 ลากิจ 1 วัน": [{}, {}, {}, { leave: 1 }, {}, {}, {}, {}, {}, {}, {}, {}],
  "เดือนที่ 2 มาสาย 1 ครั้ง": [{}, { late: 1 }, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}],
  "โดนติดกัน 2 เดือน (ลาป่วย แล้วขาดงาน)": [{}, {}, {}, { leave: 1 }, { absent: 1 }, {}, {}, {}, {}, {}, {}, {}],
  "เดือนแรกก็สายเลย": [{ late: 2 }, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}],
  "ลาครึ่งวัน เดือนที่ 6": [{}, {}, {}, {}, {}, { leave: 0.5 }, {}, {}, {}, {}, {}, {}],
};
const out: Record<string, { amount: number; how: string }[]> = {};
for (const [name, months] of Object.entries(scenarios)) {
  let prev: number | null = null;
  out[name] = months.map((m, i) => {
    const r = diligenceStep(S, prev, prev === null ? "none" : "run", { leaveDays: m.leave ?? 0, lateCount: m.late ?? 0, absentDays: m.absent ?? 0 });
    prev = r.amount;
    return { amount: r.amount, how: r.how };
  });
}
console.log(JSON.stringify(out));
