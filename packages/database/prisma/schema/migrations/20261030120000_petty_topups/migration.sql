-- เงินสดย่อย (ผู้ใช้ 30/10/2569):
--   * ผู้ถือ "ขอเติมเงิน" เองได้ → HR/CEO อนุมัติพร้อมแนบสลิปโอน/รูปเงินสด · ไม่มีใครอนุมัติของตัวเอง · HR ถือเอง = CEO อนุมัติ
--   * ผู้ถือจดจ่ายค่าของเล็ก ๆ บนหน้าเงินสดย่อยได้เลย (ไม่ต้องทำใบเบิก) แต่ต้องกรอกครบ — หมวด + ใบเสร็จ
-- เพิ่มอย่างเดียว ไม่แก้ของเดิม: รายการเดิมไม่มีหมวด (NULL) · ยอดคงเหลือยังคิดจาก petty_cash_entries เหมือนเดิม
ALTER TABLE "requests"."petty_cash_entries" ADD COLUMN "category" TEXT;

CREATE TABLE "requests"."petty_topups" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "holder_user_id" TEXT NOT NULL,
    "holder_name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "requested_by_user_id" TEXT NOT NULL,
    "requested_by_name" TEXT NOT NULL,
    "needs_ceo" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decided_by_user_id" TEXT,
    "decided_by_name" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "entry_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "petty_topups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "petty_topups_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "petty_topups_status_valid" CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled'))
);

CREATE INDEX "petty_topups_org_id_status_idx" ON "requests"."petty_topups"("org_id", "status");

ALTER TABLE "requests"."petty_topups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "requests"."petty_topups" FORCE ROW LEVEL SECURITY;
CREATE POLICY "petty_topups_isolation" ON "requests"."petty_topups"
  USING ("org_id" = "requests".current_org_id()) WITH CHECK ("org_id" = "requests".current_org_id());

GRANT SELECT, INSERT ON "requests"."petty_topups" TO workforce_app;
GRANT UPDATE ("status", "decided_by_user_id", "decided_by_name", "decided_at", "decision_note", "entry_id") ON "requests"."petty_topups" TO workforce_app;
