-- 0007_documents_and_exports
--
-- Phase 7: payslip documents, bank profiles and batches with control totals,
-- export profiles and jobs.
--
-- อ้างอิง: spec §14, §16, §19.5, §22
--
-- rollback: DROP TABLE workforce.export_jobs, ... CASCADE;

-- ---------------------------------------------------------------------------
-- Payslips (spec §14)
--
-- ยอดบนสลิปต้องเท่ากับผลลัพธ์ของ run ที่ล็อกแล้วเสมอ (spec §19.5)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.payslip_documents (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  run_id         uuid NOT NULL REFERENCES workforce.payroll_runs (id),
  result_id      uuid NOT NULL REFERENCES workforce.payroll_employee_results (id),
  employment_id  uuid NOT NULL REFERENCES workforce.employments (id),
  document_version integer NOT NULL DEFAULT 1,
  -- ไฟล์อยู่ใน private object storage; ดูได้ผ่าน signed URL เท่านั้น (ADR-0010)
  storage_object_id uuid REFERENCES workforce.storage_objects (id),
  -- ยอดที่ตรึงไว้ตอนออกสลิป ใช้ตรวจว่าตรงกับ result ที่ล็อก
  gross          numeric(19, 4) NOT NULL,
  total_deduction numeric(19, 4) NOT NULL,
  net_pay        numeric(19, 4) NOT NULL,
  currency       char(3) NOT NULL DEFAULT 'THB',
  content_hash   bytea NOT NULL,
  published_at   timestamptz NOT NULL DEFAULT now(),
  published_by   uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payslip_documents_version_key
  ON workforce.payslip_documents (result_id, document_version);
CREATE INDEX payslip_documents_employment_idx
  ON workforce.payslip_documents (tenant_id, employment_id, published_at DESC);

-- สลิปที่ออกแล้วห้ามแก้ — ต้องออกฉบับใหม่แทน (spec §14 payslip PDF versioned)
CREATE TRIGGER payslip_documents_immutable
  BEFORE UPDATE OR DELETE ON workforce.payslip_documents
  FOR EACH ROW EXECUTE FUNCTION workforce.reject_mutation();

-- บันทึกทุกครั้งที่มีคนเปิดดูสลิป (spec §17 payslip access audit)
CREATE TABLE workforce.payslip_access_log (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  payslip_id     uuid NOT NULL REFERENCES workforce.payslip_documents (id),
  principal_id   uuid,
  accessed_at    timestamptz NOT NULL DEFAULT now(),
  ip             inet,
  purpose        text NOT NULL DEFAULT 'DOWNLOAD'
);
CREATE INDEX payslip_access_log_payslip_idx
  ON workforce.payslip_access_log (tenant_id, payslip_id, accessed_at DESC);

-- ---------------------------------------------------------------------------
-- Bank payment (spec §14)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.bank_profiles (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  code           text NOT NULL,
  name           text NOT NULL,
  bank_code      text NOT NULL,
  -- เลขบัญชีบริษัทเป็นข้อมูลอ่อนไหว: เก็บ ciphertext (spec §16)
  account_number_encrypted bytea,
  file_format    text NOT NULL DEFAULT 'CSV' CHECK (file_format IN ('CSV', 'TXT', 'ISO20022')),
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX bank_profiles_code_key
  ON workforce.bank_profiles (tenant_id, company_id, lower(code));

CREATE TABLE workforce.bank_batches (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  run_id         uuid NOT NULL REFERENCES workforce.payroll_runs (id),
  bank_profile_id uuid NOT NULL REFERENCES workforce.bank_profiles (id),
  value_date     date NOT NULL,
  -- ยอดรวมควบคุม: ต้องเท่ากับผลรวมของ items เสมอ (spec §19.5)
  control_count  integer NOT NULL DEFAULT 0,
  control_total  numeric(19, 4) NOT NULL DEFAULT 0,
  currency       char(3) NOT NULL DEFAULT 'THB',
  status         text NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT', 'GENERATED', 'SENT', 'SETTLED', 'CANCELLED')),
  storage_object_id uuid REFERENCES workforce.storage_objects (id),
  generated_at   timestamptz,
  sent_at        timestamptz,
  settled_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        integer NOT NULL DEFAULT 1
);
CREATE INDEX bank_batches_run_idx ON workforce.bank_batches (tenant_id, run_id);

CREATE TABLE workforce.bank_batch_items (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  batch_id       uuid NOT NULL REFERENCES workforce.bank_batches (id) ON DELETE CASCADE,
  employment_id  uuid NOT NULL REFERENCES workforce.employments (id),
  result_id      uuid NOT NULL REFERENCES workforce.payroll_employee_results (id),
  amount         numeric(19, 4) NOT NULL CHECK (amount > 0),
  -- เลขบัญชีปลายทางเก็บเข้ารหัส; แสดงเฉพาะเลขท้ายไม่กี่ตัวใน UI
  account_number_encrypted bytea,
  account_last4  text,
  reference      text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'RETURNED')),
  failure_reason text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bank_batch_items_key ON workforce.bank_batch_items (batch_id, result_id);

-- ---------------------------------------------------------------------------
-- Export profiles and jobs (spec §14)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.export_profiles (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  code           text NOT NULL,
  name           text NOT NULL,
  export_type    text NOT NULL
                   CHECK (export_type IN (
                     'PAYROLL_REGISTER', 'BANK_FILE', 'GL_JOURNAL',
                     'TH_PND1', 'TH_PND1K', 'TH_50TAWI', 'TH_SSO_1_10', 'ATTENDANCE_ALL_SUM'
                   )),
  file_format    text NOT NULL DEFAULT 'CSV' CHECK (file_format IN ('CSV', 'TXT', 'XLSX', 'XML')),
  -- คอลัมน์ที่เลือกและลำดับ — spec §14 ต้องเลือกหัวตารางได้
  columns        text[] NOT NULL DEFAULT ARRAY[]::text[],
  options        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX export_profiles_code_key
  ON workforce.export_profiles (tenant_id, company_id, lower(code));

CREATE TABLE workforce.export_jobs (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  profile_id     uuid REFERENCES workforce.export_profiles (id),
  export_type    text NOT NULL,
  run_id         uuid REFERENCES workforce.payroll_runs (id),
  parameters     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status         text NOT NULL DEFAULT 'QUEUED'
                   CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  row_count      integer NOT NULL DEFAULT 0,
  storage_object_id uuid REFERENCES workforce.storage_objects (id),
  content_hash   bytea,
  error          text,
  requested_by   uuid,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX export_jobs_lookup_idx
  ON workforce.export_jobs (tenant_id, company_id, export_type, created_at DESC);

-- ---------------------------------------------------------------------------
-- Triggers, RLS and grants
-- ---------------------------------------------------------------------------

CREATE TRIGGER bank_profiles_touch BEFORE UPDATE ON workforce.bank_profiles
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER bank_batches_touch BEFORE UPDATE ON workforce.bank_batches
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER export_profiles_touch BEFORE UPDATE ON workforce.export_profiles
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();

DO $$
DECLARE
  target text;
  append_only text[] := ARRAY['payslip_documents', 'payslip_access_log'];
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'payslip_documents', 'payslip_access_log', 'bank_profiles', 'bank_batches',
    'bank_batch_items', 'export_profiles', 'export_jobs'
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
