-- เบี้ยขยัน: ขั้นรอบก่อนดูจากงวดก่อนหน้าโดยตรง (ไม่ต้องรอจ่าย) · งวดก่อนค่านี้ไม่นับ (ผู้ใช้ 26/11/2569)
-- null = นับทุกงวด · บริษัทที่เปิดเบี้ยขยันอยู่แล้ว เริ่มนับตั้งแต่งวด 2026-11 (งวดแรกที่ใช้เงินเดือนในระบบจริง — ก่อนหน้านั้นเป็นงวดทดลอง)
ALTER TABLE "salary"."settings" ADD COLUMN "diligence_from_period" TEXT;
UPDATE "salary"."settings" SET "diligence_from_period" = '2026-11' WHERE "diligence_enabled" = true;
