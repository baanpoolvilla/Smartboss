-- นับเวลาที่อยู่ต่อหลังเลิกกะในวันทำงานปกติเป็น OT ไหม
--
-- เดิมทุกวันที่ทำงานเกินกะถูกเสนอเป็น OT (ot_candidate_minutes) — บางบริษัทนับ OT
-- เฉพาะวันหยุด (วันหยุดตามกะ วันนักขัตฤกษ์ วันหยุดประจำเดือน) เท่านั้น
-- false = OT เฉพาะวันหยุด · เวลาที่เกินกะในวันทำงานยังไม่นับเป็นเวลาจ่ายเงินปกติเหมือนเดิม
ALTER TABLE workforce.work_policies
  ADD COLUMN IF NOT EXISTS ot_on_workdays boolean NOT NULL DEFAULT false;
