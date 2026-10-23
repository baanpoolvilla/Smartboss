-- ค่าคอมแบบยืดหยุ่น: เลือกวิธีคิดได้ (Pool ÷ ตัวคูณ · % ของเงินเดือน · บาทตายตัวต่อเกรด · ไม่คิดจากเกรด)
-- และเลือกคนที่ได้ (เฉพาะบางแผนก · ยกเว้นบางคน) — ค่าเดิมทุกบริษัท = pool + ทุกคน (เหมือนก่อนเพิ่ม)
ALTER TABLE "core"."commission_settings"
  ADD COLUMN "method" TEXT NOT NULL DEFAULT 'pool',
  ADD COLUMN "grade_values" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "eligible_department_ids" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "excluded_user_ids" TEXT[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT "commission_settings_method_check" CHECK ("method" IN ('pool', 'percent', 'fixed', 'off'));
