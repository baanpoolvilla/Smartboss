-- เงินสดย่อย "ซื้อของเอง" ใส่ภาษีได้ถ้ามี (ผู้ใช้ 8/11/2569 "มีให้กรอกเองว่ามีภาษีอะไรไหม ไม่มีก็ไม่ต้องใส่ ใส่เงินเต็ม ๆ ถ้ามีก็หักลบให้เอง")
--   bill_amount = ยอดเต็มตามบิล (รวม VAT) · vat_amount = VAT ในบิล (ใบกำกับเต็มรูป) · wht_* = หัก ณ ที่จ่าย คิดจากยอดก่อน VAT
--   delta = −(bill − wht) = เงินที่ออกจากมือจริง · payee_* = ผู้รับเงิน สำหรับออก 50 ทวิ / ภ.ง.ด.3 (person) หรือ 53 (company)
-- เพิ่มอย่างเดียว รายการเดิมเป็น NULL ทั้งหมด (ไม่มีภาษี ยอดตาม delta เหมือนเดิม)
ALTER TABLE "requests"."petty_cash_entries"
  ADD COLUMN "bill_amount" DECIMAL(12,2),
  ADD COLUMN "vat_amount" DECIMAL(12,2),
  ADD COLUMN "wht_percent" DECIMAL(5,2),
  ADD COLUMN "wht_amount" DECIMAL(12,2),
  ADD COLUMN "payee_name" TEXT,
  ADD COLUMN "payee_kind" TEXT,
  ADD CONSTRAINT "petty_cash_entries_payee_kind_valid" CHECK ("payee_kind" IS NULL OR "payee_kind" IN ('person', 'company'));
