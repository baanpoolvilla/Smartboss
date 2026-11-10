-- ใบแจ้งซ่อมแบบกลุ่ม: ขอเลื่อนกำหนดส่งให้ทั้งกลุ่ม/บางคนได้ในคำขอเดียว (10/11/2569) — เพิ่มคอลัมน์อย่างเดียว คำขอเดิม = ว่าง = เฉพาะคนขอ
ALTER TABLE "maintenance"."work_order_due_requests" ADD COLUMN IF NOT EXISTS "for_user_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
