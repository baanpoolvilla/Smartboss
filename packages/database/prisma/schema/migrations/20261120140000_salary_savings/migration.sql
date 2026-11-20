-- สมุดเงินสะสมรายคน (เช่น กองทุนสงเคราะห์ลูกจ้าง) — ผู้ใช้ 20/11/2569
-- เพิ่มอย่างเดียว: รายการเดิมทุกอย่าง savings = false, employer_amount = 0 → พฤติกรรมเดิมไม่เปลี่ยน
ALTER TABLE "salary"."items" ADD COLUMN "savings" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "salary"."employee_items" ADD COLUMN "employer_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE "salary"."savings_entries" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "employment_id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "employee_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "employer_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "on_date" DATE NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "created_by_name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voided_at" TIMESTAMPTZ(6),
  "voided_by_name" TEXT,
  CONSTRAINT "savings_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "savings_entries_org_id_employment_id_idx" ON "salary"."savings_entries"("org_id", "employment_id");

-- แยกบริษัทแบบเดียวกับตารางอื่นใน salary (RLS FORCE + GUC salary.org_id)
ALTER TABLE "salary"."savings_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "salary"."savings_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "savings_entries_isolation" ON "salary"."savings_entries"
  USING ("org_id" = "salary".current_org_id()) WITH CHECK ("org_id" = "salary".current_org_id());
-- ตัวเลขแก้ไม่ได้ — แก้ = ยกเลิกแถวเดิมแล้วเพิ่มใหม่
GRANT SELECT, INSERT ON "salary"."savings_entries" TO workforce_app;
GRANT UPDATE ("voided_at", "voided_by_name") ON "salary"."savings_entries" TO workforce_app;
