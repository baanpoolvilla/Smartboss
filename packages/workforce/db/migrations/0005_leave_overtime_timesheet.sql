-- 0005_leave_overtime_timesheet
--
-- Phase 5: append-only leave balance ledger, leave requests, overtime with
-- planned/actual/approved separation, generic approval framework, and timesheet
-- periods that close into an immutable snapshot.
--
-- อ้างอิง: spec §8.2, §8.3, §9, §10.1, §12
--
-- rollback: DROP TABLE workforce.timesheet_day_snapshots, ... CASCADE;

-- ---------------------------------------------------------------------------
-- Leave types (spec §8.2)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.leave_types (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  code           text NOT NULL,
  name           text NOT NULL,
  paid           boolean NOT NULL DEFAULT true,
  -- หน่วยที่เล็กที่สุดที่ลาได้ — ระบบเดิมรองรับแค่วันเต็ม (spec §3.3 P7)
  unit           text NOT NULL DEFAULT 'DAY' CHECK (unit IN ('DAY', 'HALF_DAY', 'HOUR')),
  quota_minutes_per_year integer NOT NULL DEFAULT 0 CHECK (quota_minutes_per_year >= 0),
  accrual_method text NOT NULL DEFAULT 'ANNUAL_GRANT'
                   CHECK (accrual_method IN ('ANNUAL_GRANT', 'MONTHLY_ACCRUAL', 'NONE')),
  pro_rate_first_year boolean NOT NULL DEFAULT true,
  carry_over_max_minutes integer NOT NULL DEFAULT 0,
  carry_over_expiry_months integer NOT NULL DEFAULT 0,
  advance_notice_days integer NOT NULL DEFAULT 0,
  attachment_required boolean NOT NULL DEFAULT false,
  min_duration_minutes integer NOT NULL DEFAULT 0,
  max_duration_minutes integer,
  allow_negative boolean NOT NULL DEFAULT false,
  approval_levels integer NOT NULL DEFAULT 1 CHECK (approval_levels BETWEEN 1 AND 3),
  effective_from date NOT NULL,
  effective_to   date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT leave_types_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX leave_types_open_key
  ON workforce.leave_types (tenant_id, company_id, lower(code))
  WHERE effective_to IS NULL;

-- ---------------------------------------------------------------------------
-- Leave balance ledger — append only (spec §8.2)
--
-- ยอดคงเหลือคือผลรวมของรายการ ไม่ใช่ตัวเลขที่ถูก UPDATE ทับ
-- จึงตอบได้เสมอว่าโควตาหายไปไหนและตอนไหน
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.leave_balance_ledger (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  employment_id  uuid NOT NULL REFERENCES workforce.employments (id),
  leave_type_id  uuid NOT NULL REFERENCES workforce.leave_types (id),
  entry_type     text NOT NULL
                   CHECK (entry_type IN (
                     'OPENING', 'ACCRUAL', 'RESERVE', 'CONSUME',
                     'RELEASE', 'ADJUST', 'EXPIRE', 'REVERSAL'
                   )),
  -- บวก = เพิ่มสิทธิ์, ลบ = ใช้สิทธิ์
  minutes        integer NOT NULL,
  effective_on   date NOT NULL,
  period_year    integer NOT NULL,
  leave_request_id uuid,
  reason         text NOT NULL DEFAULT '',
  reversal_of_id uuid REFERENCES workforce.leave_balance_ledger (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid
);
CREATE INDEX leave_balance_ledger_balance_idx
  ON workforce.leave_balance_ledger (tenant_id, employment_id, leave_type_id, period_year);
CREATE INDEX leave_balance_ledger_request_idx
  ON workforce.leave_balance_ledger (tenant_id, leave_request_id);

-- ledger เป็น append-only เช่นเดียวกับ audit — แก้ยอดต้องลงรายการ REVERSAL
CREATE TRIGGER leave_balance_ledger_immutable
  BEFORE UPDATE OR DELETE ON workforce.leave_balance_ledger
  FOR EACH ROW EXECUTE FUNCTION workforce.reject_mutation();

CREATE TABLE workforce.leave_requests (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  employment_id  uuid NOT NULL REFERENCES workforce.employments (id),
  leave_type_id  uuid NOT NULL REFERENCES workforce.leave_types (id),
  starts_on      date NOT NULL,
  ends_on        date NOT NULL,
  -- นาทีจริงที่ลา คำนวณจากกะและวันหยุด ไม่ใช่จำนวนวันปฏิทิน (spec §3.3 P7)
  total_minutes  integer NOT NULL CHECK (total_minutes > 0),
  paid_minutes   integer NOT NULL DEFAULT 0,
  unpaid_minutes integer NOT NULL DEFAULT 0,
  half_day_start boolean NOT NULL DEFAULT false,
  half_day_end   boolean NOT NULL DEFAULT false,
  reason         text NOT NULL DEFAULT '',
  attachment_object_id uuid REFERENCES workforce.storage_objects (id),
  status         text NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  submitted_at   timestamptz,
  decided_at     timestamptz,
  decided_by     uuid,
  decision_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT leave_requests_range CHECK (ends_on >= starts_on),
  CONSTRAINT leave_requests_minutes_split
    CHECK (paid_minutes + unpaid_minutes = total_minutes)
);
CREATE INDEX leave_requests_employment_idx
  ON workforce.leave_requests (tenant_id, employment_id, starts_on DESC);
CREATE INDEX leave_requests_pending_idx
  ON workforce.leave_requests (tenant_id, company_id, status)
  WHERE status = 'SUBMITTED';

-- ---------------------------------------------------------------------------
-- Overtime (spec §8.3)
--
-- แยก planned / actual / approved ออกจากกัน — ระบบเดิมมีแค่ตัวเลขที่ admin กรอกเอง
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.overtime_requests (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  employment_id  uuid NOT NULL REFERENCES workforce.employments (id),
  work_date      date NOT NULL,
  -- ประเภทกำหนดตัวคูณค่าตอบแทน ซึ่งอยู่ใน statutory_rule_sets ไม่ได้ฝังในโค้ด (spec §8.3)
  ot_category    text NOT NULL DEFAULT 'WORKDAY'
                   CHECK (ot_category IN ('WORKDAY', 'REST_DAY', 'PUBLIC_HOLIDAY')),
  planned_minutes integer NOT NULL DEFAULT 0 CHECK (planned_minutes >= 0),
  actual_minutes  integer NOT NULL DEFAULT 0 CHECK (actual_minutes >= 0),
  -- eligible = ผลของ policy เช่น min(planned, actual); เก็บไว้เพื่ออธิบายที่มา
  eligible_minutes integer NOT NULL DEFAULT 0 CHECK (eligible_minutes >= 0),
  approved_minutes integer NOT NULL DEFAULT 0 CHECK (approved_minutes >= 0),
  reason         text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT', 'SUBMITTED', 'PRE_APPROVED', 'FINAL_APPROVED', 'REJECTED', 'CANCELLED')),
  pre_approved_by uuid,
  pre_approved_at timestamptz,
  final_approved_by uuid,
  final_approved_at timestamptz,
  decision_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX overtime_requests_day_key
  ON workforce.overtime_requests (tenant_id, employment_id, work_date)
  WHERE status <> 'CANCELLED';
CREATE INDEX overtime_requests_pending_idx
  ON workforce.overtime_requests (tenant_id, company_id, status);

-- ---------------------------------------------------------------------------
-- Generic approval framework (spec §20 Phase 5)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.approval_requests (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  subject_type   text NOT NULL,
  subject_id     uuid NOT NULL,
  -- ถ้า version ของสิ่งที่ขออนุมัติเปลี่ยน การอนุมัติเดิมใช้ไม่ได้ (spec §12)
  subject_version integer NOT NULL DEFAULT 1,
  status         text NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'INVALIDATED')),
  requested_by   uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);
CREATE INDEX approval_requests_subject_idx
  ON workforce.approval_requests (tenant_id, subject_type, subject_id);

CREATE TABLE workforce.approval_steps (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  request_id     uuid NOT NULL REFERENCES workforce.approval_requests (id) ON DELETE CASCADE,
  step_order     integer NOT NULL,
  required_permission text NOT NULL,
  status         text NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX approval_steps_order_key ON workforce.approval_steps (request_id, step_order);

CREATE TABLE workforce.approval_actions (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  step_id        uuid NOT NULL REFERENCES workforce.approval_steps (id) ON DELETE CASCADE,
  actor_id       uuid NOT NULL,
  action         text NOT NULL CHECK (action IN ('APPROVE', 'REJECT', 'DELEGATE')),
  reason         text NOT NULL DEFAULT '',
  acted_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER approval_actions_immutable
  BEFORE UPDATE OR DELETE ON workforce.approval_actions
  FOR EACH ROW EXECUTE FUNCTION workforce.reject_mutation();

-- ---------------------------------------------------------------------------
-- Timesheets — the cut-off that payroll reads from (spec §10.1)
--
-- ระบบเดิมรับ snapshot จาก frontend แล้วบันทึกเป็น JSON (spec §3.3 P3)
-- ที่นี่ snapshot ถูกสร้างฝั่ง server จาก attendance result เท่านั้น
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.timesheet_periods (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  name           text NOT NULL,
  starts_on      date NOT NULL,
  ends_on        date NOT NULL,
  cutoff_at      timestamptz,
  status         text NOT NULL DEFAULT 'OPEN'
                   CHECK (status IN ('OPEN', 'REVIEW', 'CLOSED', 'REOPENED')),
  closed_at      timestamptz,
  closed_by      uuid,
  reopened_at    timestamptz,
  reopened_by    uuid,
  reopen_reason  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT timesheet_periods_range CHECK (ends_on >= starts_on)
);
CREATE UNIQUE INDEX timesheet_periods_range_key
  ON workforce.timesheet_periods (tenant_id, company_id, starts_on, ends_on);

CREATE TABLE workforce.timesheets (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  period_id      uuid NOT NULL REFERENCES workforce.timesheet_periods (id) ON DELETE CASCADE,
  employment_id  uuid NOT NULL REFERENCES workforce.employments (id),
  status         text NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT', 'MANAGER_APPROVED', 'HR_APPROVED', 'CLOSED')),

  scheduled_days integer NOT NULL DEFAULT 0,
  worked_days    integer NOT NULL DEFAULT 0,
  worked_minutes integer NOT NULL DEFAULT 0,
  paid_minutes   integer NOT NULL DEFAULT 0,
  late_minutes   integer NOT NULL DEFAULT 0,
  absence_minutes integer NOT NULL DEFAULT 0,
  early_out_minutes integer NOT NULL DEFAULT 0,
  paid_leave_minutes integer NOT NULL DEFAULT 0,
  unpaid_leave_minutes integer NOT NULL DEFAULT 0,
  ot_workday_minutes integer NOT NULL DEFAULT 0,
  ot_rest_day_minutes integer NOT NULL DEFAULT 0,
  ot_holiday_minutes integer NOT NULL DEFAULT 0,
  holiday_days   integer NOT NULL DEFAULT 0,
  blocking_exception_count integer NOT NULL DEFAULT 0,

  manager_approved_by uuid,
  manager_approved_at timestamptz,
  hr_approved_by uuid,
  hr_approved_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX timesheets_period_employment_key
  ON workforce.timesheets (period_id, employment_id);
CREATE INDEX timesheets_status_idx ON workforce.timesheets (tenant_id, period_id, status);

-- snapshot รายวันที่ถูก freeze ตอนปิดงวด — payroll อ่านจากตารางนี้ ไม่ใช่จากข้อมูลสด
CREATE TABLE workforce.timesheet_day_snapshots (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  timesheet_id   uuid NOT NULL REFERENCES workforce.timesheets (id) ON DELETE CASCADE,
  work_date      date NOT NULL,
  -- ชี้ไปยัง attendance result version ที่ใช้ตอนปิดงวด — คำนวณใหม่ทีหลังไม่กระทบ
  attendance_result_id uuid REFERENCES workforce.attendance_results (id),
  result_version integer NOT NULL DEFAULT 1,
  worked_minutes integer NOT NULL DEFAULT 0,
  paid_minutes   integer NOT NULL DEFAULT 0,
  late_minutes   integer NOT NULL DEFAULT 0,
  absence_minutes integer NOT NULL DEFAULT 0,
  early_out_minutes integer NOT NULL DEFAULT 0,
  paid_leave_minutes integer NOT NULL DEFAULT 0,
  unpaid_leave_minutes integer NOT NULL DEFAULT 0,
  ot_minutes     integer NOT NULL DEFAULT 0,
  ot_category    text,
  is_rest_day    boolean NOT NULL DEFAULT false,
  is_holiday     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX timesheet_day_snapshots_key
  ON workforce.timesheet_day_snapshots (timesheet_id, work_date);

-- snapshot ที่ปิดแล้วห้ามแก้ — payroll ต้องอ่านตัวเลขเดิมได้เสมอ (spec §1.4, §10)
CREATE OR REPLACE FUNCTION workforce.reject_closed_timesheet_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  period_status text;
BEGIN
  SELECT p.status INTO period_status
  FROM workforce.timesheets t
  JOIN workforce.timesheet_periods p ON p.id = t.period_id
  WHERE t.id = COALESCE(NEW.timesheet_id, OLD.timesheet_id);

  IF period_status = 'CLOSED' THEN
    RAISE EXCEPTION 'timesheet period is closed; day snapshots cannot be modified'
      USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER timesheet_day_snapshots_locked
  BEFORE INSERT OR UPDATE OR DELETE ON workforce.timesheet_day_snapshots
  FOR EACH ROW EXECUTE FUNCTION workforce.reject_closed_timesheet_change();

-- ---------------------------------------------------------------------------
-- Triggers, RLS and grants
-- ---------------------------------------------------------------------------

CREATE TRIGGER leave_types_touch BEFORE UPDATE ON workforce.leave_types
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER leave_requests_touch BEFORE UPDATE ON workforce.leave_requests
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER overtime_requests_touch BEFORE UPDATE ON workforce.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER timesheet_periods_touch BEFORE UPDATE ON workforce.timesheet_periods
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();

DO $$
DECLARE
  target text;
  append_only text[] := ARRAY['leave_balance_ledger', 'approval_actions'];
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'leave_types', 'leave_balance_ledger', 'leave_requests', 'overtime_requests',
    'approval_requests', 'approval_steps', 'approval_actions',
    'timesheet_periods', 'timesheets', 'timesheet_day_snapshots'
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
      -- append-only: ต้อง REVOKE ให้ชัด เพราะ ALTER DEFAULT PRIVILEGES ใน 0001
      -- ให้สิทธิ์ครบทั้งสี่กับตารางใหม่ทุกตารางโดยอัตโนมัติ
      EXECUTE format('GRANT SELECT, INSERT ON workforce.%I TO workforce_app', target);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON workforce.%I FROM workforce_app', target);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON workforce.%I TO workforce_app', target);
    END IF;
  END LOOP;
END
$$;
