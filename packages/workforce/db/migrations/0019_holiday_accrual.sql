-- สิทธิ์ Holiday แบบสะสมตามวันหยุดบริษัท
--
-- ที่มา: Holiday ไม่ใช่ "N วันต่อเดือนเท่ากันทุกเดือน" แบบ Day-Off — เดือนไหนมีวันหยุดบริษัทกี่วัน
-- พนักงานก็ได้สิทธิ์ Holiday เท่านั้นวัน เลือกวันหยุดเองได้ และใช้ได้ภายใน 3 เดือน (นับรวมเดือนที่ได้สิทธิ์)
-- เกินนั้นตัดทิ้ง · monthly_quota_days (เลขเดียวใช้ทุกเดือน) จึงคุมกฎนี้ไม่ได้
--
-- จำนวนวันของแต่ละเดือนนับจากปฏิทินวันหยุดบริษัท (holiday_dates) โดยอัตโนมัติ
-- แต่บางเดือนบริษัทให้ไม่ตรงกับปฏิทิน ⇒ HR ใส่จำนวนทับรายเดือนได้ (leave_month_allowances)

ALTER TABLE workforce.leave_types
  -- true = สิทธิ์ต่อเดือนมาจากวันหยุดบริษัทของเดือนนั้น + ทบยอดได้ (ไม่ใช้ monthly_quota_days)
  -- ค่าเริ่มต้น false: ประเภทที่มีอยู่เดิมไม่เปลี่ยนพฤติกรรมจนกว่า HR จะเปิดเองที่หน้าตั้งค่า
  ADD COLUMN IF NOT EXISTS accrues_from_holidays boolean NOT NULL DEFAULT false,
  -- เดือนแรกที่เริ่มนับสิทธิ์ (วันแรกของเดือน) — ตั้งเป็นเดือนที่ HR เปิดใช้ครั้งแรก
  -- วันหยุดบริษัทและใบที่ลงไว้ก่อนเดือนนี้ไม่ถูกนำมาคิด: เริ่มนับใหม่ ไม่ย้อนหลัง
  ADD COLUMN IF NOT EXISTS accrual_starts_on date;

-- จำนวนวันที่ HR กำหนดทับสำหรับเดือนใดเดือนหนึ่ง — ไม่มีแถว = ใช้จำนวนวันหยุดบริษัทของเดือนนั้น
CREATE TABLE IF NOT EXISTS workforce.leave_month_allowances (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  company_id    uuid NOT NULL,
  leave_type_id uuid NOT NULL REFERENCES workforce.leave_types(id),
  -- วันแรกของเดือน
  month         date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  days          integer NOT NULL CHECK (days >= 0 AND days <= 31),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  CONSTRAINT leave_month_allowances_key UNIQUE (tenant_id, leave_type_id, month)
);

ALTER TABLE workforce.leave_month_allowances ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.leave_month_allowances FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_month_allowances_isolation ON workforce.leave_month_allowances;
CREATE POLICY leave_month_allowances_isolation ON workforce.leave_month_allowances
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON workforce.leave_month_allowances TO workforce_app;
