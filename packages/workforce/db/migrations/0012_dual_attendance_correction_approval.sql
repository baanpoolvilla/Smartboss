-- แก้ไขเวลาลงงาน (correction request) ต้องผ่านผู้จัดการขึ้นไป 2 คนที่ไม่ซ้ำกัน
--
-- เดิม approveAdjustment() จบในการอนุมัติครั้งเดียว — คนเดียวที่ถือสิทธิ์
-- workforce.attendance.correct.approve ก็แก้เวลาทำงานของใครก็ได้คนเดียวจบ
-- ⇒ เพิ่มชั้นที่สอง: approved_by/approved_at (คงชื่อเดิม) กลายเป็น "คนที่ 1"
-- second_approved_by/second_approved_at คือ "คนที่ 2" ต้องคนละคนกับคนที่ 1
-- และคนละคนกับผู้ขอ ก่อนสถานะจะเป็น APPROVED และเริ่มคำนวณผลลงเวลาใหม่จริง
--
-- ส่วน rejected_by/rejected_at ยังไม่เคยมีมาก่อน — สถานะ REJECTED อยู่ใน
-- CHECK constraint ตั้งแต่ 0004_scheduling_and_attendance.sql แต่ไม่เคยมี
-- service ใช้งานจริง จึงไม่เคยมีคอลัมน์ให้บันทึกว่าใครกดปฏิเสธเมื่อไร
ALTER TABLE workforce.time_event_adjustments
  ADD COLUMN IF NOT EXISTS second_approved_by uuid,
  ADD COLUMN IF NOT EXISTS second_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

-- บังคับที่ชั้น DB ด้วย ไม่พึ่งแค่โค้ดฝั่ง service — นี่คือด่านสุดท้ายของ
-- maker-checker กันเปิดสองแท็บอนุมัติให้ตัวเองครบสองรอบ หรือคนขอมาลงเป็น
-- ผู้อนุมัติคนที่สองของคำขอตัวเอง
ALTER TABLE workforce.time_event_adjustments
  ADD CONSTRAINT time_event_adjustments_second_approver_distinct
  CHECK (
    second_approved_by IS NULL
    OR (second_approved_by <> approved_by AND second_approved_by <> requested_by)
  );
