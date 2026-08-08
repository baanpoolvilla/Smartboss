-- 0004_scheduling_and_attendance
--
-- Phase 4: work policies, shift definitions, recurring patterns, roster board,
-- holiday calendars, versioned attendance results, exceptions and corrections.
--
-- อ้างอิง: spec §7, §8.1, §12, §19.3
--
-- rollback: DROP TABLE workforce.attendance_results, ... CASCADE;

-- ---------------------------------------------------------------------------
-- Work policy — effective-dated (spec §7.2)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.work_policies (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  code           text NOT NULL,
  name           text NOT NULL,
  late_mode      text NOT NULL DEFAULT 'GRACE'
                   CHECK (late_mode IN ('STRICT', 'GRACE', 'FLEX')),
  grace_minutes  integer NOT NULL DEFAULT 0 CHECK (grace_minutes >= 0),
  -- เกิน grace แล้วหักทั้งช่วงหรือเฉพาะส่วนเกิน — ต่างกันเป็นเงินจริง (spec §7.2)
  grace_deduction text NOT NULL DEFAULT 'EXCESS_OVER_GRACE'
                   CHECK (grace_deduction IN ('FULL_FROM_SCHEDULED', 'EXCESS_OVER_GRACE')),
  flex_start_minutes integer NOT NULL DEFAULT 420,
  flex_end_minutes   integer NOT NULL DEFAULT 600,
  flex_required_work_minutes integer NOT NULL DEFAULT 480,
  early_out_tolerance_minutes integer NOT NULL DEFAULT 0,
  duplicate_punch_window_minutes integer NOT NULL DEFAULT 3,
  max_shift_minutes  integer NOT NULL DEFAULT 960,
  excessive_work_minutes integer NOT NULL DEFAULT 840,
  ot_requires_approval boolean NOT NULL DEFAULT true,
  ot_minimum_minutes integer NOT NULL DEFAULT 30,
  ot_rounding_minutes integer NOT NULL DEFAULT 0,
  effective_from date NOT NULL,
  effective_to   date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT work_policies_range CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT work_policies_flex_window CHECK (flex_end_minutes >= flex_start_minutes)
);
CREATE INDEX work_policies_lookup_idx
  ON workforce.work_policies (tenant_id, company_id, effective_from DESC);
CREATE UNIQUE INDEX work_policies_open_key
  ON workforce.work_policies (tenant_id, company_id, lower(code))
  WHERE effective_to IS NULL;

-- ---------------------------------------------------------------------------
-- Shifts (spec §8.1)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.shift_definitions (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  code           text NOT NULL,
  name           text NOT NULL,
  -- นาทีจากเที่ยงคืนของ work_date; end > 1440 = ข้ามคืน (spec §7.1)
  start_minutes  integer NOT NULL CHECK (start_minutes BETWEEN 0 AND 1439),
  end_minutes    integer NOT NULL CHECK (end_minutes BETWEEN 0 AND 2879),
  rest_day       boolean NOT NULL DEFAULT false,
  work_policy_id uuid REFERENCES workforce.work_policies (id),
  site_id        uuid REFERENCES workforce.sites (id),
  allowed_methods text[] NOT NULL DEFAULT ARRAY[]::text[],
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT shift_definitions_duration CHECK (rest_day OR end_minutes > start_minutes)
);
CREATE UNIQUE INDEX shift_definitions_code_key
  ON workforce.shift_definitions (tenant_id, company_id, lower(code));

CREATE TABLE workforce.shift_break_rules (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  shift_id       uuid NOT NULL REFERENCES workforce.shift_definitions (id) ON DELETE CASCADE,
  start_minutes  integer NOT NULL CHECK (start_minutes BETWEEN 0 AND 2879),
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  paid           boolean NOT NULL DEFAULT false,
  -- true = หักตามตารางแม้ไม่มี punch; false = ใช้เวลาพักจาก punch จริง
  auto_deduct    boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shift_break_rules_shift_idx ON workforce.shift_break_rules (tenant_id, shift_id);

-- ตารางเวลาที่ซ้ำทุกสัปดาห์ (spec §8.1 รูปแบบที่ 1)
CREATE TABLE workforce.recurring_work_patterns (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  employment_id  uuid NOT NULL REFERENCES workforce.employments (id),
  -- index 0 = อาทิตย์ … 6 = เสาร์; NULL = วันหยุดประจำสัปดาห์
  monday_shift_id    uuid REFERENCES workforce.shift_definitions (id),
  tuesday_shift_id   uuid REFERENCES workforce.shift_definitions (id),
  wednesday_shift_id uuid REFERENCES workforce.shift_definitions (id),
  thursday_shift_id  uuid REFERENCES workforce.shift_definitions (id),
  friday_shift_id    uuid REFERENCES workforce.shift_definitions (id),
  saturday_shift_id  uuid REFERENCES workforce.shift_definitions (id),
  sunday_shift_id    uuid REFERENCES workforce.shift_definitions (id),
  effective_from date NOT NULL,
  effective_to   date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT recurring_work_patterns_range
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX recurring_work_patterns_lookup_idx
  ON workforce.recurring_work_patterns (tenant_id, employment_id, effective_from DESC);
CREATE UNIQUE INDEX recurring_work_patterns_open_key
  ON workforce.recurring_work_patterns (tenant_id, employment_id)
  WHERE effective_to IS NULL;
CREATE TRIGGER recurring_work_patterns_no_overlap
  BEFORE INSERT OR UPDATE ON workforce.recurring_work_patterns
  FOR EACH ROW EXECUTE FUNCTION workforce.assert_no_effective_overlap('employment_id');

-- Roster board รายสัปดาห์/รายเดือน (spec §8.1 รูปแบบที่ 2)
CREATE TABLE workforce.roster_periods (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id   uuid NOT NULL REFERENCES workforce.companies (id),
  name         text NOT NULL,
  starts_on    date NOT NULL,
  ends_on      date NOT NULL,
  -- พนักงานเห็นเฉพาะที่ publish แล้ว; draft แก้ได้อิสระ (spec §8.1)
  status       text NOT NULL DEFAULT 'DRAFT'
                 CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  published_at timestamptz,
  published_by uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  version      integer NOT NULL DEFAULT 1,
  CONSTRAINT roster_periods_range CHECK (ends_on >= starts_on)
);
CREATE INDEX roster_periods_company_idx
  ON workforce.roster_periods (tenant_id, company_id, starts_on DESC);

CREATE TABLE workforce.shift_assignments (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES workforce.tenants (id),
  roster_period_id uuid REFERENCES workforce.roster_periods (id) ON DELETE CASCADE,
  employment_id   uuid NOT NULL REFERENCES workforce.employments (id),
  work_date       date NOT NULL,
  shift_id        uuid REFERENCES workforce.shift_definitions (id),
  status          text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'PUBLISHED', 'CANCELLED')),
  note            text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  version         integer NOT NULL DEFAULT 1
);
-- พนักงานหนึ่งคนมีกะได้กะเดียวต่อวัน — กันตารางซ้อนกันตั้งแต่ระดับ DB
CREATE UNIQUE INDEX shift_assignments_employment_date_key
  ON workforce.shift_assignments (tenant_id, employment_id, work_date)
  WHERE status <> 'CANCELLED';
CREATE INDEX shift_assignments_date_idx
  ON workforce.shift_assignments (tenant_id, work_date, status);

CREATE TABLE workforce.holiday_calendars (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id uuid NOT NULL REFERENCES workforce.companies (id),
  code       text NOT NULL,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX holiday_calendars_code_key
  ON workforce.holiday_calendars (tenant_id, company_id, lower(code));

CREATE TABLE workforce.holiday_dates (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES workforce.tenants (id),
  calendar_id uuid NOT NULL REFERENCES workforce.holiday_calendars (id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name        text NOT NULL,
  paid        boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid
);
CREATE UNIQUE INDEX holiday_dates_key ON workforce.holiday_dates (calendar_id, holiday_date);

-- ---------------------------------------------------------------------------
-- Time event adjustments (spec §7.4)
--
-- raw event แก้ไม่ได้ — การแก้เวลาทำผ่านตารางนี้เท่านั้น
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.time_event_adjustments (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  employment_id  uuid NOT NULL REFERENCES workforce.employments (id),
  work_date      date NOT NULL,
  adjustment_type text NOT NULL
                    CHECK (adjustment_type IN ('ADD_PUNCH', 'IGNORE_EVENT', 'CHANGE_INTENT')),
  -- ADD_PUNCH: เวลาที่ต้องการเพิ่ม; IGNORE/CHANGE: อ้างถึง raw event เดิม
  target_event_id uuid REFERENCES workforce.raw_time_events (id),
  punch_at       timestamptz,
  event_intent   text,
  reason         text NOT NULL,
  comment        text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_by   uuid,
  approved_by    uuid,
  approved_at    timestamptz,
  rejection_reason text,
  /**
   * post_cutoff = คำขอมาถึงหลังปิด timesheet แล้ว
   * ผลต่างต้องไปงวดถัดไป ไม่ใช่แก้งวดที่ปิดไปแล้ว (spec §7.4)
   */
  post_cutoff    boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT time_event_adjustments_add_punch_has_time
    CHECK (adjustment_type <> 'ADD_PUNCH' OR (punch_at IS NOT NULL AND event_intent IS NOT NULL)),
  CONSTRAINT time_event_adjustments_targets_event
    CHECK (adjustment_type = 'ADD_PUNCH' OR target_event_id IS NOT NULL)
);
CREATE INDEX time_event_adjustments_lookup_idx
  ON workforce.time_event_adjustments (tenant_id, employment_id, work_date);
CREATE INDEX time_event_adjustments_pending_idx
  ON workforce.time_event_adjustments (tenant_id, status, created_at)
  WHERE status = 'PENDING';

-- ---------------------------------------------------------------------------
-- Attendance results — versioned, never edited in place (spec §12, ADR-0012)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.attendance_results (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  employment_id  uuid NOT NULL REFERENCES workforce.employments (id),
  work_date      date NOT NULL,
  -- แต่ละครั้งที่คำนวณใหม่สร้าง version ใหม่ ของเดิมยังอ่านได้เพื่อสอบทานย้อนหลัง
  result_version integer NOT NULL DEFAULT 1,
  is_current     boolean NOT NULL DEFAULT true,
  shift_id       uuid REFERENCES workforce.shift_definitions (id),
  work_policy_id uuid REFERENCES workforce.work_policies (id),

  scheduled_in_at  timestamptz,
  scheduled_out_at timestamptz,
  actual_in_at     timestamptz,
  actual_out_at    timestamptz,

  -- ค่าทุกตัวแยกกัน ห้ามใช้แทนกัน (spec §7.2)
  late_minutes      integer NOT NULL DEFAULT 0,
  absence_minutes   integer NOT NULL DEFAULT 0,
  early_out_minutes integer NOT NULL DEFAULT 0,
  worked_minutes    integer NOT NULL DEFAULT 0,
  paid_minutes      integer NOT NULL DEFAULT 0,
  break_minutes     integer NOT NULL DEFAULT 0,
  unpaid_break_minutes integer NOT NULL DEFAULT 0,
  ot_candidate_minutes integer NOT NULL DEFAULT 0,

  is_rest_day    boolean NOT NULL DEFAULT false,
  is_holiday     boolean NOT NULL DEFAULT false,
  is_on_leave    boolean NOT NULL DEFAULT false,
  has_blocking_exception boolean NOT NULL DEFAULT false,

  calculated_at  timestamptz NOT NULL DEFAULT now(),
  calculation_reason text NOT NULL DEFAULT 'INITIAL',
  input_digest   bytea NOT NULL
);
CREATE UNIQUE INDEX attendance_results_current_key
  ON workforce.attendance_results (tenant_id, employment_id, work_date)
  WHERE is_current;
CREATE INDEX attendance_results_lookup_idx
  ON workforce.attendance_results (tenant_id, employment_id, work_date DESC, result_version DESC);
CREATE INDEX attendance_results_company_date_idx
  ON workforce.attendance_results (tenant_id, company_id, work_date);

CREATE TABLE workforce.attendance_result_punches (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES workforce.tenants (id),
  result_id     uuid NOT NULL REFERENCES workforce.attendance_results (id) ON DELETE CASCADE,
  sequence      integer NOT NULL,
  -- punch ที่มาจาก raw event กับที่มาจากคำขอแก้เวลาเก็บคนละคอลัมน์
  -- เพื่อให้ตอบได้ว่าเวลาที่ใช้คำนวณมาจากการสแกนจริงหรือมาจากการแก้ (spec §7.4)
  in_event_id   uuid,
  out_event_id  uuid,
  in_adjustment_id  uuid REFERENCES workforce.time_event_adjustments (id),
  out_adjustment_id uuid REFERENCES workforce.time_event_adjustments (id),
  in_at         timestamptz,
  out_at        timestamptz,
  minutes       integer NOT NULL DEFAULT 0
);
CREATE INDEX attendance_result_punches_result_idx
  ON workforce.attendance_result_punches (tenant_id, result_id);

CREATE TABLE workforce.attendance_exceptions (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id    uuid NOT NULL REFERENCES workforce.companies (id),
  employment_id uuid NOT NULL REFERENCES workforce.employments (id),
  result_id     uuid REFERENCES workforce.attendance_results (id) ON DELETE CASCADE,
  work_date     date NOT NULL,
  code          text NOT NULL,
  blocking      boolean NOT NULL DEFAULT false,
  detail        text NOT NULL DEFAULT '',
  raw_event_id  uuid,
  status        text NOT NULL DEFAULT 'OPEN'
                  CHECK (status IN ('OPEN', 'RESOLVED', 'WAIVED')),
  resolved_at   timestamptz,
  resolved_by   uuid,
  -- การ waive ต้องมีเหตุผลเสมอ (ADR-0009 REASON_REQUIRED_ACTIONS)
  resolution_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_exceptions_waived_has_reason
    CHECK (status <> 'WAIVED' OR resolution_reason IS NOT NULL)
);
CREATE INDEX attendance_exceptions_open_idx
  ON workforce.attendance_exceptions (tenant_id, company_id, work_date)
  WHERE status = 'OPEN';
CREATE INDEX attendance_exceptions_employment_idx
  ON workforce.attendance_exceptions (tenant_id, employment_id, work_date DESC);

-- ---------------------------------------------------------------------------
-- Triggers, RLS and grants
-- ---------------------------------------------------------------------------

CREATE TRIGGER work_policies_touch BEFORE UPDATE ON workforce.work_policies
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER shift_definitions_touch BEFORE UPDATE ON workforce.shift_definitions
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER recurring_work_patterns_touch BEFORE UPDATE ON workforce.recurring_work_patterns
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER roster_periods_touch BEFORE UPDATE ON workforce.roster_periods
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER shift_assignments_touch BEFORE UPDATE ON workforce.shift_assignments
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER holiday_calendars_touch BEFORE UPDATE ON workforce.holiday_calendars
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER time_event_adjustments_touch BEFORE UPDATE ON workforce.time_event_adjustments
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'work_policies', 'shift_definitions', 'shift_break_rules', 'recurring_work_patterns',
    'roster_periods', 'shift_assignments', 'holiday_calendars', 'holiday_dates',
    'time_event_adjustments', 'attendance_results', 'attendance_result_punches',
    'attendance_exceptions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE workforce.%I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE workforce.%I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format(
      'CREATE POLICY %I ON workforce.%I USING (tenant_id = workforce.current_tenant_id()) '
      'WITH CHECK (tenant_id = workforce.current_tenant_id())',
      target || '_isolation', target
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON workforce.%I TO workforce_app', target);
  END LOOP;
END
$$;
