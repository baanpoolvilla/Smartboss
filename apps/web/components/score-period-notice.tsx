import { TriangleAlert } from "lucide-react";
import { cutoffDayOf, daysUntilCutoff, scorePeriodLabel, scorePeriodOf, shiftPeriodMonth, type ScorePeriodConfig } from "@/lib/score-period";

const THAI_MONTH_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${THAI_MONTH_FULL[m - 1]} ${y + 543}`;
}

/**
 * ⚠ แจ้งวันตัดรอบเกรด (score-period.ts) — ขึ้นบนหน้าคะแนน กดแล้วกางอ่านกติกา
 * ใช้ <details> ล้วน ไม่ต้องมี JS ฝั่ง client
 */
/** "26 พ.ย. 2569 00:00 น." ตามเวลาไทย */
export function thaiDateTime(at: Date): string {
  return `${at.toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" })} ${at.toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" })} น.`;
}

export function ScorePeriodNotice({
  period,
  readyAt,
  now = new Date(),
}: {
  period: ScorePeriodConfig;
  /** เกรดรอบปัจจุบันพร้อมใช้ (นิ่ง คิดเงินเดือนได้) — loadScorePeriodReadyAt */
  readyAt?: Date;
  now?: Date;
}) {
  const current = scorePeriodOf(period, now);
  const next = shiftPeriodMonth(current, 1);
  const left = daysUntilCutoff(period, now);
  const cutoff = cutoffDayOf(period, current);
  // เปลี่ยนเฉพาะเดือนนี้ (HR ตั้ง) ต่างจาก "เดือนนี้ไม่มีวันนั้น เลยใช้วันสุดท้าย"
  const changed = period.overrides[current] !== undefined && cutoff !== period.cutoffDay;
  const clamped = !changed && cutoff !== period.cutoffDay;

  return (
    <details className="group rounded-(--radius) border border-(--tone-warn)/40 bg-(--tone-warn)/8 px-3 py-2 text-sm">
      <summary className="flex cursor-pointer list-none items-start gap-2 text-(--ink) [&::-webkit-details-marker]:hidden">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-(--tone-warn)" aria-hidden />
        <span className="min-w-0 flex-1">
          <b>
            ตัดรอบเกรดวันที่ {cutoff}{" "}
            {changed ? "(เดือนนี้เปลี่ยนจากปกติ)" : clamped ? "(วันสุดท้ายของเดือนนี้)" : "ของทุกเดือน"}
          </b>
          {" · "}
          {left === 0 ? "วันนี้วันสุดท้ายของรอบ" : `อีก ${left} วัน`}
          <span className="block text-xs text-(--ink-soft)">
            รอบเกรด{monthName(current)}: {scorePeriodLabel(period, current)} · กดอ่านรายละเอียด
          </span>
          {readyAt && (
            <span className="block text-xs text-(--ink-soft)">เกรดรอบนี้พร้อมใช้คิดเงินเดือน: {thaiDateTime(readyAt)}</span>
          )}
        </span>
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-9 text-xs leading-relaxed text-(--ink-soft)">
        <li>
          เกรดของแต่ละเดือนนับคะแนนตั้งแต่วันถัดจากวันตัดรอบของเดือนก่อน ถึงวันตัดรอบของเดือนนั้น เช่น เกรด{monthName(current)} ={" "}
          {scorePeriodLabel(period, current)}
        </li>
        <li>
          เรื่องที่เกิดหลังวันตัดรอบไปนับในเกรดเดือนถัดไป ({monthName(next)}: {scorePeriodLabel(period, next)})
        </li>
        <li>
          รอบปิดตอน 23:59 ของวันตัดรอบ คำร้องขอแก้คะแนน การอนุมัติ และการแก้เวลาลงเวลา ต้องทำให้ทันก่อนเวลานี้
        </li>
        <li>ปิดแล้วเกรดของรอบนั้นไม่เปลี่ยนอีก (ใช้คิดเงินเดือน) และไม่มีการย้ายไปปรับในรอบถัดไป</li>
        <li>
          เกรดพร้อมใช้ (นิ่ง เอาไปคิดเงินเดือนได้) เมื่อระบบหักคะแนนของวันตัดรอบครบ คิดจากกะที่เลิกช้าที่สุดของบริษัท
          {readyAt ? ` รอบนี้คือ ${thaiDateTime(readyAt)}` : ""}
        </li>
        <li>ระบบหักคะแนนลงเวลาเมื่อกะจบ กะปกติหักภายใน 23:59 ของวันนั้น ส่วนกะดึกที่เลิกเช้าวันถัดไป หักหลังเลิกกะและยังนับในรอบของวันที่เข้ากะ</li>
        <li>
          วันตัดรอบปกติคือวันที่ {period.cutoffDay} ของทุกเดือน เดือนที่ไม่มีวันนั้นตัดวันสุดท้ายของเดือนแทน บางเดือนฝ่ายบุคคลอาจเปลี่ยนวันได้
          ป้ายนี้จะบอกวันของเดือนนั้นเสมอ
        </li>
      </ul>
    </details>
  );
}
