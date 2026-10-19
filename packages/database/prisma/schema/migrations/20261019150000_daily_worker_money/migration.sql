-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "daily_worker";

-- CreateTable
CREATE TABLE "daily_worker"."payments" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "pay_date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "by_user_id" TEXT NOT NULL,
    "by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB,
    "voided_at" TIMESTAMPTZ(6),
    "voided_by_name" TEXT,
    "void_reason" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_worker"."pay_rates" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "daily_wage" DECIMAL(12,2) NOT NULL,
    "ot_percent" DECIMAL(6,2),
    "effective_from" DATE NOT NULL,
    "by_user_id" TEXT NOT NULL,
    "by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_worker"."time_edits" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "work_date" DATE NOT NULL,
    "in_at" TEXT,
    "out_at" TEXT,
    "reason" TEXT NOT NULL,
    "by_user_id" TEXT NOT NULL,
    "by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_name" TEXT,

    CONSTRAINT "time_edits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_worker"."settings" (
    "org_id" TEXT NOT NULL,
    "ot_percent" DECIMAL(6,2) NOT NULL,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("org_id")
);

-- CreateIndex
CREATE INDEX "payments_org_id_employment_id_pay_date_idx" ON "daily_worker"."payments"("org_id", "employment_id", "pay_date");

-- CreateIndex
CREATE INDEX "pay_rates_org_id_employment_id_effective_from_idx" ON "daily_worker"."pay_rates"("org_id", "employment_id", "effective_from");

-- CreateIndex
CREATE INDEX "time_edits_org_id_employment_id_work_date_idx" ON "daily_worker"."time_edits"("org_id", "employment_id", "work_date");


-- ═══════════════════════════════════════════════════════════════════════
-- เงินคนงานรายวัน — กติกาที่ฐานข้อมูลบังคับเอง (ผู้ใช้ตกลง 19/10/2569: ข้อมูลเงินแยกตามบริษัท
-- ที่ซื้อ Smartboss · ห้ามหลุดข้ามบริษัท · แก้ด้วยการยกเลิก ไม่ลบประวัติ)
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "daily_worker"."payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "payments_kind_valid" CHECK ("kind" IN ('wage', 'advance')),
  ADD CONSTRAINT "payments_advance_has_note" CHECK ("kind" <> 'advance' OR length(trim("note")) > 0),
  ADD CONSTRAINT "payments_void_complete" CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL));
ALTER TABLE "daily_worker"."pay_rates"
  ADD CONSTRAINT "pay_rates_wage_positive" CHECK ("daily_wage" > 0),
  ADD CONSTRAINT "pay_rates_ot_positive" CHECK ("ot_percent" IS NULL OR "ot_percent" > 0);
ALTER TABLE "daily_worker"."time_edits"
  ADD CONSTRAINT "time_edits_in_required" CHECK ("in_at" IS NOT NULL),
  ADD CONSTRAINT "time_edits_hhmm" CHECK (("in_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND ("out_at" IS NULL OR "out_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'));
ALTER TABLE "daily_worker"."settings"
  ADD CONSTRAINT "settings_ot_positive" CHECK ("ot_percent" > 0);

-- บริษัทปัจจุบันมาจาก GUC ที่ตั้งด้วย set_config(..., true) ใน transaction — ไม่ได้ตั้ง = NULL = ไม่ match อะไรเลย (fail closed)
CREATE OR REPLACE FUNCTION "daily_worker".current_org_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('daily_worker.org_id', true), '')
$$;

-- FORCE = มีผลกับเจ้าของตารางด้วย · superuser/BYPASSRLS ยังข้ามได้ จึงต้อง SET LOCAL ROLE เป็น role ธรรมดา (ข้างล่าง)
ALTER TABLE "daily_worker"."payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_worker"."payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY payments_isolation ON "daily_worker"."payments"
  USING ("org_id" = "daily_worker".current_org_id()) WITH CHECK ("org_id" = "daily_worker".current_org_id());
ALTER TABLE "daily_worker"."pay_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_worker"."pay_rates" FORCE ROW LEVEL SECURITY;
CREATE POLICY pay_rates_isolation ON "daily_worker"."pay_rates"
  USING ("org_id" = "daily_worker".current_org_id()) WITH CHECK ("org_id" = "daily_worker".current_org_id());
ALTER TABLE "daily_worker"."time_edits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_worker"."time_edits" FORCE ROW LEVEL SECURITY;
CREATE POLICY time_edits_isolation ON "daily_worker"."time_edits"
  USING ("org_id" = "daily_worker".current_org_id()) WITH CHECK ("org_id" = "daily_worker".current_org_id());
ALTER TABLE "daily_worker"."settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_worker"."settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY settings_isolation ON "daily_worker"."settings"
  USING ("org_id" = "daily_worker".current_org_id()) WITH CHECK ("org_id" = "daily_worker".current_org_id());

-- ใช้ role ธรรมดาตัวเดียวกับระบบบุคคล (workforce_app — NOLOGIN NOBYPASSRLS) ที่แอปสลับเข้าได้อยู่แล้วบน production
-- ไม่สร้าง role ใหม่ = ไม่ต้องขอ DBA ให้สิทธิ์เพิ่มตอน deploy · ไม่มีก็สร้างแบบเดียวกับ workforce 0001
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workforce_app') THEN
    CREATE ROLE workforce_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA "daily_worker" TO workforce_app;
GRANT EXECUTE ON FUNCTION "daily_worker".current_org_id() TO workforce_app;
-- ไม่มี DELETE: ข้อมูลเงินลบไม่ได้ (ยกเลิกด้วย voided_at / revoked_at แทน)
GRANT SELECT, INSERT, UPDATE ON "daily_worker"."payments", "daily_worker"."pay_rates", "daily_worker"."time_edits", "daily_worker"."settings" TO workforce_app;
-- จ่ายแล้วแก้จำนวน/คน/วันไม่ได้ — แก้ได้แค่ช่องยกเลิก
REVOKE UPDATE ON "daily_worker"."payments" FROM workforce_app;
GRANT UPDATE ("voided_at", "voided_by_name", "void_reason") ON "daily_worker"."payments" TO workforce_app;
REVOKE UPDATE ON "daily_worker"."pay_rates" FROM workforce_app;
REVOKE UPDATE ON "daily_worker"."time_edits" FROM workforce_app;
GRANT UPDATE ("revoked_at", "revoked_by_name") ON "daily_worker"."time_edits" TO workforce_app;
