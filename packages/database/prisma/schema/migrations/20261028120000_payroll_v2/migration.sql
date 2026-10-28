-- เงินเดือนชุดปรับปรุง (ข้อกำหนดจาก HR 28/10/2569) — ทุกคอลัมน์มีค่าตั้งต้น = พฤติกรรมเดิม
-- บริษัทที่ไม่เปิดใช้จะคำนวณเหมือนเดิมทุกอย่าง

-- ค่าคอมแบบ Grade + Tier: แบ่งยอดรวมประจำรอบเป็นก้อน Grade (ค่าตั้งต้น 70%) กับก้อน Tier (ส่วนที่เหลือ)
ALTER TABLE "core"."commission_settings"
  DROP CONSTRAINT "commission_settings_method_check",
  ADD CONSTRAINT "commission_settings_method_check" CHECK ("method" IN ('pool', 'percent', 'fixed', 'off', 'grade_tier')),
  ADD COLUMN "grade_share" DECIMAL(5, 2) NOT NULL DEFAULT 70,
  ADD CONSTRAINT "commission_settings_grade_share_check" CHECK ("grade_share" >= 0 AND "grade_share" <= 100);

-- คะแนน Tier รายคนของแต่ละรอบ { "<core.users.id>": คะแนน } — ไม่มีคีย์ = ยังไม่ได้ใส่
ALTER TABLE "core"."commission_pools"
  ADD COLUMN "tier_scores" JSONB NOT NULL DEFAULT '{}';

-- ตั้งค่าบริษัท: คิดภาษีไหม · OT แบบชั่วโมง (ตามใบ) หรือแบบวัน · เบี้ยขยันขั้นบันได
ALTER TABLE "salary"."settings"
  ADD COLUMN "tax_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "ot_mode" TEXT NOT NULL DEFAULT 'hours',
  ADD COLUMN "diligence_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "diligence_steps" JSONB NOT NULL DEFAULT '[500, 800, 1000]',
  ADD CONSTRAINT "settings_ot_mode_check" CHECK ("ot_mode" IN ('hours', 'days'));

-- รายคน: ได้เบี้ยขยันไหม · ขั้นรอบที่แล้วที่ยกมาจากระบบเดิม (ใช้ครั้งแรกที่ยังไม่มีรอบในระบบนี้)
ALTER TABLE "salary"."profiles"
  ADD COLUMN "diligence_eligible" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "diligence_opening" DECIMAL(12, 2);
