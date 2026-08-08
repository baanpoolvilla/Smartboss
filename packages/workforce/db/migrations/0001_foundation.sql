-- 0001_foundation
--
-- Phase 1 foundation: tenant/company/org, people & employment, effective-dated
-- compensation, RBAC, append-only audit, outbox/inbox, idempotency, jobs, storage metadata.
--
-- อ้างอิง: spec §12, ADR-0002, ADR-0005, ADR-0009, ADR-0012
--
-- rollback: DROP SCHEMA workforce CASCADE;  -- destructive; ต้องรันพร้อม DBA เท่านั้น

CREATE SCHEMA IF NOT EXISTS workforce;

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

-- tenant ปัจจุบันมาจาก GUC ที่ตั้งด้วย SET LOCAL ในทุก transaction (ADR-0005 ชั้น 3)
-- ถ้าไม่ได้ตั้ง จะคืน NULL ทำให้ทุก policy ไม่ match — fail closed ไม่ใช่ fail open
CREATE OR REPLACE FUNCTION workforce.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('workforce.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION workforce.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'table %.% is append-only; % is not permitted',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION workforce.touch_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  -- optimistic concurrency: version เดินหน้าเสมอ ไม่ให้ client ตั้งเอง
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

-- ป้องกันช่วง effective ทับซ้อนกันโดยไม่ต้องพึ่ง btree_gist
-- (PGlite และ managed PG บางเจ้าไม่มี extension นี้ — ADR-0012 Consequences)
-- caller ต้องล็อกแถวแม่ด้วย SELECT ... FOR UPDATE ก่อนเขียน จึงปิดช่องแข่งกันได้
CREATE OR REPLACE FUNCTION workforce.assert_no_effective_overlap() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_column text := TG_ARGV[0];
  owner_value  uuid;
  conflict_id  uuid;
BEGIN
  EXECUTE format('SELECT ($1).%I', owner_column) INTO owner_value USING NEW;

  EXECUTE format(
    'SELECT id FROM %I.%I
      WHERE tenant_id = $1
        AND %I = $2
        AND id <> $3
        AND daterange(effective_from, effective_to, ''[]'')
            && daterange($4, $5, ''[]'')
      LIMIT 1',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, owner_column
  )
  INTO conflict_id
  USING NEW.tenant_id, owner_value, NEW.id, NEW.effective_from, NEW.effective_to;

  IF conflict_id IS NOT NULL THEN
    RAISE EXCEPTION
      'effective period [%, %] overlaps existing row % in %.%',
      NEW.effective_from, COALESCE(NEW.effective_to::text, 'infinity'),
      conflict_id, TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Organization
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.tenants (
  id                 uuid PRIMARY KEY,
  code               text NOT NULL,
  name               text NOT NULL,
  status             text NOT NULL DEFAULT 'ACTIVE'
                       CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  default_time_zone  text NOT NULL DEFAULT 'Asia/Bangkok',
  default_currency   char(3) NOT NULL DEFAULT 'THB',
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid,
  version            integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX tenants_code_key ON workforce.tenants (lower(code));

CREATE TABLE workforce.companies (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES workforce.tenants (id),
  code              text NOT NULL,
  legal_name        text NOT NULL,
  display_name      text NOT NULL,
  -- เลขประจำตัวผู้เสียภาษีเป็นข้อมูลอ่อนไหว: เก็บเป็น ciphertext ที่ application เข้ารหัส
  tax_id_encrypted  bytea,
  time_zone         text NOT NULL DEFAULT 'Asia/Bangkok',
  currency          char(3) NOT NULL DEFAULT 'THB',
  status            text NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  version           integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX companies_tenant_code_key ON workforce.companies (tenant_id, lower(code));
CREATE INDEX companies_tenant_idx ON workforce.companies (tenant_id);

CREATE TABLE workforce.org_units (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id   uuid NOT NULL REFERENCES workforce.companies (id),
  parent_id    uuid REFERENCES workforce.org_units (id),
  code         text NOT NULL,
  name         text NOT NULL,
  kind         text NOT NULL DEFAULT 'DEPARTMENT'
                 CHECK (kind IN ('DIVISION', 'DEPARTMENT', 'TEAM')),
  status       text NOT NULL DEFAULT 'ACTIVE'
                 CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  version      integer NOT NULL DEFAULT 1,
  CONSTRAINT org_units_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX org_units_company_code_key ON workforce.org_units (tenant_id, company_id, lower(code));
CREATE INDEX org_units_parent_idx ON workforce.org_units (tenant_id, parent_id);

CREATE TABLE workforce.sites (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id  uuid NOT NULL REFERENCES workforce.companies (id),
  code        text NOT NULL,
  name        text NOT NULL,
  time_zone   text NOT NULL DEFAULT 'Asia/Bangkok',
  latitude    numeric(9, 6),
  longitude   numeric(9, 6),
  -- รัศมีที่ยอมรับสำหรับ photo check-in (spec §6.3) — ใช้จริงใน Phase 3
  radius_m    integer CHECK (radius_m IS NULL OR radius_m > 0),
  status      text NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT sites_coordinates_complete
    CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE UNIQUE INDEX sites_company_code_key ON workforce.sites (tenant_id, company_id, lower(code));

CREATE TABLE workforce.positions (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id  uuid NOT NULL REFERENCES workforce.companies (id),
  code        text NOT NULL,
  title       text NOT NULL,
  status      text NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  version     integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX positions_company_code_key ON workforce.positions (tenant_id, company_id, lower(code));

-- ---------------------------------------------------------------------------
-- People and employment
--
-- ระบบเดิมรวม identity + biometric + shift + payroll ไว้ใน fp_users ตารางเดียว
-- (spec §3.3 S1) ที่นี่แยก person (คน) ออกจาก employment (การจ้าง) เพราะคนหนึ่งคน
-- อาจมีการจ้างมากกว่าหนึ่งครั้ง หรือข้ามบริษัทใน tenant เดียวกัน
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.people (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES workforce.tenants (id),
  first_name            text NOT NULL,
  last_name             text NOT NULL,
  -- ชื่อเล่น/ชื่อที่ใช้แสดง แยกจากชื่อจริง (คงคุณสมบัติจากระบบเดิม)
  preferred_name        text NOT NULL DEFAULT '',
  email                 text,
  phone                 text,
  date_of_birth         date,
  -- เลขบัตรประชาชนเป็นข้อมูลอ่อนไหว ม.26 — ciphertext + hash สำหรับค้นหา/กันซ้ำ
  national_id_encrypted bytea,
  national_id_hash      bytea,
  status                text NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid,
  version               integer NOT NULL DEFAULT 1
);
CREATE INDEX people_tenant_idx ON workforce.people (tenant_id);
CREATE UNIQUE INDEX people_national_id_key
  ON workforce.people (tenant_id, national_id_hash)
  WHERE national_id_hash IS NOT NULL;

CREATE TABLE workforce.employments (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id       uuid NOT NULL REFERENCES workforce.companies (id),
  person_id        uuid NOT NULL REFERENCES workforce.people (id),
  employee_code    text NOT NULL,
  employment_type  text NOT NULL
                     CHECK (employment_type IN ('MONTHLY', 'DAILY', 'HOURLY', 'CONTRACT', 'PART_TIME')),
  hired_on         date NOT NULL,
  terminated_on    date,
  status           text NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED')),
  primary_site_id  uuid REFERENCES workforce.sites (id),
  time_zone        text NOT NULL DEFAULT 'Asia/Bangkok',
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid,
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT employments_termination_after_hire
    CHECK (terminated_on IS NULL OR terminated_on >= hired_on),
  CONSTRAINT employments_terminated_has_date
    CHECK (status <> 'TERMINATED' OR terminated_on IS NOT NULL)
);
CREATE UNIQUE INDEX employments_company_code_key
  ON workforce.employments (tenant_id, company_id, lower(employee_code));
CREATE INDEX employments_person_idx ON workforce.employments (tenant_id, person_id);
CREATE INDEX employments_company_status_idx ON workforce.employments (tenant_id, company_id, status);

-- ตำแหน่ง/หน่วยงาน/ผู้บังคับบัญชา แบบ effective-dated (ADR-0012)
CREATE TABLE workforce.employment_assignments (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES workforce.tenants (id),
  employment_id        uuid NOT NULL REFERENCES workforce.employments (id),
  org_unit_id          uuid REFERENCES workforce.org_units (id),
  position_id          uuid REFERENCES workforce.positions (id),
  manager_employment_id uuid REFERENCES workforce.employments (id),
  site_id              uuid REFERENCES workforce.sites (id),
  effective_from       date NOT NULL,
  effective_to         date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid,
  version              integer NOT NULL DEFAULT 1,
  CONSTRAINT employment_assignments_range
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT employment_assignments_manager_not_self
    CHECK (manager_employment_id IS NULL OR manager_employment_id <> employment_id)
);
CREATE INDEX employment_assignments_lookup_idx
  ON workforce.employment_assignments (tenant_id, employment_id, effective_from DESC);
CREATE INDEX employment_assignments_manager_idx
  ON workforce.employment_assignments (tenant_id, manager_employment_id, effective_from DESC);
-- open-ended ได้แถวเดียวต่อการจ้าง
CREATE UNIQUE INDEX employment_assignments_open_key
  ON workforce.employment_assignments (tenant_id, employment_id)
  WHERE effective_to IS NULL;

CREATE TRIGGER employment_assignments_no_overlap
  BEFORE INSERT OR UPDATE ON workforce.employment_assignments
  FOR EACH ROW EXECUTE FUNCTION workforce.assert_no_effective_overlap('employment_id');

-- ฐานค่าจ้างแบบ effective-dated — ระบบเดิมเก็บเป็นคอลัมน์เดียวที่ถูก UPDATE ทับ
-- ทำให้รายงานย้อนหลังเปลี่ยนตามทุกครั้งที่ขึ้นเงินเดือน (spec §3.3 P9)
CREATE TABLE workforce.compensation_rates (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES workforce.tenants (id),
  employment_id   uuid NOT NULL REFERENCES workforce.employments (id),
  pay_basis       text NOT NULL CHECK (pay_basis IN ('MONTHLY', 'DAILY', 'HOURLY')),
  amount          numeric(19, 4) NOT NULL CHECK (amount >= 0),
  currency        char(3) NOT NULL DEFAULT 'THB',
  effective_from  date NOT NULL,
  effective_to    date,
  -- MANUAL | LEGACY_IMPORT | BULK_IMPORT — ต้องรู้ว่าค่ามาจากไหนตอน reconcile (spec §18)
  provenance      text NOT NULL DEFAULT 'MANUAL'
                    CHECK (provenance IN ('MANUAL', 'LEGACY_IMPORT', 'BULK_IMPORT')),
  approval_reference text,
  note            text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT compensation_rates_range
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX compensation_rates_lookup_idx
  ON workforce.compensation_rates (tenant_id, employment_id, effective_from DESC);
CREATE UNIQUE INDEX compensation_rates_open_key
  ON workforce.compensation_rates (tenant_id, employment_id)
  WHERE effective_to IS NULL;

CREATE TRIGGER compensation_rates_no_overlap
  BEFORE INSERT OR UPDATE ON workforce.compensation_rates
  FOR EACH ROW EXECUTE FUNCTION workforce.assert_no_effective_overlap('employment_id');

-- ---------------------------------------------------------------------------
-- Identity and RBAC (ADR-0006)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.principals (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES workforce.tenants (id),
  -- `sub` จาก IdP — ไม่เก็บรหัสผ่านใด ๆ ในระบบนี้
  subject       text NOT NULL,
  display_name  text NOT NULL,
  email         text,
  person_id     uuid REFERENCES workforce.people (id),
  status        text NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE', 'DISABLED')),
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  version       integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX principals_tenant_subject_key ON workforce.principals (tenant_id, subject);
CREATE INDEX principals_person_idx ON workforce.principals (tenant_id, person_id);

CREATE TABLE workforce.roles (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES workforce.tenants (id),
  code        text NOT NULL,
  name        text NOT NULL,
  -- role ระบบถูก seed ให้และแก้ permission ไม่ได้ผ่าน API ปกติ
  is_system   boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  version     integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX roles_tenant_code_key ON workforce.roles (tenant_id, upper(code));

CREATE TABLE workforce.role_permissions (
  tenant_id   uuid NOT NULL REFERENCES workforce.tenants (id),
  role_id     uuid NOT NULL REFERENCES workforce.roles (id) ON DELETE CASCADE,
  permission  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  PRIMARY KEY (role_id, permission)
);
CREATE INDEX role_permissions_tenant_idx ON workforce.role_permissions (tenant_id);

CREATE TABLE workforce.principal_role_assignments (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES workforce.tenants (id),
  principal_id  uuid NOT NULL REFERENCES workforce.principals (id) ON DELETE CASCADE,
  role_id       uuid NOT NULL REFERENCES workforce.roles (id),
  -- NULL = ทุก company ใน tenant
  company_id    uuid REFERENCES workforce.companies (id),
  -- JIT/support access ต้องมีวันหมดอายุและเหตุผล (spec §5, ADR-0006)
  expires_at    timestamptz,
  reason        text NOT NULL DEFAULT '',
  granted_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  version       integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX principal_role_assignments_key
  ON workforce.principal_role_assignments (principal_id, role_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX principal_role_assignments_principal_idx
  ON workforce.principal_role_assignments (tenant_id, principal_id);

-- ---------------------------------------------------------------------------
-- Audit — append only (ADR-0009)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.audit_events (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL,
  company_id        uuid,
  occurred_at       timestamptz NOT NULL,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  actor_type        text NOT NULL
                      CHECK (actor_type IN ('PRINCIPAL', 'DEVICE', 'SYSTEM', 'SUPPORT_OPERATOR')),
  actor_id          uuid,
  actor_display     text NOT NULL DEFAULT '',
  on_behalf_of_id   uuid,
  action            text NOT NULL,
  resource_type     text NOT NULL,
  resource_id       uuid,
  resource_version  integer,
  outcome           text NOT NULL CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILED')),
  reason            text,
  request_id        text,
  ip                inet,
  user_agent        text,
  before            jsonb,
  after             jsonb,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_events_tenant_time_idx ON workforce.audit_events (tenant_id, occurred_at DESC);
CREATE INDEX audit_events_resource_idx ON workforce.audit_events (tenant_id, resource_type, resource_id, occurred_at DESC);
CREATE INDEX audit_events_actor_idx ON workforce.audit_events (tenant_id, actor_id, occurred_at DESC);
CREATE INDEX audit_events_action_idx ON workforce.audit_events (tenant_id, action, occurred_at DESC);

CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON workforce.audit_events
  FOR EACH ROW EXECUTE FUNCTION workforce.reject_mutation();

-- ---------------------------------------------------------------------------
-- Infrastructure
--
-- ตารางกลุ่มนี้ "ไม่" เปิด RLS โดยเจตนา: ไม่มี API endpoint ใดอ่านมันด้วย tenant
-- ที่มาจาก client — เข้าถึงผ่าน infrastructure service ที่วน tenant เองเท่านั้น
-- (ADR-0005 Consequences)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.idempotency_keys (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  principal_id    uuid,
  idempotency_key text NOT NULL,
  fingerprint     text NOT NULL,
  status          text NOT NULL DEFAULT 'IN_PROGRESS'
                    CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  expires_at      timestamptz NOT NULL
);
CREATE UNIQUE INDEX idempotency_keys_key
  ON workforce.idempotency_keys (tenant_id, idempotency_key);
CREATE INDEX idempotency_keys_expiry_idx ON workforce.idempotency_keys (expires_at);

CREATE TABLE workforce.outbox_messages (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  aggregate_type  text NOT NULL,
  aggregate_id    uuid,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  headers         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'DISPATCHING', 'DISPATCHED', 'DEAD')),
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 10,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  dispatched_at   timestamptz
);
CREATE INDEX outbox_messages_ready_idx
  ON workforce.outbox_messages (status, next_attempt_at)
  WHERE status IN ('PENDING', 'DISPATCHING');
CREATE INDEX outbox_messages_aggregate_idx
  ON workforce.outbox_messages (tenant_id, aggregate_type, aggregate_id);

CREATE TABLE workforce.inbox_messages (
  message_id    text PRIMARY KEY,
  tenant_id     uuid,
  source        text NOT NULL,
  event_type    text NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now(),
  result        text NOT NULL DEFAULT 'PROCESSED'
                  CHECK (result IN ('PROCESSED', 'IGNORED', 'FAILED'))
);

CREATE TABLE workforce.jobs (
  id            uuid PRIMARY KEY,
  tenant_id     uuid,
  job_type      text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'QUEUED'
                  CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  progress      integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  attempts      integer NOT NULL DEFAULT 0,
  result        jsonb,
  error         text,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);
CREATE INDEX jobs_ready_idx ON workforce.jobs (status, scheduled_for);
CREATE INDEX jobs_tenant_idx ON workforce.jobs (tenant_id, created_at DESC);

-- metadata ของ object ใน private storage — bytes อยู่ที่ object storage (ADR-0010)
CREATE TABLE workforce.storage_objects (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id      uuid REFERENCES workforce.companies (id),
  category        text NOT NULL
                    CHECK (category IN ('CHECKIN_PHOTO', 'PAYSLIP', 'IMPORT', 'EXPORT', 'ATTACHMENT')),
  object_key      text NOT NULL,
  content_type    text NOT NULL,
  size_bytes      bigint NOT NULL CHECK (size_bytes >= 0),
  sha256          bytea NOT NULL,
  status          text NOT NULL DEFAULT 'QUARANTINE'
                    CHECK (status IN ('QUARANTINE', 'AVAILABLE', 'DELETED')),
  retention_until date,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid
);
CREATE UNIQUE INDEX storage_objects_key_unique ON workforce.storage_objects (object_key);
CREATE INDEX storage_objects_tenant_category_idx
  ON workforce.storage_objects (tenant_id, category, created_at DESC);
-- ตรวจรูปซ้ำได้จาก checksum โดยไม่ต้องดาวน์โหลดไฟล์ (anti-fraud, spec §6.4)
CREATE INDEX storage_objects_sha_idx ON workforce.storage_objects (tenant_id, sha256);
CREATE INDEX storage_objects_retention_idx
  ON workforce.storage_objects (retention_until)
  WHERE status = 'AVAILABLE' AND retention_until IS NOT NULL;

-- ---------------------------------------------------------------------------
-- updated_at / version triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER tenants_touch BEFORE UPDATE ON workforce.tenants
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER companies_touch BEFORE UPDATE ON workforce.companies
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER org_units_touch BEFORE UPDATE ON workforce.org_units
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER sites_touch BEFORE UPDATE ON workforce.sites
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER positions_touch BEFORE UPDATE ON workforce.positions
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER people_touch BEFORE UPDATE ON workforce.people
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER employments_touch BEFORE UPDATE ON workforce.employments
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER employment_assignments_touch BEFORE UPDATE ON workforce.employment_assignments
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER compensation_rates_touch BEFORE UPDATE ON workforce.compensation_rates
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER principals_touch BEFORE UPDATE ON workforce.principals
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER roles_touch BEFORE UPDATE ON workforce.roles
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER principal_role_assignments_touch BEFORE UPDATE ON workforce.principal_role_assignments
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();

-- ---------------------------------------------------------------------------
-- Row Level Security (ADR-0005 ชั้น 3)
--
-- FORCE ROW LEVEL SECURITY ทำให้ policy มีผลแม้กับ table owner
-- ดังนั้นการลืมสร้าง role แยกจะไม่ทำให้ isolation หายไปเงียบ ๆ
-- ---------------------------------------------------------------------------

ALTER TABLE workforce.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_isolation ON workforce.tenants
  USING (id = workforce.current_tenant_id())
  WITH CHECK (id = workforce.current_tenant_id());

ALTER TABLE workforce.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.companies FORCE ROW LEVEL SECURITY;
CREATE POLICY companies_isolation ON workforce.companies
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.org_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.org_units FORCE ROW LEVEL SECURITY;
CREATE POLICY org_units_isolation ON workforce.org_units
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.sites FORCE ROW LEVEL SECURITY;
CREATE POLICY sites_isolation ON workforce.sites
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.positions FORCE ROW LEVEL SECURITY;
CREATE POLICY positions_isolation ON workforce.positions
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.people FORCE ROW LEVEL SECURITY;
CREATE POLICY people_isolation ON workforce.people
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.employments ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.employments FORCE ROW LEVEL SECURITY;
CREATE POLICY employments_isolation ON workforce.employments
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.employment_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.employment_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY employment_assignments_isolation ON workforce.employment_assignments
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.compensation_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.compensation_rates FORCE ROW LEVEL SECURITY;
CREATE POLICY compensation_rates_isolation ON workforce.compensation_rates
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.principals FORCE ROW LEVEL SECURITY;
CREATE POLICY principals_isolation ON workforce.principals
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_isolation ON workforce.roles
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_isolation ON workforce.role_permissions
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.principal_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.principal_role_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY principal_role_assignments_isolation ON workforce.principal_role_assignments
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.storage_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.storage_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY storage_objects_isolation ON workforce.storage_objects
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

-- audit_events: อ่าน/เขียนได้เฉพาะ tenant ตัวเอง และไม่มี policy สำหรับ UPDATE/DELETE
-- จึงถูกปฏิเสธที่ชั้น RLS ก่อนจะถึง trigger ด้วยซ้ำ
ALTER TABLE workforce.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_events_select ON workforce.audit_events
  FOR SELECT USING (tenant_id = workforce.current_tenant_id());
CREATE POLICY audit_events_insert ON workforce.audit_events
  FOR INSERT WITH CHECK (tenant_id = workforce.current_tenant_id());

-- ---------------------------------------------------------------------------
-- Application role
--
-- FORCE ROW LEVEL SECURITY ยังไม่พอ: superuser และ role ที่มี BYPASSRLS
-- ข้าม policy ได้เสมอ ดังนั้น application ต้องทำงานภายใต้ role ที่ไม่ใช่ทั้งสองอย่าง
-- (ADR-0005 ชั้น 3) — `withTenant()` บังคับ SET LOCAL ROLE ให้ทุก transaction
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workforce_app') THEN
    BEGIN
      CREATE ROLE workforce_app NOLOGIN NOBYPASSRLS;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION
        'role workforce_app is missing and this connection cannot create it; '
        'ask a DBA to run: CREATE ROLE workforce_app NOLOGIN NOBYPASSRLS;';
    END;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA workforce TO workforce_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA workforce TO workforce_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA workforce TO workforce_app;

-- audit เป็น append-only แม้แต่กับ application role (ADR-0009)
-- ชั้นนี้ทำงานร่วมกับ trigger audit_events_immutable — ถ้าชั้นใดชั้นหนึ่งพลาด อีกชั้นยังกัน
REVOKE UPDATE, DELETE, TRUNCATE ON workforce.audit_events FROM workforce_app;

-- schema_migrations เป็นของ deploy pipeline ไม่ใช่ของ application
REVOKE ALL ON workforce.schema_migrations FROM workforce_app;
GRANT SELECT ON workforce.schema_migrations TO workforce_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA workforce
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO workforce_app;
