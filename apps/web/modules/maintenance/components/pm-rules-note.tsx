"use client";

import { useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { ROUND_REMIND_DAYS } from "@/modules/maintenance/lib/pm-rounds";
import { Button } from "@smartboss/ui/components/button";
import { Modal } from "./dialog";

import { useCeoTitle } from "@/lib/ceo-title-client";
/**
 * บอกกติกา PM ให้คนใช้งานรู้ตรงหน้าจอ (ผู้ใช้ 4/11/2569 "อยากให้มีบอกให้ชัดเจน")
 * ตัวเลขมาจากการตั้งค่าจริงของบริษัท เปลี่ยนคะแนนแล้วข้อความเปลี่ยนตาม
 *
 * เหลือแถวเดียว กดแล้วเปิดเป็นหน้าต่าง (ผู้ใช้ 5/11/2569 "มันรกไป ... แสดงเป็น pop up") —
 * คนที่รู้แล้วไม่ต้องเห็นทุกครั้ง คนที่ไม่เข้าใจกดอ่านได้
 */
export function PmRulesNote({ points, leadDays, className = "" }: { points: number; leadDays: number; className?: string }) {
  const ceo = useCeoTitle();
  const [open, setOpen] = useState(false);
  const before = ROUND_REMIND_DAYS.filter((d) => d > 0 && d < leadDays).join(", ");
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="pm-rules"
        className={`inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-1.5 text-left text-xs font-medium text-[#1E40AF] hover:bg-[#DBEAFE] ${className}`}
      >
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">แผน PM ทำงานแบบนี้ · เลยกำหนดหัก {Math.abs(points)} คะแนนต่อรอบ</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </button>
      {open && (
        <Modal
          title="แผน PM ทำงานแบบนี้"
          onClose={() => setOpen(false)}
          actions={
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)} data-testid="pm-rules-close">
              ปิด
            </Button>
          }
        >
          <div data-testid="pm-rules-body" className="text-sm text-(--ink)">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>ใบงานขึ้นในวันของรอบ แล้วมีเวลาทำ {leadDays} วัน — เตือนตอนใบขึ้น ก่อนครบกำหนด {before} วัน และวันครบกำหนด</li>
              <li>ใบชื่อเดียวกันหลายใบคือคนละรอบ ต้องปิดทุกใบ ถึงรอบใหม่ใบใหม่ก็ขึ้นแม้ใบเก่ายังไม่ปิด</li>
              <li>{`เลยกำหนดหัก ${Math.abs(points)} คะแนนต่อรอบ ทำไม่ทันให้กด "ขอเลื่อนกำหนดส่ง" ล่วงหน้า ต้องได้รับอนุมัติก่อนโดนหัก อนุมัติทีหลังไม่คืนคะแนน`}</li>
              <li>รอบเดินตามวันที่ตั้งไว้ ปิดงานวันไหนรอบถัดไปก็ไม่ขยับ</li>
              <li>สร้างแผนโดยให้รอบแรกเป็นวันนี้ ใบงานขึ้นทันที</li>
              <li>คนตั้ง PM กด &quot;ทำรอบล่วงหน้า&quot; เลือกรอบในอนาคตมาทำก่อนได้ ทำเสร็จ = รอบนั้นจบ ถึงวันแล้วระบบไม่เปิดซ้ำ</li>
              <li>เลยกำหนดเตือนทุกวันจนกว่าจะปิด ไม่มีผ่อนผัน</li>
              <li>ค้างตั้งแต่ 2 รอบ {ceo} รวมเป็นใบเดียวและเลือกได้ว่าจะหักคะแนนหรือไม่ ทำครั้งเดียวครบหลายรอบให้แจ้ง {ceo}</li>
              <li>แผนแบบกลุ่ม: ใบทุกรอบเปิดให้ทุกคนในทีม เลยกำหนดหักเฉพาะคนที่ยังไม่เสร็จ</li>
              <li>แผนแบบจำกัดจำนวนครั้งต่างออกไป: นัดวันเองทีละครั้งหลังจบแต่ละครั้ง</li>
            </ul>
          </div>
        </Modal>
      )}
    </>
  );
}
