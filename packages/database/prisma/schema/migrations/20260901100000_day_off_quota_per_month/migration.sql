-- โควตาวันหยุดผูกกับ (employment, month) ไม่ใช่ (employment) เฉย ๆ —
-- ตั้งไว้เดือนนี้ต่างจากค่าปกติ ไม่ควรมีผลกับเดือนอื่นตลอดกาล

-- ลบ PK เดิมก่อนเพิ่มคอลัมน์ที่จะเป็นส่วนหนึ่งของ PK ใหม่
ALTER TABLE "core"."employee_day_off_quotas" DROP CONSTRAINT "employee_day_off_quotas_pkey";

-- คอลัมน์ใหม่ default เป็นเดือนปัจจุบัน — แถวเก่า (ถ้ามี ตั้งไว้วันนี้เป็นการทดสอบ)
-- จะกลายเป็นโควตาของเดือนนี้เดือนเดียว ตรงกับพฤติกรรมใหม่ที่ตั้งใจไว้
ALTER TABLE "core"."employee_day_off_quotas"
  ADD COLUMN "month" TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM');

ALTER TABLE "core"."employee_day_off_quotas" ALTER COLUMN "month" DROP DEFAULT;

ALTER TABLE "core"."employee_day_off_quotas"
  ADD CONSTRAINT "employee_day_off_quotas_pkey" PRIMARY KEY ("org_id", "employment_id", "month");
