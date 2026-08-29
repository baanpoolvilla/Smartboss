-- สิทธิ์วันหยุดที่ไม่ต้องขออนุมัติ
--
-- ที่มา: เจ้าของบริษัทกำหนดว่าพนักงานหยุดได้ 6 วันต่อเดือนโดยเลือกวันเอง
-- นั่นคือ "สิทธิ์" ไม่ใช่ "คำขอ" — ไม่ควรต้องรอใครกดอนุมัติ
--
-- เดิมระบบมีทางเดียวที่ทำให้วันนั้นไม่ถูกนับขาดงาน คือใบลาที่สถานะ APPROVED
-- และพนักงานไม่มีสิทธิ์อนุมัติใบของตัวเอง ⇒ ต้องมีธงบอกว่าประเภทนี้อนุมัติเอง
--
-- โควตาเดิมเป็น quota_minutes_per_year ซึ่งคุมรายเดือนไม่ได้ — ใส่ 72 ชั่วโมง/ปี
-- ก็ยังลาหมดในเดือนเดียวได้ จึงต้องมีตัวคุมรายเดือนแยกต่างหาก

ALTER TABLE workforce.leave_types
  -- true = อนุมัติทันทีตอนส่ง ไม่เข้าคิวรออนุมัติ
  ADD COLUMN IF NOT EXISTS auto_approve boolean NOT NULL DEFAULT false,
  -- 0 = ไม่จำกัดรายเดือน (ยังคุมด้วย quota_minutes_per_year ตามเดิมได้)
  ADD COLUMN IF NOT EXISTS monthly_quota_days integer NOT NULL DEFAULT 0;

-- กันค่าติดลบที่ทำให้ตรรกะเช็คโควตากลายเป็นบล็อกทุกใบเงียบ ๆ
ALTER TABLE workforce.leave_types
  DROP CONSTRAINT IF EXISTS leave_types_monthly_quota_days_check;

ALTER TABLE workforce.leave_types
  ADD CONSTRAINT leave_types_monthly_quota_days_check
  CHECK (monthly_quota_days >= 0 AND monthly_quota_days <= 31);
