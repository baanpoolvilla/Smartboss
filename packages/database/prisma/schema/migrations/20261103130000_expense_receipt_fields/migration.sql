-- ข้อมูลจากใบเสร็จ (ผู้ใช้ 3/11/2569) — เพิ่มอย่างเดียว
ALTER TABLE "maintenance"."expenses" ADD COLUMN IF NOT EXISTS "receipt_no" TEXT;
ALTER TABLE "maintenance"."expenses" ADD COLUMN IF NOT EXISTS "payee" TEXT;
ALTER TABLE "maintenance"."expenses" ADD COLUMN IF NOT EXISTS "payer" TEXT;
ALTER TABLE "maintenance"."expenses" ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(3);
ALTER TABLE "maintenance"."expenses" ADD COLUMN IF NOT EXISTS "payment_method" TEXT;
ALTER TABLE "maintenance"."expenses" ADD COLUMN IF NOT EXISTS "no_receipt" BOOLEAN NOT NULL DEFAULT false;
