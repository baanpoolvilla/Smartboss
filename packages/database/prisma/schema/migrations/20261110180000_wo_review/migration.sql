-- ตรวจใบแจ้งซ่อมก่อนบันทึกค่าใช้จ่าย (10/11/2569) — ใบเดิมทั้งหมดเป็น 'none' (ไม่ต้องตรวจ) ไม่มีอะไรเปลี่ยน
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "review_state" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "review_submitted_at" TIMESTAMP(3);
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "reviewed_by" TEXT;
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3);
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "review_note" TEXT;
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "review_close" JSONB;
ALTER TABLE "core"."performance_settings" ADD COLUMN IF NOT EXISTS "wo_review_enabled" BOOLEAN NOT NULL DEFAULT true;
