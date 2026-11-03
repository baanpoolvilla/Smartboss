-- ที่ช่างกรอกตอนปิดงาน + ลายนิ้วมือใบเสร็จ + ค่าที่ AI อ่าน (ผู้ใช้ 3/11/2569) — เพิ่มอย่างเดียว
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "expense_draft" JSONB;
ALTER TABLE "maintenance"."expenses" ADD COLUMN IF NOT EXISTS "receipt_sha256" TEXT;
ALTER TABLE "maintenance"."expenses" ADD COLUMN IF NOT EXISTS "receipt_ai" JSONB;
CREATE INDEX IF NOT EXISTS "expenses_org_id_receipt_sha256_idx" ON "maintenance"."expenses"("org_id", "receipt_sha256");
