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
        <li>รอบเดินตามวันที่ตั้งไว้ ปิดงานวันไหนรอบถัดไปก็ไม่ขยับ</li>
        <li>ใบงานขึ้นก่อนครบกำหนด {leadDays} วัน ถ้าสร้างแผนแล้วอยู่ในช่วงนี้ ใบงานขึ้นทันที</li>
        <li>เตือนผู้รับผิดชอบตอนใบขึ้น ก่อนครบกำหนด {before} วัน และวันครบกำหนด เลยกำหนดเตือนทุกวัน</li>
        <li>ถึงรอบใหม่ใบใหม่ก็ขึ้น แม้ใบเก่ายังไม่ปิด คนทำเลือกปิดทีละใบได้</li>
        <li>เลยกำหนดหัก {Math.abs(points)} คะแนนต่อรอบ ไม่มีผ่อนผัน ทำไม่ทันให้กด &quot;ขอเลื่อนกำหนดส่ง&quot; ก่อนถึงกำหนด</li>
        <li>ค้างตั้งแต่ 2 รอบ CEO รวมเป็นใบเดียวและเลือกได้ว่าจะหักคะแนนหรือไม่</li>
        <li>แผนแบบจำกัดจำนวนครั้งต่างออกไป: นัดวันเองทีละครั้งหลังจบแต่ละครั้ง</li>
      </ul>
    </section>
  );
}
