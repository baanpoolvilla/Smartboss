import { CircleCheck, Hourglass } from "lucide-react";
import { hasPassed, scorePeriodLabel, type ScorePeriodConfig } from "@/lib/score-period";
import { thaiDateTime } from "@/components/score-period-notice";

const THAI_MONTH_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

/**
 * เกรดของรอบที่กำลังดูพร้อมเอาไปคำนวณเงินเดือนหรือยัง — สำหรับหน้าที่ HR ใช้ (แท็บคะแนน ค่าคอม ภาพรวมผลงาน)
 * `readyAt` จาก loadScorePeriodReadyAt (กะที่เลิกช้าที่สุดของบริษัท)
 */
export function ScorePeriodStatus({
  period,
  month,
  readyAt,
}: {
  period: ScorePeriodConfig;
  month: string;
  readyAt: Date;
}) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const name = `${THAI_MONTH_FULL[m - 1]} ${y + 543}`;
  const ready = hasPassed(readyAt);
  return ready ? (
    <div className="flex items-start gap-2 rounded-(--radius) border border-(--tone-ok)/35 bg-(--tone-ok)/10 px-3 py-2 text-sm text-(--ink)">
      <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-(--tone-ok)" aria-hidden />
      <span className="min-w-0">
        <b>เกรด{name} ปิดรอบแล้ว · พร้อมใช้คำนวณเงินเดือน</b>
        <span className="block text-xs text-(--ink-soft)">
          {scorePeriodLabel(period, month)} · ปิดเมื่อ {thaiDateTime(readyAt)} · ตัวเลขชุดนี้ไม่เปลี่ยนอีก
        </span>
      </span>
    </div>
  ) : (
    <div className="flex items-start gap-2 rounded-(--radius) border border-(--tone-warn)/35 bg-(--tone-warn)/10 px-3 py-2 text-sm text-(--ink)">
      <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-(--tone-warn)" aria-hidden />
      <span className="min-w-0">
        <b>เกรด{name} ยังนับอยู่ · ยังไม่ใช่ยอดสุดท้าย</b>
        <span className="block text-xs text-(--ink-soft)">
          {scorePeriodLabel(period, month)} · พร้อมใช้คำนวณเงินเดือน {thaiDateTime(readyAt)} · ก่อนหน้านั้นตัวเลขยังเปลี่ยนได้
        </span>
      </span>
    </div>
  );
}
