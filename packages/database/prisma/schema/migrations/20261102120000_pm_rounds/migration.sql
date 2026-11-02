-- PM แบบนับรอบ (ผู้ใช้ 2/11/2569) — เพิ่มอย่างเดียว ค่าเริ่มต้นทุกบริษัท = แบบเดิม (pm_rounds_from = null)
ALTER TABLE "core"."performance_settings" ADD COLUMN IF NOT EXISTS "pm_rounds_from" DATE;
ALTER TABLE "core"."performance_settings" ADD COLUMN IF NOT EXISTS "pm_lead_days" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "pm_round_date" DATE;
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "overdue_score" TEXT;
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "merged_into_id" TEXT;
CREATE INDEX IF NOT EXISTS "work_orders_pm_schedule_id_pm_round_date_idx" ON "maintenance"."work_orders" ("pm_schedule_id", "pm_round_date");
