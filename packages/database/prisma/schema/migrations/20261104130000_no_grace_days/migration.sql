-- ไม่มีผ่อนผันแล้ว เลยกำหนดก็หัก ทำไม่ทันให้ขอเลื่อนกำหนดส่ง (ผู้ใช้ 4/11/2569)
ALTER TABLE "core"."performance_settings" ALTER COLUMN "pm_grace_days" SET DEFAULT 0;
UPDATE "core"."performance_settings" SET "pm_grace_days" = 0, "work_order_grace_days" = 0;
