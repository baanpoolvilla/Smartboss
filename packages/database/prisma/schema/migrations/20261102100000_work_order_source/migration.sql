-- ใบแจ้งซ่อมเปิดจากรีพอต (ผู้ใช้ 2/11/2569) — จดที่มาไว้ กดกลับไปข้อความต้นทางได้
-- เพิ่มอย่างเดียว: ใบงานเดิมและใบงานที่สร้างจากหน้าใบงานเป็น null ไม่มีอะไรเปลี่ยน
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "source_label" TEXT;
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "source_link" TEXT;
