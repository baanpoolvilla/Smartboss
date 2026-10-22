-- โมดูลเงินเดือนพนักงานประจำ (ผู้ใช้สั่งทำ 22/10/2569) — schema แยก "salary"
-- แยกข้อมูลรายบริษัทด้วย org_id + RLS แบบ FORCE ("อย่าลืมนะ แยกข้อมูลแต่ละบริษัทออกจากกันนะ")
-- แอปอ่าน/เขียนผ่าน role workforce_app (NOBYPASSRLS) + GUC salary.org_id เท่านั้น — ไม่ตั้ง = ไม่เห็นอะไรเลย

CREATE SCHEMA IF NOT EXISTS "salary";

CREATE TABLE "salary"."settings" (
    "org_id" TEXT NOT NULL,
    "cutoff_day" INTEGER NOT NULL DEFAULT 25,
    "pay_day" INTEGER NOT NULL DEFAULT 0,
    "approval_mode" TEXT NOT NULL DEFAULT 'ceo',
    "change_threshold" DECIMAL(6,2) NOT NULL DEFAULT 5,
    "deduct_late" BOOLEAN NOT NULL DEFAULT false,
    "late_mode" TEXT NOT NULL DEFAULT 'minute',
    "late_per_time" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deduct_absent" BOOLEAN NOT NULL DEFAULT false,
    "deduct_unpaid_leave" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_name" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "settings_pkey" PRIMARY KEY ("org_id")
);

CREATE TABLE "salary"."rates" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "params" JSONB NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "salary"."items" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "sso_base" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "salary"."employee_items" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "from_period" TEXT NOT NULL,
    "to_period" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "ended_by_name" TEXT,
    CONSTRAINT "employee_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "salary"."profiles" (
    "org_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "sso_exempt" BOOLEAN NOT NULL DEFAULT false,
    "sso_exempt_reason" TEXT NOT NULL DEFAULT '',
    "extra_allowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bank_name" TEXT NOT NULL DEFAULT '',
    "bank_account" TEXT NOT NULL DEFAULT '',
    "account_name" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_name" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "profiles_pkey" PRIMARY KEY ("org_id", "employment_id")
);

CREATE TABLE "salary"."runs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "pay_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "totals" JSONB NOT NULL DEFAULT '{}',
    "computed_at" TIMESTAMPTZ(6),
    "submitted_by" TEXT,
    "submitted_by_name" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "approved_by" TEXT,
    "approved_by_name" TEXT,
    "approved_at" TIMESTAMPTZ(6),
    "approval_note" TEXT,
    "returned_reason" TEXT,
    "paid_by_name" TEXT,
    "paid_at" TIMESTAMPTZ(6),
    "created_by" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "salary"."run_lines" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "department" TEXT NOT NULL DEFAULT '',
    "employee_code" TEXT NOT NULL DEFAULT '',
    "lines" JSONB NOT NULL DEFAULT '[]',
    "gross" DECIMAL(12,2) NOT NULL,
    "deductions" DECIMAL(12,2) NOT NULL,
    "net" DECIMAL(12,2) NOT NULL,
    "sso_employee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sso_employer" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxable" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "adjustments" JSONB NOT NULL DEFAULT '[]',
    "info" JSONB NOT NULL DEFAULT '{}',
    "bank_name" TEXT NOT NULL DEFAULT '',
    "bank_account" TEXT NOT NULL DEFAULT '',
    "account_name" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "run_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "salary"."events" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "run_id" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by_user_id" TEXT NOT NULL,
    "by_name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" JSONB,
    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rates_org_id_kind_effective_from_idx" ON "salary"."rates"("org_id", "kind", "effective_from");
CREATE INDEX "items_org_id_idx" ON "salary"."items"("org_id");
CREATE INDEX "employee_items_org_id_employment_id_idx" ON "salary"."employee_items"("org_id", "employment_id");
CREATE UNIQUE INDEX "runs_org_id_period_key" ON "salary"."runs"("org_id", "period");
CREATE INDEX "runs_org_id_status_idx" ON "salary"."runs"("org_id", "status");
CREATE UNIQUE INDEX "run_lines_run_id_employment_id_key" ON "salary"."run_lines"("run_id", "employment_id");
CREATE INDEX "run_lines_org_id_employment_id_idx" ON "salary"."run_lines"("org_id", "employment_id");
CREATE INDEX "events_org_id_run_id_idx" ON "salary"."events"("org_id", "run_id");

ALTER TABLE "salary"."run_lines" ADD CONSTRAINT "run_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "salary"."runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "salary"."employee_items" ADD CONSTRAINT "employee_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "salary"."items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "salary"."settings"
  ADD CONSTRAINT "settings_cutoff_range" CHECK ("cutoff_day" BETWEEN 1 AND 31),
  ADD CONSTRAINT "settings_pay_day_range" CHECK ("pay_day" BETWEEN 0 AND 31),
  ADD CONSTRAINT "settings_mode_valid" CHECK ("approval_mode" IN ('ceo', 'ceo_on_change', 'hr')),
  ADD CONSTRAINT "settings_late_mode_valid" CHECK ("late_mode" IN ('minute', 'per_time')),
  ADD CONSTRAINT "settings_nonneg" CHECK ("change_threshold" >= 0 AND "late_per_time" >= 0);
ALTER TABLE "salary"."rates" ADD CONSTRAINT "rates_kind_valid" CHECK ("kind" IN ('sso', 'tax'));
ALTER TABLE "salary"."items" ADD CONSTRAINT "items_kind_valid" CHECK ("kind" IN ('earning', 'deduction'));
ALTER TABLE "salary"."employee_items"
  ADD CONSTRAINT "employee_items_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "employee_items_period_format" CHECK ("from_period" ~ '^\d{4}-\d{2}$' AND ("to_period" IS NULL OR ("to_period" ~ '^\d{4}-\d{2}$' AND "to_period" >= "from_period")));
ALTER TABLE "salary"."profiles" ADD CONSTRAINT "profiles_allowance_nonneg" CHECK ("extra_allowance" >= 0);
ALTER TABLE "salary"."runs"
  ADD CONSTRAINT "runs_status_valid" CHECK ("status" IN ('draft', 'submitted', 'approved', 'paid')),
  ADD CONSTRAINT "runs_period_format" CHECK ("period" ~ '^\d{4}-\d{2}$'),
  ADD CONSTRAINT "runs_dates_order" CHECK ("starts_on" <= "ends_on");

-- รอบที่อนุมัติ/จ่ายแล้ว ผลรายคนแก้/ลบไม่ได้ · รอบที่จ่ายแล้วทั้งแถวแก้ไม่ได้ — กันที่ฐานข้อมูล ไม่ใช่แค่หน้าเว็บ
CREATE OR REPLACE FUNCTION "salary".guard_run_lines() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT "status" INTO st FROM "salary"."runs" WHERE "id" = COALESCE(NEW."run_id", OLD."run_id");
  IF st IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'salary run is %, its lines are locked', st;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "run_lines_locked" BEFORE INSERT OR UPDATE OR DELETE ON "salary"."run_lines"
  FOR EACH ROW EXECUTE FUNCTION "salary".guard_run_lines();

CREATE OR REPLACE FUNCTION "salary".guard_runs() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'paid' THEN
    RAISE EXCEPTION 'salary run is paid and cannot change';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "runs_paid_locked" BEFORE UPDATE ON "salary"."runs"
  FOR EACH ROW EXECUTE FUNCTION "salary".guard_runs();

-- บริษัทปัจจุบันมาจาก GUC ที่ตั้งใน transaction — ไม่ได้ตั้ง = NULL = ไม่ match อะไรเลย (fail closed)
CREATE OR REPLACE FUNCTION "salary".current_org_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('salary.org_id', true), '')
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['settings', 'rates', 'items', 'employee_items', 'profiles', 'runs', 'run_lines', 'events'] LOOP
    EXECUTE format('ALTER TABLE "salary".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "salary".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON "salary".%I USING ("org_id" = "salary".current_org_id()) WITH CHECK ("org_id" = "salary".current_org_id())', t || '_isolation', t);
  END LOOP;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workforce_app') THEN
    CREATE ROLE workforce_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA "salary" TO workforce_app;
GRANT EXECUTE ON FUNCTION "salary".current_org_id() TO workforce_app;
GRANT SELECT, INSERT, UPDATE ON "salary"."settings", "salary"."items", "salary"."profiles", "salary"."runs" TO workforce_app;
-- อัตรา/ประวัติ: เพิ่มได้อย่างเดียว (ปรับอัตรา = เพิ่มแถวใหม่ที่มีวันเริ่มมีผล)
GRANT SELECT, INSERT ON "salary"."rates", "salary"."events", "salary"."employee_items" TO workforce_app;
-- รายการประจำ: เลิกใช้/ตั้งงวดสุดท้ายได้ ตัวเลขแก้ไม่ได้ (แก้ยอด = เลิกอันเดิม เพิ่มอันใหม่ — เห็นประวัติ)
GRANT UPDATE ("to_period", "ended_at", "ended_by_name") ON "salary"."employee_items" TO workforce_app;
-- ผลรายคน: คำนวณใหม่ระหว่างร่างได้ (trigger กันรอบที่อนุมัติ/จ่ายแล้ว) — DELETE มีที่นี่ที่เดียวทั้ง schema
GRANT SELECT, INSERT, UPDATE, DELETE ON "salary"."run_lines" TO workforce_app;

-- ── สิทธิ์ของโมดูล (แคตตาล็อกอยู่ใต้โมดูล hr — manifest ใช้ requiresModule: "hr") ──
INSERT INTO "core"."permissions" ("id", "code", "module_id")
SELECT gen_random_uuid()::text, c, (SELECT m."id" FROM "core"."modules" m WHERE m."code" = 'hr')
FROM unnest(ARRAY['salary.access', 'salary.manage', 'salary.approve', 'salary.settings']) AS c
ON CONFLICT ("code") DO NOTHING;

-- ค่าตั้งต้น (ปรับได้ที่ /admin/roles):
--   ทุกบทบาทยกเว้นคนงาน = ดูสลิปของตัวเอง · HR = เตรียมรอบ/ตั้งค่ารายคน/บันทึกจ่าย
--   CEO = อนุมัติรอบ · HR + CEO = ตั้งค่า · แอดมิน (IT) ไม่เห็นเงินเดือนคนอื่น
INSERT INTO "core"."role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "core"."roles" r
JOIN "core"."permissions" p ON
     (p."code" = 'salary.access' AND r."code" <> 'WORKER')
  OR (p."code" = 'salary.manage' AND r."code" = 'HR_OFFICER')
  OR (p."code" = 'salary.approve' AND r."code" = 'CEO')
  OR (p."code" = 'salary.settings' AND r."code" IN ('HR_OFFICER', 'CEO'))
WHERE r."org_id" IS NOT NULL
ON CONFLICT DO NOTHING;
