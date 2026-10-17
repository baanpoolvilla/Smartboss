-- คำขอเลื่อนกำหนดส่งของใบงานซ่อม (แบบเดียวกับ "ขอเลื่อนกำหนดส่ง" ของงานบนบอร์ดงาน)
-- ผู้รับผิดชอบขอ → CEO / คนเปิดใบงาน อนุมัติหรือไม่อนุมัติ · อนุมัติแล้วค่อยแก้ due_date ของใบงาน
-- ตารางใหม่ล้วน ไม่แตะตารางเดิม
CREATE TABLE IF NOT EXISTS "maintenance"."work_order_due_requests" (
  "id"             TEXT NOT NULL,
  "org_id"         TEXT NOT NULL,
  "work_order_id"  TEXT NOT NULL,
  "requested_by"   TEXT NOT NULL,
  "previous_date"  TIMESTAMP(3),
  "new_date"       TIMESTAMP(3) NOT NULL,
  "reason"         TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "decided_by"     TEXT,
  "decided_at"     TIMESTAMP(3),
  "decision_note"  TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_order_due_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_order_due_requests_work_order_id_fkey" FOREIGN KEY ("work_order_id")
    REFERENCES "maintenance"."work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "work_order_due_requests_org_id_work_order_id_idx" ON "maintenance"."work_order_due_requests" ("org_id", "work_order_id");
CREATE INDEX IF NOT EXISTS "work_order_due_requests_org_id_status_idx" ON "maintenance"."work_order_due_requests" ("org_id", "status");
