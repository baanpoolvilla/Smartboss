-- เบี้ยขยันของคนที่เข้างาน/ลาออกกลางรอบ (ผู้ใช้เลือก 28/10/2569: ต้องทำงานครบรอบ)
--   none    = ทำงานไม่ครบรอบ ไม่ได้รอบนั้น (รอบแรกที่ครบเริ่มขั้นแรก)
--   prorate = เฉลี่ยตามวันที่ทำงาน
--   full    = ได้เต็มขั้น
ALTER TABLE "salary"."settings"
  ADD COLUMN "diligence_partial" TEXT NOT NULL DEFAULT 'none',
  ADD CONSTRAINT "settings_diligence_partial_check" CHECK ("diligence_partial" IN ('none', 'prorate', 'full'));
