/**
 * Discord Report Sync — ตัวตัดสินผล (pure, ไม่มี I/O จึงเทสต์ง่าย)
 *
 * ยึดเกณฑ์เดียวกับหน้า report ของ SmartBoss (cutoff + minImages) แต่ป้อนวันทำงาน
 * มาจาก HR roster แทน (ดู working-days.ts) — ดู docs/discord_report_integration.md
 *
 * เวลาไทย: Discord ให้เวลาเป็น UTC ต้องแปลง +7 ก่อนเทียบ cutoff เสมอ
 */

/** ชดเชยเวลาไทย (นาที) — ไทยไม่มี DST จึงคงที่ +7 ชม. */
const TH_OFFSET_MIN = 7 * 60;

export interface DiscordRound {
  id: string;
  label: string;
  /** "HH:mm" 24 ชม. เวลาไทย */
  time: string;
  /** override รูปขั้นต่ำเฉพาะรอบนี้ (undefined = ใช้ค่ากลางของห้อง) */
  minImages?: number;
}

export interface ChannelRule {
  topicId: string;
  rounds: DiscordRound[];
  /** รูปขั้นต่ำค่ากลางของห้อง */
  minImages: number;
}

/** สถานะวันทำงานรายคนจาก HR roster (null = ไม่มีข้อมูล/ไม่ได้ยึด roster) */
export type WorkState = "WORKING" | "OFF" | "LEAVE" | "HOLIDAY" | "NO_SHIFT" | null;

export type SubmissionStatus = "on-time" | "late" | "image-incomplete" | "exempt";

export interface DecisionInput {
  /** เวลาโพสต์ (ISO, UTC) */
  postedAtIso: string;
  imageCount: number;
  rule: ChannelRule;
  /** true = วันนี้ต้องส่ง (นับ), false = ยกเว้น (ลา/หยุด/วันพัก/ไม่มีกะ) */
  mustReport: boolean;
}

export interface Decision {
  /** วันที่รายงาน (เวลาไทย) "YYYY-MM-DD" */
  reportDate: string;
  /** รอบที่โพสต์นี้เข้า */
  roundId: string;
  status: SubmissionStatus;
  /** true = ควรหักคะแนน (status = late) */
  shouldDock: boolean;
}

/** เวลาไทยของ ISO: คืน { date:"YYYY-MM-DD", minutes: นาทีจากเที่ยงคืน } */
export function toThaiLocal(iso: string): { date: string; minutes: number } {
  const local = new Date(new Date(iso).getTime() + TH_OFFSET_MIN * 60_000);
  const date = local.toISOString().slice(0, 10);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  return { date, minutes };
}

function cutoffMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * เลือกว่าโพสต์เข้ารอบไหน + ตรงเวลา/สาย
 * - รอบแรกที่ cutoff >= เวลาโพสต์ = ตรงเวลาสำหรับรอบนั้น
 * - ถ้าเลยทุก cutoff = สายของรอบสุดท้าย
 * (ล้อ onTimeCutoffFor / lateCutoffFor ของหน้า report)
 */
function pickRound(
  minutes: number,
  rounds: DiscordRound[]
): { round: DiscordRound; late: boolean } | null {
  if (rounds.length === 0) return null;
  const sorted = [...rounds].sort((a, b) => cutoffMinutes(a.time) - cutoffMinutes(b.time));
  for (const r of sorted) {
    if (cutoffMinutes(r.time) >= minutes) return { round: r, late: false };
  }
  return { round: sorted[sorted.length - 1]!, late: true };
}

export function decide(input: DecisionInput): Decision {
  const { date, minutes } = toThaiLocal(input.postedAtIso);
  const picked = pickRound(minutes, input.rule.rounds);
  const roundId = picked?.round.id ?? "default";

  if (!input.mustReport) {
    return { reportDate: date, roundId, status: "exempt", shouldDock: false };
  }

  const required = picked?.round.minImages ?? input.rule.minImages;
  const imagesOk = input.imageCount >= required;

  if (picked?.late) {
    return { reportDate: date, roundId, status: "late", shouldDock: true };
  }
  if (!imagesOk) {
    return { reportDate: date, roundId, status: "image-incomplete", shouldDock: false };
  }
  return { reportDate: date, roundId, status: "on-time", shouldDock: false };
}
