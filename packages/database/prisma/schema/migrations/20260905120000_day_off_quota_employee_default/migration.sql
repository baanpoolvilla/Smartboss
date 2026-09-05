-- โควตาวันหยุด "ประจำ" ของพนักงานรายคน
--
-- บางคนได้หยุดเดือนละ 4 วัน บางคน 6 วัน ตามสัญญาจ้างของเขา ซึ่งเป็นค่าถาวร
-- ไม่ใช่การตัดสินใจรายเดือน แต่ตารางเดิม (employee_day_off_quotas) ผูกกับ
-- (คน, เดือน) อย่างเดียว ⇒ คนที่ตกลงกันว่าได้ 6 วันจะตกกลับไปใช้ค่ามาตรฐาน
-- ของบริษัทเงียบ ๆ ในเดือนถัดไป แล้วลงวันหยุดวันที่ 5-6 ไม่ได้
--
-- ตารางนี้เป็นชั้นกลาง: เดือนนั้นโดยเฉพาะ → ค่าประจำของคนนั้น → ค่าตั้งต้นบริษัท
CREATE TABLE IF NOT EXISTS "core"."employee_day_off_quota_defaults" (
  "org_id"         TEXT NOT NULL,
  "employment_id"  TEXT NOT NULL,
  "days_per_month" INTEGER NOT NULL,
  "note"           TEXT NOT NULL DEFAULT '',
  "updated_at"     TIMESTAMP(3) NOT NULL,
  "updated_by"     TEXT,
  CONSTRAINT "employee_day_off_quota_defaults_pkey" PRIMARY KEY ("org_id", "employment_id")
);

ALTER TABLE "core"."employee_day_off_quota_defaults"
  ADD CONSTRAINT "employee_day_off_quota_defaults_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
