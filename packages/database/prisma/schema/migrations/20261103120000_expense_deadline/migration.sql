-- กำหนดบันทึกค่าใช้จ่ายของใบงานที่ปิดแล้ว (ผู้ใช้ 3/11/2569) — เพิ่มอย่างเดียว ปิดอยู่จนกว่าจะตั้ง expense_track_from
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "expense_due_date" TIMESTAMP(3);
ALTER TABLE "maintenance"."work_order_due_requests" ADD COLUMN IF NOT EXISTS "kind" TEXT;
ALTER TABLE "core"."performance_settings" ADD COLUMN IF NOT EXISTS "expense_track_from" DATE;
ALTER TABLE "core"."performance_settings" ADD COLUMN IF NOT EXISTS "expense_track_days" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "core"."performance_settings" ADD COLUMN IF NOT EXISTS "expense_recorder_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
