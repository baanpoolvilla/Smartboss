-- เงินสดย่อย/เบิกจ่าย: วงเงินรายคน · ใบรับรองแทนใบเสร็จ · จ่ายเงินสดให้ผู้รับยืนยัน · ปิดเคลียร์เองเมื่อยอดตรง · ขอเติมเท่าที่ใช้ + นับเงิน
-- ทุกคอลัมน์เพิ่มใหม่ ค่าเริ่มต้น = แบบเดิม
ALTER TABLE "requests"."requests"
  ADD COLUMN "category" TEXT,
  ADD COLUMN "limit_rule_id" TEXT,
  ADD COLUMN "no_receipt" JSONB,
  ADD COLUMN "clear_no_receipt" JSONB;
ALTER TABLE "requests"."petty_cash_entries" ADD COLUMN "no_receipt" JSONB;
ALTER TABLE "requests"."petty_topups"
  ADD COLUMN "spent_since" DECIMAL(12,2),
  ADD COLUMN "counted" DECIMAL(12,2),
  ADD COLUMN "balance_at_request" DECIMAL(12,2),
  ADD COLUMN "breakdown" JSONB;
ALTER TABLE "requests"."settings"
  ADD COLUMN "spend_limits" JSONB,
  ADD COLUMN "cash_confirm_mode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "no_receipt_max" DECIMAL(12,2),
  ADD COLUMN "auto_close_clear" BOOLEAN NOT NULL DEFAULT false;
