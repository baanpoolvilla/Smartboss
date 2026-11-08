-- ค่าใช้จ่ายใบแจ้งซ่อม: ค่าของ หรือ ค่าแรง/ค่าบริการ + ภาษี (ผู้ใช้ 8/11/2569 "ทำให้เข้าใจและใช้งานง่ายที่สุด")
--   cost_kind: goods | service · NULL = รายการเดิม/ไม่ได้ระบุ
--   vat_amount / wht_percent / wht_amount: ภาษีในบิล (ถ้ามี) — amount ยังเป็นยอดเต็มตามบิล (ต้นทุนบริษัท)
--   เงินที่โอนจริง = amount − wht_amount · payee_kind: person (ภ.ง.ด.3) | company (ภ.ง.ด.53)
-- เพิ่มอย่างเดียว ของเดิมเป็น NULL ทั้งหมด
ALTER TABLE "maintenance"."expenses"
  ADD COLUMN "cost_kind" TEXT,
  ADD COLUMN "vat_amount" DECIMAL(12,2),
  ADD COLUMN "wht_percent" DECIMAL(5,2),
  ADD COLUMN "wht_amount" DECIMAL(12,2),
  ADD COLUMN "payee_kind" TEXT,
  ADD CONSTRAINT "expenses_cost_kind_valid" CHECK ("cost_kind" IS NULL OR "cost_kind" IN ('goods', 'service')),
  ADD CONSTRAINT "expenses_payee_kind_valid" CHECK ("payee_kind" IS NULL OR "payee_kind" IN ('person', 'company'));
