import { NextResponse } from "next/server";
import { getSession } from "@smartboss/auth";

import { bangkokToday, loadMyMonth } from "@/modules/daily_worker/lib/data";
import { hoursLabel } from "@/modules/daily_worker/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "เดือนนี้ของฉัน" ของคนงาน (บทบาท WORKER) บนหน้าลงเวลา — ไม่ใช่คนงาน = { worker: false }
 * เห็นเฉพาะของตัวเอง ไม่ต้องมีสิทธิ์ของโมดูลคนงานรายวัน
 */
export async function GET() {
  const session = await getSession();
  if (!session?.orgId) return NextResponse.json({ worker: false }, { status: 401 });
  const month = bangkokToday().slice(0, 7);
  const mine = await loadMyMonth(session.orgId, session.userId, month).catch(() => null);
  if (!mine) return NextResponse.json({ worker: false });

  const todayDay = Number(mine.today.slice(8, 10));
  const cells = Object.entries(mine.worker.cells).map(([d, c]) => ({ day: Number(d), ...c }));
  const nextOff = cells.filter((c) => c.day > todayDay && c.s === "o").sort((a, b) => a.day - b.day)[0]?.day ?? null;
  const recent = cells
    .filter((c) => c.day <= todayDay && (c.s === "x" || c.s === "s" || c.s === "n" || c.early || c.ot || c.override))
    .sort((a, b) => b.day - a.day)
    .slice(0, 6)
    .map((c) => ({
      day: c.day,
      text:
        c.s === "x" ? `ขาด · ไม่ลงออก (เข้า ${c.inAt})` :
        c.s === "s" ? `สาย ${c.lateMin ?? 0} นาที · เข้า ${c.inAt}` :
        c.s === "n" ? "ไม่มา" :
        c.override ? "มา (แก้แล้ว)" :
        c.ot ? `OT ${c.ot.start}–${c.ot.end}` :
        `กลับก่อน · ออก ${c.outAt}`,
      tone: c.s === "x" ? "bad" : c.s === "n" ? "mute" : c.ot && c.s !== "s" ? "ot" : "warn",
    }));
  return NextResponse.json({
    worker: true,
    month,
    // ยอดเงินยังไม่ส่งให้คนงานเห็น (ผู้ดูแลจ่ายรายวันเอง) — ส่งเฉพาะจำนวนวัน/นาที
    summary: { ...mine.summary, pay: undefined, ot: mine.summary.otMinutes ? hoursLabel(mine.summary.otMinutes) : "0" },
    nextOff,
    recent,
    hasShift: !!mine.worker.shiftId,
  });
}
