-- วันหยุดตามสิทธิ์รายคนรายเดือน แยกตามประเภทวันหยุด
--
-- เพิ่มคอลัมน์อย่างเดียว ข้อมูลเดิมไม่ถูกแก้: แถวเดิมได้ leave_type_id = '' ซึ่งแอปอ่านเป็น
-- "ตั้งไว้ก่อนแยกตามประเภท — ใช้กับวันหยุดตามสิทธิ์ทุกประเภทที่ยังไม่ได้ตั้งแยก" (apps/web/lib/day-off-quota.ts)
-- ไม่ย้ายไปผูกกับประเภทใดในนี้ เพราะประเภทอยู่ใน schema workforce ที่ผู้ใช้ของ migration นี้อ่านไม่ได้ (RLS)
ALTER TABLE "core"."employee_day_off_quotas" ADD COLUMN "leave_type_id" TEXT NOT NULL DEFAULT '';

-- หนึ่งคน หนึ่งเดือน มีได้หลายแถว (แถวละประเภท)
ALTER TABLE "core"."employee_day_off_quotas" DROP CONSTRAINT "employee_day_off_quotas_pkey";
ALTER TABLE "core"."employee_day_off_quotas"
  ADD CONSTRAINT "employee_day_off_quotas_pkey" PRIMARY KEY ("org_id", "employment_id", "month", "leave_type_id");
