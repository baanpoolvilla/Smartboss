-- ออกเงินเดือนในนามหลายบริษัท (ผู้ใช้ 27/11/2569 "บริษัทเรามีทั้งหมด 3 บริษัท … เลือกว่าคนนี้ออกในนามบริษัทไหน")
-- เพิ่มอย่างเดียว — พฤติกรรมเดิมไม่เปลี่ยน:
--   บริษัทหลัก = ข้อมูลใน salary.settings เหมือนเดิม (ไม่ต้องย้ายข้อมูล) · ตารางนี้เก็บเฉพาะบริษัทอื่น
--   profiles.pay_company_id NULL = บริษัทหลัก (ทุกคนตอนนี้)
--   run_lines.company_id = บริษัทของคนนั้น ณ ตอนคำนวณ · NULL = บริษัทหลัก (รอบเก่าทั้งหมด)
--   settings.company_address ว่าง = หัวสลิปไม่มีที่อยู่ (เหมือนเดิม)

CREATE TABLE "salary"."companies" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tax_id" TEXT NOT NULL DEFAULT '',
  "branch" TEXT NOT NULL DEFAULT '000000',
  "sso_employer_no" TEXT NOT NULL DEFAULT '',
  "pay_bank_name" TEXT NOT NULL DEFAULT '',
  "pay_bank_account" TEXT NOT NULL DEFAULT '',
  "address" TEXT NOT NULL DEFAULT '',
  "retired_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_name" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "companies_org_id_idx" ON "salary"."companies"("org_id");

ALTER TABLE "salary"."companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "salary"."companies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "companies_isolation" ON "salary"."companies"
  USING ("org_id" = "salary".current_org_id()) WITH CHECK ("org_id" = "salary".current_org_id());
-- ไม่มี DELETE — เลิกใช้ = ตั้ง retired_at (รอบเก่ายังอ้างถึงได้)
GRANT SELECT, INSERT, UPDATE ON "salary"."companies" TO workforce_app;

ALTER TABLE "salary"."profiles" ADD COLUMN "pay_company_id" TEXT;
ALTER TABLE "salary"."run_lines" ADD COLUMN "company_id" TEXT;
ALTER TABLE "salary"."settings" ADD COLUMN "company_address" TEXT NOT NULL DEFAULT '';
