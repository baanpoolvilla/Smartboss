import "server-only";
import type { Tx } from "./db";
import { periodDates, periodLabel, shiftPeriod, type SettingsView } from "./types";

/**
 * "ขั้นรอบก่อน" ของเบี้ยขยัน — ดูจากงวดก่อนหน้าโดยตรง (ผู้ใช้ 26/11/2569)
 *
 * เดิมดู "งวดล่าสุดที่จ่ายแล้ว" ⇒ ลืมกดจ่ายงวดหนึ่ง / ยังรออนุมัติ แล้วทำงวดถัดไป ขั้นของทุกคนกลับไปเริ่มใหม่เงียบ ๆ
 * ตอนนี้ (ทีละคน):
 *   1. งวดก่อนหน้า (period − 1) มีในระบบ → ใช้ยอดเบี้ยขยันของคนนั้นในงวดนั้น ไม่ว่าสถานะไหน
 *      (ร่าง/รออนุมัติ = ยังเปลี่ยนได้ ⇒ คนเรียกต้องกันส่งงวดนี้จนกว่างวดนั้นอนุมัติ — prevRunBlock)
 *      คนที่ถูก "ไม่จ่ายงวดนี้" ในงวดนั้น — ใช้ยอดที่คิดจากการลงเวลาจริงตอนคำนวณงวดนั้น (เก็บไว้ใน excluded)
 *   2. งวดก่อนหน้าไม่มีในระบบ (ลืมทำ/ข้ามเดือน) แต่เคยมีงวดก่อน ๆ → คิดเบี้ยขยันของงวดที่หายไปจากการลงเวลาจริงของงวดนั้น
 *      (ซ้อนต่อไปเรื่อย ๆ จนเจองวดที่มี หรือถึงงวดเริ่มนับ) — ขั้นไม่เพี้ยนเพราะเดือนที่ลืมทำ
 *   3. ก่อนงวดเริ่มนับ (settings.diligenceFromPeriod) หรือยังไม่เคยมีงวดเลย → ไม่มีขั้นรอบก่อน (ใช้ขั้นยกมา/เริ่มขั้นแรก)
 * คนที่ไม่มีชื่อในงวดก่อนหน้า (เพิ่งเข้า/เพิ่งใส่เงินเดือน/ยังไม่ผ่านโปร) → ไม่อยู่ใน map → ขั้นยกมาของคนนั้น หรือขั้นแรก
 */

export interface PrevEntry {
  /** ยอดเบี้ยขยันของงวดก่อนหน้า (บาท) — 0 = งวดนั้นไม่ได้ (รอบนี้เริ่มขั้นแรกใหม่) */
  amount: number;
  /** ที่มา: งวดในระบบ หรือคิดจากการลงเวลาจริงของงวดที่ไม่ได้ทำ */
  source: "run" | "virtual";
  period: string;
}

export interface PrevChain {
  byEmp: Map<string, PrevEntry>;
  /** งวดก่อนหน้าที่มีในระบบ (null = ไม่มี / ก่อนงวดเริ่มนับ) */
  prevRun: { id: string; period: string; status: string } | null;
  /** งวดก่อนหน้า (YYYY-MM) ที่ถูกคิดจากการลงเวลา เพราะไม่มีในระบบ */
  virtualPeriods: string[];
  /** ข้อความกันส่ง — งวดก่อนหน้ายังไม่อนุมัติ (ยอดยังเปลี่ยนได้) */
  block: string | null;
}

type Settings = Pick<SettingsView, "diligenceEnabled" | "diligenceSteps" | "diligencePartial" | "diligenceFromPeriod" | "cutoffDay" | "payDay" | "otMode">;

/** คิดเบี้ยขยันของงวดที่ไม่มีในระบบ — ส่งมาจาก inputs.ts (กัน import วน) · คืนยอดต่อคน (เฉพาะคนที่ได้คิดเบี้ยขยัน) */
export type VirtualLoader = (period: string, dates: { startsOn: string; endsOn: string; payDate: string }) => Promise<Map<string, number>>;

const MAX_DEPTH = 24;
const EMPTY: PrevChain = { byEmp: new Map(), prevRun: null, virtualPeriods: [], block: null };

export async function resolvePrevDiligence(
  tx: Tx,
  orgId: string,
  period: string,
  settings: Settings,
  loadVirtual: VirtualLoader,
  depth = 0,
): Promise<PrevChain> {
  if (!settings.diligenceEnabled) return EMPTY;
  const prevP = shiftPeriod(period, -1);
  const floor = settings.diligenceFromPeriod;
  if (floor && prevP < floor) return EMPTY;
  if (depth >= MAX_DEPTH) return EMPTY;

  const run = await tx.salaryRun.findFirst({ where: { orgId, period: prevP }, select: { id: true, period: true, status: true, excluded: true } });
  if (run) {
    const byEmp = new Map<string, PrevEntry>();
    const lines = await tx.$queryRawUnsafe<{ employment_id: string; amount: string | null }[]>(
      `SELECT employment_id::text AS employment_id, (info->'diligence'->>'amount') AS amount
         FROM salary.run_lines WHERE org_id = $1 AND run_id = $2 AND info ? 'diligence'`,
      orgId,
      run.id,
    );
    for (const l of lines) {
      const a = Number(l.amount);
      if (l.amount !== null && Number.isFinite(a)) byEmp.set(l.employment_id, { amount: a, source: "run", period: run.period });
    }
    // "ไม่จ่ายงวดนี้" — ยอดที่คิดจากการลงเวลาจริงตอนคำนวณงวดนั้น (computeRun เก็บไว้)
    for (const x of (run.excluded as unknown as { employmentId: string; diligence?: number | null }[] | null) ?? []) {
      if (typeof x?.diligence === "number" && Number.isFinite(x.diligence) && !byEmp.has(x.employmentId)) {
        byEmp.set(x.employmentId, { amount: x.diligence, source: "run", period: run.period });
      }
    }
    const settled = run.status === "approved" || run.status === "paid";
    return {
      byEmp,
      prevRun: { id: run.id, period: run.period, status: run.status },
      virtualPeriods: [],
      block: settled
        ? null
        : `งวด ${periodLabel(run.period)} ยังไม่อนุมัติ — ขั้นเบี้ยขยันงวดนี้ต่อจากงวดนั้น (ยอดยังเปลี่ยนได้) อนุมัติงวด ${periodLabel(run.period)} ก่อน แล้วกด "ดึงข้อมูลใหม่"`,
    };
  }

  // ไม่มีงวดก่อนหน้าในระบบ (ลืมทำ/ข้ามเดือน):
  //   ตั้งงวดเริ่มนับไว้ (และงวดก่อนหน้าไม่ก่อนงวดนั้น — เช็คข้างบนแล้ว) → คิดงวดที่หายไปจากการลงเวลาจริง
  //   ไม่ได้ตั้ง → คิดย้อนเฉพาะเมื่อเคยมีงวดก่อน ๆ ในระบบ (ไม่มีเลย = งวดแรกของบริษัท)
  if (!floor) {
    const older = await tx.salaryRun.findFirst({ where: { orgId, period: { lt: prevP } }, select: { id: true } });
    if (!older) return EMPTY;
  }

  const dates = periodDates(prevP, settings.cutoffDay, settings.payDay);
  const amounts = await loadVirtual(prevP, dates);
  const byEmp = new Map<string, PrevEntry>();
  for (const [id, a] of amounts) byEmp.set(id, { amount: a, source: "virtual", period: prevP });
  return { byEmp, prevRun: null, virtualPeriods: [prevP], block: null };
}

/** ข้อความต่อท้ายคำอธิบายเบี้ยขยัน — บอกว่าขั้นรอบก่อนมาจากไหน */
export function prevNote(entry: PrevEntry | undefined, chain: PrevChain): string {
  if (!entry) return "";
  if (entry.source === "virtual") return ` · งวด ${periodLabel(entry.period)} ไม่ได้ทำในระบบ — นับจากการลงเวลาจริงของงวดนั้น`;
  if (chain.prevRun && chain.prevRun.status !== "approved" && chain.prevRun.status !== "paid") return ` · อิงงวด ${periodLabel(entry.period)} ที่ยังไม่อนุมัติ`;
  return "";
}
