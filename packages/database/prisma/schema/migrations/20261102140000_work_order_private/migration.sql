-- ใบแจ้งซ่อมส่วนตัว (ผู้ใช้ 2/11/2569) — เพิ่มอย่างเดียว ใบเดิมทั้งหมด = ไม่ส่วนตัว
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "is_private" BOOLEAN NOT NULL DEFAULT false;
