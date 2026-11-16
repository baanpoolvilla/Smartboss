import { diligenceStep } from "../modules/salary/lib/compute";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { dilStep } = require("C:/Users/GL-IT/AppData/Local/Temp/claude/d--Smartboss/c82bf666-ee58-419e-9ab2-e54ff9562a19/scratchpad/dilsim/step.js");
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const stepsSets = [[500, 800, 1000], [300, 600, 900, 1200], [1000]];
let cases = 0, diff = 0;
for (let s = 0; s < 500; s++) {
  const S = stepsSets[s % 3]!;
  let a: number | null = null, b: number | null = null;
  for (let m = 0; m < 12; m++) {
    const c = { leaveDays: rnd() < 0.2 ? (rnd() < 0.5 ? 0.5 : 1) : 0, lateCount: rnd() < 0.15 ? 1 : 0, absentDays: rnd() < 0.05 ? 1 : 0 };
    const r = diligenceStep(S, a, a === null ? "none" : "run", c); const q = dilStep(S, b, c);
    cases++; if (r.amount !== q.amount) diff++;
    a = r.amount; b = q.amount;
  }
}
console.log("เดือนที่เทียบ", cases, "ไม่ตรง", diff);
