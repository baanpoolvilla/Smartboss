-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "requests";

-- CreateTable
CREATE TABLE "requests"."requests" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "beneficiary_user_id" TEXT,
    "beneficiary_name" TEXT NOT NULL,
    "beneficiary_kind" TEXT NOT NULL,
    "employment_id" TEXT,
    "vendor_id" TEXT,
    "property_id" TEXT,
    "property_name" TEXT,
    "work_order_id" TEXT,
    "work_order_code" TEXT,
    "work_date" DATE NOT NULL,
    "ot_start" TEXT,
    "ot_end" TEXT,
    "ot_minutes" INTEGER,
    "ot_percent" DECIMAL(6,2),
    "ot_rate_label" TEXT,
    "ot_base" DECIMAL(12,2),
    "ot_base_kind" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "vat_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "wht_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "wht_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "lines" JSONB,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "created_by" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approver_level" TEXT NOT NULL,
    "decided_by" TEXT,
    "decided_by_name" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "cancelled_by_name" TEXT,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "received_at" TIMESTAMPTZ(6),
    "deduct_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deducted_at" TIMESTAMPTZ(6),
    "deducted_by_name" TEXT,
    "deducted_period" TEXT,
    "clear_due_date" DATE,
    "clear_status" TEXT,
    "clear_spent" DECIMAL(12,2),
    "clear_returned" DECIMAL(12,2),
    "clear_note" TEXT,
    "cleared_at" TIMESTAMPTZ(6),
    "cleared_by_name" TEXT,
    "dw_ot_entry_id" TEXT,
    "dw_payment_id" TEXT,
    "maintenance_expense_id" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requests"."payments" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL,
    "paid_on" DATE NOT NULL,
    "petty_holder_id" TEXT,
    "payroll_period" TEXT,
    "slips" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT NOT NULL DEFAULT '',
    "by_user_id" TEXT NOT NULL,
    "by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(6),
    "voided_by_name" TEXT,
    "void_reason" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requests"."events" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "request_id" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by_user_id" TEXT NOT NULL,
    "by_name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" JSONB,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requests"."vendors" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'person',
    "tax_id" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "bank_name" TEXT NOT NULL DEFAULT '',
    "bank_account" TEXT NOT NULL DEFAULT '',
    "account_name" TEXT NOT NULL DEFAULT '',
    "wht_percent" DECIMAL(5,2) NOT NULL DEFAULT 3,
    "vat_registered" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requests"."petty_cash_entries" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "holder_user_id" TEXT NOT NULL,
    "holder_name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "delta" DECIMAL(12,2) NOT NULL,
    "request_id" TEXT,
    "payment_id" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "by_user_id" TEXT NOT NULL,
    "by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(6),
    "voided_by_name" TEXT,
    "void_reason" TEXT,

    CONSTRAINT "petty_cash_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requests"."settings" (
    "org_id" TEXT NOT NULL,
    "ot_rates" JSONB NOT NULL,
    "advance_cap_mode" TEXT NOT NULL DEFAULT 'baht',
    "advance_cap_value" DECIMAL(12,2) NOT NULL DEFAULT 3000,
    "wht_rates" JSONB NOT NULL,
    "vat_percent" DECIMAL(5,2) NOT NULL DEFAULT 7,
    "receipt_max_age_days" INTEGER NOT NULL DEFAULT 60,
    "clear_due_days" INTEGER NOT NULL DEFAULT 7,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("org_id")
);

-- CreateIndex
CREATE INDEX "requests_org_id_status_idx" ON "requests"."requests"("org_id", "status");

-- CreateIndex
CREATE INDEX "requests_org_id_work_date_idx" ON "requests"."requests"("org_id", "work_date");

-- CreateIndex
CREATE INDEX "requests_org_id_beneficiary_user_id_idx" ON "requests"."requests"("org_id", "beneficiary_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "requests_org_id_code_key" ON "requests"."requests"("org_id", "code");

-- CreateIndex
CREATE INDEX "payments_org_id_request_id_idx" ON "requests"."payments"("org_id", "request_id");

-- CreateIndex
CREATE INDEX "events_org_id_request_id_idx" ON "requests"."events"("org_id", "request_id");

-- CreateIndex
CREATE INDEX "events_org_id_at_idx" ON "requests"."events"("org_id", "at");

-- CreateIndex
CREATE INDEX "vendors_org_id_idx" ON "requests"."vendors"("org_id");

-- CreateIndex
CREATE INDEX "petty_cash_entries_org_id_holder_user_id_idx" ON "requests"."petty_cash_entries"("org_id", "holder_user_id");



-- ═══════════════════════════════════════════════════════════════════════
-- เบิกจ่าย & OT — กติกาที่ฐานข้อมูลบังคับเอง (ผู้ใช้ 21/10/2569)
-- ข้อมูลเงินแยกตามบริษัท ห้ามหลุดข้ามบริษัท · แก้ด้วยการยกเลิก ไม่ลบประวัติ
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "requests"."requests"
  ADD CONSTRAINT "requests_kind_valid" CHECK ("kind" IN ('ot', 'advance', 'expense', 'cash_advance', 'contractor')),
  ADD CONSTRAINT "requests_status_valid" CHECK ("status" IN ('pending', 'approved', 'rejected', 'paid', 'cancelled')),
  ADD CONSTRAINT "requests_amount_nonneg" CHECK ("amount" >= 0 AND "net_amount" >= 0 AND "vat_amount" >= 0 AND "wht_amount" >= 0 AND "deduct_amount" >= 0),
  ADD CONSTRAINT "requests_level_valid" CHECK ("approver_level" IN ('hr', 'ceo')),
  ADD CONSTRAINT "requests_clear_valid" CHECK ("clear_status" IS NULL OR "clear_status" IN ('submitted', 'cleared'));
ALTER TABLE "requests"."payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "payments_method_valid" CHECK ("method" IN ('transfer', 'cash', 'petty_cash', 'payroll', 'worker_ledger')),
  ADD CONSTRAINT "payments_petty_has_holder" CHECK ("method" <> 'petty_cash' OR "petty_holder_id" IS NOT NULL),
  ADD CONSTRAINT "payments_void_complete" CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL));
ALTER TABLE "requests"."petty_cash_entries"
  ADD CONSTRAINT "petty_kind_valid" CHECK ("kind" IN ('top_up', 'spend', 'return', 'adjust')),
  ADD CONSTRAINT "petty_delta_nonzero" CHECK ("delta" <> 0),
  ADD CONSTRAINT "petty_sign_matches_kind" CHECK (("kind" IN ('top_up', 'return') AND "delta" > 0) OR ("kind" = 'spend' AND "delta" < 0) OR "kind" = 'adjust'),
  ADD CONSTRAINT "petty_void_complete" CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL));
ALTER TABLE "requests"."vendors"
  ADD CONSTRAINT "vendors_wht_range" CHECK ("wht_percent" >= 0 AND "wht_percent" <= 15);
ALTER TABLE "requests"."settings"
  ADD CONSTRAINT "settings_cap_mode_valid" CHECK ("advance_cap_mode" IN ('none', 'baht', 'days')),
  ADD CONSTRAINT "settings_cap_nonneg" CHECK ("advance_cap_value" >= 0);

-- บริษัทปัจจุบันมาจาก GUC ที่ตั้งใน transaction — ไม่ได้ตั้ง = NULL = ไม่ match อะไรเลย (fail closed)
CREATE OR REPLACE FUNCTION "requests".current_org_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('requests.org_id', true), '')
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['requests', 'payments', 'events', 'vendors', 'petty_cash_entries', 'settings'] LOOP
    EXECUTE format('ALTER TABLE "requests".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "requests".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON "requests".%I USING ("org_id" = "requests".current_org_id()) WITH CHECK ("org_id" = "requests".current_org_id())', t || '_isolation', t);
  END LOOP;
END
$$;

-- role ธรรมดาตัวเดียวกับระบบบุคคล/คนงาน (workforce_app — NOLOGIN NOBYPASSRLS) · ไม่มีก็สร้าง
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workforce_app') THEN
    CREATE ROLE workforce_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA "requests" TO workforce_app;
GRANT EXECUTE ON FUNCTION "requests".current_org_id() TO workforce_app;
-- ไม่มี DELETE เลยทั้ง schema
GRANT SELECT, INSERT ON "requests"."requests" TO workforce_app;
GRANT SELECT, INSERT, UPDATE ON "requests"."vendors", "requests"."settings" TO workforce_app;
GRANT SELECT, INSERT ON "requests"."payments", "requests"."events", "requests"."petty_cash_entries" TO workforce_app;
-- จ่ายแล้ว/ลงเงินสดย่อยแล้ว แก้ตัวเลขไม่ได้ — แก้ได้แค่ช่องยกเลิก
GRANT UPDATE ("voided_at", "voided_by_name", "void_reason") ON "requests"."payments", "requests"."petty_cash_entries" TO workforce_app;
-- คำขอ: แก้บริษัท/เลขที่/ประเภท/คนยื่น/เวลายื่นไม่ได้ (ให้สิทธิ์แก้รายคอลัมน์ — REVOKE รายคอลัมน์ไม่มีผลถ้าให้ทั้งตารางไว้)
GRANT UPDATE ("status", "title", "detail", "beneficiary_user_id", "beneficiary_name", "beneficiary_kind", "employment_id", "vendor_id", "property_id", "property_name", "work_order_id", "work_order_code", "work_date", "ot_start", "ot_end", "ot_minutes", "ot_percent", "ot_rate_label", "ot_base", "ot_base_kind", "amount", "vat_percent", "vat_amount", "wht_percent", "wht_amount", "net_amount", "lines", "attachments", "approver_level", "decided_by", "decided_by_name", "decided_at", "decision_note", "cancelled_by_name", "cancelled_at", "cancel_reason", "received_at", "deduct_amount", "deducted_at", "deducted_by_name", "deducted_period", "clear_due_date", "clear_status", "clear_spent", "clear_returned", "clear_note", "cleared_at", "cleared_by_name", "dw_ot_entry_id", "dw_payment_id", "maintenance_expense_id", "updated_at") ON "requests"."requests" TO workforce_app;

-- ── สิทธิ์ของโมดูล (แคตตาล็อกอยู่ใต้โมดูล hr — manifest ใช้ requiresModule: "hr") ──
INSERT INTO "core"."permissions" ("id", "code", "module_id")
SELECT gen_random_uuid()::text, c, (SELECT m."id" FROM "core"."modules" m WHERE m."code" = 'hr')
FROM unnest(ARRAY['requests.access', 'requests.file_others', 'requests.approve', 'requests.approve_ceo',
                  'requests.pay', 'requests.petty_cash', 'requests.view_all', 'requests.settings']) AS c
ON CONFLICT ("code") DO NOTHING;

-- ค่าตั้งต้น (ปรับได้ที่ /admin/roles):
--   ทุกบทบาทยกเว้นคนงาน = ยื่นเบิกของตัวเอง · แอดมิน/ผู้ดูแลบ้าน/HR/ผู้จัดการ/CEO = ลงให้คนอื่น
--   HR + CEO = อนุมัติ · CEO = อนุมัติระดับ CEO (เบิกล่วงหน้า + ใบที่ HR ยื่นเอง)
--   HR = จ่ายเงิน · แอดมิน + HR = ถือเงินสดย่อย · HR/CEO/แอดมิน = ดูทั้งหมด · HR/CEO = ตั้งค่า
INSERT INTO "core"."role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "core"."roles" r
JOIN "core"."permissions" p ON
     (p."code" = 'requests.access' AND r."code" <> 'WORKER')
  OR (p."code" = 'requests.file_others' AND r."code" IN ('ADMIN', 'HR_OFFICER', 'CARETAKER', 'MANAGER', 'CEO'))
  OR (p."code" = 'requests.approve' AND r."code" IN ('HR_OFFICER', 'CEO'))
  OR (p."code" = 'requests.approve_ceo' AND r."code" = 'CEO')
  OR (p."code" = 'requests.pay' AND r."code" = 'HR_OFFICER')
  OR (p."code" = 'requests.petty_cash' AND r."code" IN ('ADMIN', 'HR_OFFICER'))
  OR (p."code" = 'requests.view_all' AND r."code" IN ('HR_OFFICER', 'CEO', 'ADMIN'))
  OR (p."code" = 'requests.settings' AND r."code" IN ('HR_OFFICER', 'CEO'))
WHERE r."org_id" IS NOT NULL
ON CONFLICT DO NOTHING;
