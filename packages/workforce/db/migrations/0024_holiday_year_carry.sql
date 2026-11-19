-- Holiday แบบสะสม: ตัดตามรอบปี — สิทธิ์ของปีหนึ่งใช้ข้ามไปปีถัดไปได้ไม่เกินเดือนที่ตั้ง
--
-- ที่มา (ผู้ใช้ 19/11/2569): "ปี 69 มีของ ธ.ค. จะให้สิ้นสุดแค่ ม.ค. ปี 70 เพราะมันจะข้ามปีเกินไป · ตั้งค่าปรับได้"
-- holiday_year_carry_months = C : สิทธิ์ของปี Y ใช้ได้ถึงสิ้นเดือนที่ C ของปี Y+1
--   0 = สิ้น ธ.ค. ปี Y เอง (ไม่ข้ามปี) · 1 = สิ้น ม.ค. ปีถัดไป · … · NULL = ไม่ตัดตามปี (ค่าเริ่มต้น = เหมือนเดิม)
-- ใช้ร่วมกับ holiday_valid_months: หมดอายุ = อันไหนถึงก่อน
ALTER TABLE workforce.leave_types
  ADD COLUMN IF NOT EXISTS holiday_year_carry_months integer
    CHECK (holiday_year_carry_months IS NULL OR (holiday_year_carry_months >= 0 AND holiday_year_carry_months <= 11));
