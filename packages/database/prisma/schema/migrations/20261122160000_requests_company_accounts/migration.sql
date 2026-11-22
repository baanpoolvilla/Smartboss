-- จ่ายรายการหัก ณ ที่จ่ายจากบัญชีบริษัท (ผู้ใช้ 22/11/2569 — นำไปหักภาษีได้) · ค่าเริ่มต้น = แบบเดิม
ALTER TABLE "requests"."settings"
  ADD COLUMN "company_accounts" JSONB,
  ADD COLUMN "wht_company_only" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "requests"."payments"
  ADD COLUMN "company_account_id" TEXT,
  ADD COLUMN "company_account_label" TEXT;
-- ผู้จ่ายเงินใน 50 ทวิ (พิมพ์จากใบที่จ่ายแล้ว แบบ PEAK)
ALTER TABLE "requests"."settings"
  ADD COLUMN "payer_name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "payer_tax_id" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "payer_address" TEXT NOT NULL DEFAULT '';
