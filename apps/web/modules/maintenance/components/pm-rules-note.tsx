import { Info } from "lucide-react";
import { ROUND_REMIND_DAYS } from "@/modules/maintenance/lib/pm-rounds";

/**
 * บอกกติกา PM ให้คนใช้งานรู้ตรงหน้าจอ (ผู้ใช้ 4/11/2569 "อยากให้มีบอกให้ชัดเจน")
 * ตัวเลขมาจากการตั้งค่าจริงของบริษัท เปลี่ยนคะแนนแล้วข้อความเปลี่ยนตาม
 */
export function PmRulesNote({ points, leadDays, className = "" }: { points: number; leadDays: number; className?: string }) {
  const before = ROUND_REMIND_DAYS.filter((d) => d > 0 && d < leadDays).join(", ");
  return (
    <section data-testid="pm-rules" className={`rounded-(--radius) border border-[#BFDBFE] bg-[#EFF6FF] p-3 text-[13px] text-[#1E40AF] ${className}`}>
      <p className="mb-1 flex items-center gap-1.5 font-semibold">
        <Info className="h-4 w-4 shrink-0" /> แผน PM ทำงานแบบนี้
      </p>
      <ul className="list-disc space-y-0.5 pl-6">
        <li>ใบงานขึ้นก่อนครบกำหนด {leadDays} วัน เตือนตอนใบขึ้น ก่อนครบกำหนด {before} วัน และวันครบกำหนด</li>
        <li>ใบชื่อเดียวกันหลายใบคือคนละรอบ ต้องปิดทุกใบ ถึงรอบใหม่ใบใหม่ก็ขึ้นแม้ใบเก่ายังไม่ปิด</li>
        <li>เลยกำหนดหัก {Math.abs(points)} คะแนนต่อรอบ ทำไม่ทันให้กด &quot;ขอเลื่อนกำหนดส่ง&quot; ก่อนถึงกำหนด</li>
      </ul>
      <details className="mt-1 pl-6">
        <summary className="cursor-pointer font-medium">ดูเพิ่ม</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>รอบเดินตามวันที่ตั้งไว้ ปิดงานวันไหนรอบถัดไปก็ไม่ขยับ</li>
          <li>สร้างแผนแล้วครบกำหนดภายใน {leadDays} วัน ใบงานขึ้นทันที</li>
          <li>เลยกำหนดเตือนทุกวันจนกว่าจะปิด ไม่มีผ่อนผัน</li>
          <li>ค้างตั้งแต่ 2 รอบ CEO รวมเป็นใบเดียวและเลือกได้ว่าจะหักคะแนนหรือไม่ ทำครั้งเดียวครบหลายรอบให้แจ้ง CEO</li>
          <li>แผนแบบจำกัดจำนวนครั้งต่างออกไป: นัดวันเองทีละครั้งหลังจบแต่ละครั้ง</li>
        </ul>
      </details>
    </section>
  );
}
