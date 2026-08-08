-- 0006_payroll
--
-- Phase 6: pay item catalog with AST formulas, statutory rule sets that cannot be
-- published without sign-off, payroll periods and runs with an immutable input
-- snapshot, per-line calculation traces, YTD ledger and lock guards.
--
-- อ้างอิง: spec §9, §10, §12, §19.4, §19.5
--
-- rollback: DROP TABLE workforce.payroll_lines, ... CASCADE;

-- ---------------------------------------------------------------------------
-- Pay item catalog (spec §9.2)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.pay_item_definitions (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  code           text NOT NULL,
  name           text NOT NULL,
  category       text NOT NULL
                   CHECK (category IN ('EARNING', 'DEDUCTION', 'BENEFIT', 'EMPLOYER_CONTRIBUTION', 'INFORMATION')),
  calculation_type text NOT NULL
                   CHECK (calculation_type IN ('FIXED', 'MANUAL', 'FORMULA', 'ATTENDANCE', 'PERCENTAGE', 'IMPORT', 'BALANCE_LEDGER')),
  affects_net_pay boolean NOT NULL DEFAULT true,
  taxable        boolean NOT NULL DEFAULT false,
  social_security_base boolean NOT NULL DEFAULT false,
  provident_fund_base  boolean NOT NULL DEFAULT false,
  employer_only  boolean NOT NULL DEFAULT false,
  rounding_decimals integer NOT NULL DEFAULT 2 CHECK (rounding_decimals BETWEEN 0 AND 4),
  rounding_mode  text NOT NULL DEFAULT 'HALF_UP'
                   CHECK (rounding_mode IN ('HALF_UP', 'HALF_DOWN', 'HALF_EVEN', 'UP', 'DOWN', 'FLOOR', 'CEILING')),
  display_order  integer NOT NULL DEFAULT 100,
  gl_account     text,
  status         text NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  effective_from date NOT NULL,
  effective_to   date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT pay_item_definitions_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX pay_item_definitions_open_key
  ON workforce.pay_item_definitions (tenant_id, company_id, upper(code))
  WHERE effective_to IS NULL;
CREATE INDEX pay_item_definitions_lookup_idx
  ON workforce.pay_item_definitions (tenant_id, company_id, effective_from DESC);

-- สูตรเก็บเป็น AST (jsonb) ไม่ใช่สตริงที่ต้อง eval (spec §9.4, §21)
CREATE TABLE workforce.pay_item_formulas (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  pay_item_id    uuid NOT NULL REFERENCES workforce.pay_item_definitions (id) ON DELETE CASCADE,
  formula_version integer NOT NULL DEFAULT 1,
  ast            jsonb NOT NULL,
  -- ชื่อ variable และ pay item ที่สูตรอ้างถึง ใช้ตรวจ dependency ตอน publish
  referenced_variables text[] NOT NULL DEFAULT ARRAY[]::text[],
  referenced_items     text[] NOT NULL DEFAULT ARRAY[]::text[],
  status         text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  published_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid
);
CREATE UNIQUE INDEX pay_item_formulas_version_key
  ON workforce.pay_item_formulas (pay_item_id, formula_version);

-- สูตรที่ publish แล้วห้ามแก้ — payroll เก่าต้องคำนวณซ้ำได้ด้วยสูตรเดิม
CREATE OR REPLACE FUNCTION workforce.reject_published_formula_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'published pay item formulas are immutable; create a new version'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pay_item_formulas_immutable
  BEFORE UPDATE OF ast, referenced_variables, referenced_items ON workforce.pay_item_formulas
  FOR EACH ROW EXECUTE FUNCTION workforce.reject_published_formula_change();

-- ---------------------------------------------------------------------------
-- Statutory rule sets (spec §9.5)
--
-- ค่าตามกฎหมายทุกตัวอยู่ที่นี่ ไม่ใช่ใน code — และ publish ไม่ได้ถ้าไม่มีลายเซ็น
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.statutory_rule_sets (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  jurisdiction   text NOT NULL DEFAULT 'TH',
  rule_type      text NOT NULL
                   CHECK (rule_type IN (
                     'TH_PIT_WITHHOLDING', 'TH_SOCIAL_SECURITY', 'PROVIDENT_FUND',
                     'OT_MULTIPLIER', 'SEVERANCE', 'MINIMUM_WAGE'
                   )),
  version        text NOT NULL,
  status         text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  effective_from date NOT NULL,
  effective_to   date,
  parameters     jsonb NOT NULL DEFAULT '{}'::jsonb,
  formulas       jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_reference text NOT NULL DEFAULT '',
  approved_by    text,
  approved_at    timestamptz,
  golden_tests_passed boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version_no     integer NOT NULL DEFAULT 1,
  CONSTRAINT statutory_rule_sets_range CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- ยามชั้นสุดท้ายที่ DB: PUBLISHED ต้องมีครบทั้งสี่อย่าง (spec §9.5)
  CONSTRAINT statutory_rule_sets_published_requires_signoff
    CHECK (
      status <> 'PUBLISHED' OR (
        source_reference <> '' AND approved_by IS NOT NULL
        AND approved_at IS NOT NULL AND golden_tests_passed
      )
    )
);
CREATE UNIQUE INDEX statutory_rule_sets_version_key
  ON workforce.statutory_rule_sets (tenant_id, jurisdiction, rule_type, version);
CREATE INDEX statutory_rule_sets_effective_idx
  ON workforce.statutory_rule_sets (tenant_id, rule_type, status, effective_from DESC);

-- ---------------------------------------------------------------------------
-- Templates and per-employment assignment (spec §9.3)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.payroll_templates (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  code           text NOT NULL,
  name           text NOT NULL,
  status         text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  effective_from date NOT NULL,
  effective_to   date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX payroll_templates_open_key
  ON workforce.payroll_templates (tenant_id, company_id, upper(code))
  WHERE effective_to IS NULL;

CREATE TABLE workforce.payroll_template_items (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  template_id    uuid NOT NULL REFERENCES workforce.payroll_templates (id) ON DELETE CASCADE,
  pay_item_id    uuid NOT NULL REFERENCES workforce.pay_item_definitions (id),
  default_amount numeric(19, 4),
  default_rate   numeric(9, 6),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payroll_template_items_key
  ON workforce.payroll_template_items (template_id, pay_item_id);

-- ค่าเฉพาะบุคคล ชนะ template และ position (spec §9.3) — effective-dated
CREATE TABLE workforce.employment_pay_items (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  employment_id  uuid NOT NULL REFERENCES workforce.employments (id),
  pay_item_id    uuid NOT NULL REFERENCES workforce.pay_item_definitions (id),
  amount         numeric(19, 4),
  rate           numeric(9, 6),
  enabled        boolean NOT NULL DEFAULT true,
  approval_reference text,
  effective_from date NOT NULL,
  effective_to   date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT employment_pay_items_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX employment_pay_items_lookup_idx
  ON workforce.employment_pay_items (tenant_id, employment_id, effective_from DESC);
CREATE UNIQUE INDEX employment_pay_items_open_key
  ON workforce.employment_pay_items (tenant_id, employment_id, pay_item_id)
  WHERE effective_to IS NULL;

-- ---------------------------------------------------------------------------
-- Periods and runs (spec §10)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.payroll_periods (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  name           text NOT NULL,
  starts_on      date NOT NULL,
  ends_on        date NOT NULL,
  pay_date       date NOT NULL,
  period_year    integer NOT NULL,
  period_sequence integer NOT NULL,
  status         text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT payroll_periods_range CHECK (ends_on >= starts_on)
);
CREATE UNIQUE INDEX payroll_periods_sequence_key
  ON workforce.payroll_periods (tenant_id, company_id, period_year, period_sequence);

CREATE TABLE workforce.payroll_runs (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  period_id      uuid NOT NULL REFERENCES workforce.payroll_periods (id),
  run_type       text NOT NULL DEFAULT 'REGULAR'
                   CHECK (run_type IN ('REGULAR', 'OFF_CYCLE', 'ADJUSTMENT', 'FINAL_PAY')),
  status         text NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN (
                     'DRAFT', 'CALCULATING', 'CALCULATED', 'REVIEW', 'APPROVED', 'LOCKED',
                     'PAYMENT_PENDING', 'PARTIALLY_PAID', 'PAID', 'FILED', 'FAILED', 'VOID'
                   )),
  timesheet_period_id uuid REFERENCES workforce.timesheet_periods (id),
  parent_run_id  uuid REFERENCES workforce.payroll_runs (id),
  snapshot_id    uuid,
  -- checksum ของ snapshot ตอน lock — พิสูจน์ว่าตัวเลขไม่เปลี่ยนหลังอนุมัติ
  lock_checksum  bytea,
  waived_validations text[] NOT NULL DEFAULT ARRAY[]::text[],
  prepared_by    uuid,
  submitted_by   uuid,
  submitted_at   timestamptz,
  approved_by    uuid,
  approved_at    timestamptz,
  locked_by      uuid,
  locked_at      timestamptz,
  rejection_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        integer NOT NULL DEFAULT 1
);
-- หนึ่ง regular run ที่ยังมีผลต่อหนึ่งงวด (spec §12)
CREATE UNIQUE INDEX payroll_runs_active_regular_key
  ON workforce.payroll_runs (period_id)
  WHERE run_type = 'REGULAR' AND status <> 'VOID';
CREATE INDEX payroll_runs_company_idx
  ON workforce.payroll_runs (tenant_id, company_id, status);

-- ---------------------------------------------------------------------------
-- Input snapshot — payroll คำนวณจากตารางนี้ ไม่ใช่จากข้อมูลสด (spec §3.3 P1)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.payroll_input_snapshots (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  run_id         uuid NOT NULL REFERENCES workforce.payroll_runs (id) ON DELETE CASCADE,
  built_at       timestamptz NOT NULL DEFAULT now(),
  built_by       uuid,
  -- hash ของเนื้อหา snapshot ทั้งก้อน — ตรวจว่าไม่มีอะไรเปลี่ยนระหว่างรออนุมัติ
  content_hash   bytea NOT NULL,
  employment_count integer NOT NULL DEFAULT 0,
  rule_set_ids   uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  pay_item_ids   uuid[] NOT NULL DEFAULT ARRAY[]::uuid[]
);
CREATE UNIQUE INDEX payroll_input_snapshots_run_key ON workforce.payroll_input_snapshots (run_id);

CREATE TABLE workforce.payroll_snapshot_employments (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  snapshot_id    uuid NOT NULL REFERENCES workforce.payroll_input_snapshots (id) ON DELETE CASCADE,
  employment_id  uuid NOT NULL REFERENCES workforce.employments (id),
  employee_code  text NOT NULL,
  employment_type text NOT NULL,
  hired_on       date NOT NULL,
  terminated_on  date,
  currency       char(3) NOT NULL DEFAULT 'THB',
  -- ค่าเงินที่ freeze ไว้ เช่น monthly_salary, hourly_rate, daily_rate
  money_variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- ปริมาณที่ freeze ไว้ เช่น worked_minutes, ot_workday_minutes, absence_minutes
  quantity_variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  manual_amounts jsonb NOT NULL DEFAULT '{}'::jsonb,
  timesheet_id   uuid REFERENCES workforce.timesheets (id)
);
CREATE UNIQUE INDEX payroll_snapshot_employments_key
  ON workforce.payroll_snapshot_employments (snapshot_id, employment_id);

-- snapshot ห้ามแก้หลังสร้าง — เป็นฐานของการคำนวณที่ต้องทำซ้ำได้ (spec §17)
CREATE TRIGGER payroll_input_snapshots_immutable
  BEFORE UPDATE OR DELETE ON workforce.payroll_input_snapshots
  FOR EACH ROW EXECUTE FUNCTION workforce.reject_mutation();

-- ---------------------------------------------------------------------------
-- Results, lines and traces
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.payroll_employee_results (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  run_id         uuid NOT NULL REFERENCES workforce.payroll_runs (id) ON DELETE CASCADE,
  employment_id  uuid NOT NULL REFERENCES workforce.employments (id),
  currency       char(3) NOT NULL DEFAULT 'THB',
  gross          numeric(19, 4) NOT NULL DEFAULT 0,
  total_deduction numeric(19, 4) NOT NULL DEFAULT 0,
  employer_contribution numeric(19, 4) NOT NULL DEFAULT 0,
  net_pay        numeric(19, 4) NOT NULL DEFAULT 0,
  taxable_base   numeric(19, 4) NOT NULL DEFAULT 0,
  social_security_base numeric(19, 4) NOT NULL DEFAULT 0,
  provident_fund_base  numeric(19, 4) NOT NULL DEFAULT 0,
  warnings       jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- ยอดของงวดก่อนสำหรับหน้า variance (spec §10.3)
  previous_net_pay numeric(19, 4),
  calculated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payroll_employee_results_key
  ON workforce.payroll_employee_results (run_id, employment_id);

CREATE TABLE workforce.payroll_lines (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  result_id      uuid NOT NULL REFERENCES workforce.payroll_employee_results (id) ON DELETE CASCADE,
  pay_item_code  text NOT NULL,
  pay_item_name  text NOT NULL,
  category       text NOT NULL,
  amount         numeric(19, 4) NOT NULL DEFAULT 0,
  taxable        boolean NOT NULL DEFAULT false,
  affects_net_pay boolean NOT NULL DEFAULT true,
  employer_only  boolean NOT NULL DEFAULT false,
  display_order  integer NOT NULL DEFAULT 100
);
CREATE INDEX payroll_lines_result_idx ON workforce.payroll_lines (tenant_id, result_id);

CREATE TABLE workforce.payroll_line_calculation_traces (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  line_id        uuid NOT NULL REFERENCES workforce.payroll_lines (id) ON DELETE CASCADE,
  calculation_type text NOT NULL,
  pre_round      numeric(19, 4) NOT NULL DEFAULT 0,
  rounding       text NOT NULL,
  -- ทุกขั้นตอนของสูตร — ตอบได้ว่าตัวเลขนี้มาจากไหน (spec §9.4)
  steps          jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE UNIQUE INDEX payroll_line_calculation_traces_key
  ON workforce.payroll_line_calculation_traces (line_id);

CREATE TABLE workforce.payroll_ytd_ledger (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  employment_id  uuid NOT NULL REFERENCES workforce.employments (id),
  period_year    integer NOT NULL,
  run_id         uuid REFERENCES workforce.payroll_runs (id),
  entry_type     text NOT NULL
                   CHECK (entry_type IN ('OPENING', 'PAYROLL', 'ADJUSTMENT', 'REVERSAL')),
  gross          numeric(19, 4) NOT NULL DEFAULT 0,
  taxable        numeric(19, 4) NOT NULL DEFAULT 0,
  tax_withheld   numeric(19, 4) NOT NULL DEFAULT 0,
  social_security numeric(19, 4) NOT NULL DEFAULT 0,
  provident_fund numeric(19, 4) NOT NULL DEFAULT 0,
  net_pay        numeric(19, 4) NOT NULL DEFAULT 0,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  reason         text NOT NULL DEFAULT ''
);
CREATE INDEX payroll_ytd_ledger_lookup_idx
  ON workforce.payroll_ytd_ledger (tenant_id, employment_id, period_year);

-- YTD เป็น ledger — แก้ยอดต้องลงรายการใหม่ ไม่ใช่เขียนทับ
CREATE TRIGGER payroll_ytd_ledger_immutable
  BEFORE UPDATE OR DELETE ON workforce.payroll_ytd_ledger
  FOR EACH ROW EXECUTE FUNCTION workforce.reject_mutation();

-- ---------------------------------------------------------------------------
-- Lock guard (spec §10, §19.5)
--
-- ชั้นสุดท้ายที่ DB: แม้ bug ใน application จะพยายามแก้ผลลัพธ์ของ run ที่ล็อกแล้ว
-- ก็ต้องล้มเหลว ไม่ใช่เปลี่ยนตัวเลขเงินเดือนที่อนุมัติไปแล้วเงียบ ๆ
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION workforce.reject_locked_payroll_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  run_status text;
  target_run uuid;
BEGIN
  IF TG_TABLE_NAME = 'payroll_employee_results' THEN
    target_run := COALESCE(NEW.run_id, OLD.run_id);
  ELSE
    SELECT r.run_id INTO target_run
    FROM workforce.payroll_employee_results r
    WHERE r.id = COALESCE(NEW.result_id, OLD.result_id);
  END IF;

  SELECT status INTO run_status FROM workforce.payroll_runs WHERE id = target_run;

  IF run_status IN ('LOCKED', 'PAYMENT_PENDING', 'PARTIALLY_PAID', 'PAID', 'FILED') THEN
    RAISE EXCEPTION
      'payroll run is % and its results cannot be changed; use an adjustment run',
      run_status
      USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER payroll_employee_results_lock_guard
  BEFORE INSERT OR UPDATE OR DELETE ON workforce.payroll_employee_results
  FOR EACH ROW EXECUTE FUNCTION workforce.reject_locked_payroll_change();

CREATE TRIGGER payroll_lines_lock_guard
  BEFORE INSERT OR UPDATE OR DELETE ON workforce.payroll_lines
  FOR EACH ROW EXECUTE FUNCTION workforce.reject_locked_payroll_change();

-- ---------------------------------------------------------------------------
-- Triggers, RLS and grants
-- ---------------------------------------------------------------------------

CREATE TRIGGER pay_item_definitions_touch BEFORE UPDATE ON workforce.pay_item_definitions
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER payroll_templates_touch BEFORE UPDATE ON workforce.payroll_templates
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER employment_pay_items_touch BEFORE UPDATE ON workforce.employment_pay_items
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER payroll_periods_touch BEFORE UPDATE ON workforce.payroll_periods
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER payroll_runs_touch BEFORE UPDATE ON workforce.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();

CREATE TRIGGER employment_pay_items_no_overlap
  BEFORE INSERT OR UPDATE ON workforce.employment_pay_items
  FOR EACH ROW EXECUTE FUNCTION workforce.assert_no_effective_overlap('employment_id');

DO $$
DECLARE
  target text;
  append_only text[] := ARRAY['payroll_input_snapshots', 'payroll_ytd_ledger'];
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'pay_item_definitions', 'pay_item_formulas', 'statutory_rule_sets',
    'payroll_templates', 'payroll_template_items', 'employment_pay_items',
    'payroll_periods', 'payroll_runs', 'payroll_input_snapshots',
    'payroll_snapshot_employments', 'payroll_employee_results', 'payroll_lines',
    'payroll_line_calculation_traces', 'payroll_ytd_ledger'
  ]
  LOOP
    EXECUTE format('ALTER TABLE workforce.%I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE workforce.%I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format(
      'CREATE POLICY %I ON workforce.%I USING (tenant_id = workforce.current_tenant_id()) '
      'WITH CHECK (tenant_id = workforce.current_tenant_id())',
      target || '_isolation', target
    );

    IF target = ANY(append_only) THEN
      EXECUTE format('GRANT SELECT, INSERT ON workforce.%I TO workforce_app', target);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON workforce.%I FROM workforce_app', target);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON workforce.%I TO workforce_app', target);
    END IF;
  END LOOP;
END
$$;
