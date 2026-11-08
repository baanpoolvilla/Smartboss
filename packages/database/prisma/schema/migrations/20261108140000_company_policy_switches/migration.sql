-- สวิตช์นโยบายรายบริษัท (ผู้ใช้ 8/11/2569 "บริษัทอื่นที่ซื้อไปใช้ ต้องคำนึงถึงด้วย")
-- ค่าเริ่มต้นปิด = ทุกบริษัทใช้แบบเดิม · บริษัทที่ต้องการเปิดเองในหน้าตั้งค่า
--   salary.settings.editors_edit_own      — คนที่ CEO เลือกให้ทำเงินเดือน แก้ข้อมูลเงินเดือนของตัวเองได้ (ทุกครั้งแจ้ง CEO + ป้าย "แก้โดยเจ้าตัว")
--   requests.settings.petty_spend_review  — "ซื้อของเอง" จากเงินสดย่อยต้องมีคนตรวจทีหลัง (ไม่ผ่าน = เงินขาดรอคืน)
ALTER TABLE "salary"."settings" ADD COLUMN "editors_edit_own" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "requests"."settings" ADD COLUMN "petty_spend_review" BOOLEAN NOT NULL DEFAULT false;
