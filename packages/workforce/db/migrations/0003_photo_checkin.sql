-- 0003_photo_checkin
--
-- Phase 3: mobile device registration, photo check-in sessions, evidence with
-- location and risk assessment, attendance policy groups.
--
-- อ้างอิง: spec §6.3, §6.4, §12, §16, §19.2
--
-- rollback: DROP TABLE workforce.photo_checkin_sessions, ... CASCADE;

-- ---------------------------------------------------------------------------
-- Attendance policy groups (spec §2.1)
--
-- ควบคุมว่าใครลงเวลาด้วยวิธีไหนได้บ้าง และเงื่อนไขของรูป/พิกัดเป็นอย่างไร
-- effective-dated เพราะนโยบายเปลี่ยนได้และต้องคำนวณย้อนหลังได้ (ADR-0012)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.attendance_policy_groups (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  code           text NOT NULL,
  name           text NOT NULL,
  -- วิธีลงเวลาที่อนุญาต; ปิดวิธีที่ไม่ใช้แทนการเปิดหมดแล้วค่อยกรองทีหลัง
  allowed_methods text[] NOT NULL DEFAULT ARRAY['FINGERPRINT_DEVICE']::text[],

  -- photo policy (spec §6.3)
  photo_required          text NOT NULL DEFAULT 'DISABLED'
                            CHECK (photo_required IN ('ALWAYS', 'RANDOM', 'RISK_BASED', 'DISABLED')),
  photo_random_percent    integer NOT NULL DEFAULT 0
                            CHECK (photo_random_percent BETWEEN 0 AND 100),
  location_required       boolean NOT NULL DEFAULT true,
  allowed_site_ids        uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  radius_m                integer NOT NULL DEFAULT 200 CHECK (radius_m > 0),
  max_accuracy_m          integer NOT NULL DEFAULT 100 CHECK (max_accuracy_m > 0),
  capture_deadline_seconds integer NOT NULL DEFAULT 30 CHECK (capture_deadline_seconds > 0),
  allow_offline_capture   boolean NOT NULL DEFAULT false,
  offline_max_age_minutes integer NOT NULL DEFAULT 120 CHECK (offline_max_age_minutes > 0),
  require_enrolled_device boolean NOT NULL DEFAULT true,
  -- สิ่งที่ทำเมื่อพบความเสี่ยง — spec §6.4 ห้ามปฏิเสธแบบมืดมนโดยไม่มีทางอุทธรณ์
  risk_action             text NOT NULL DEFAULT 'REVIEW'
                            CHECK (risk_action IN ('WARN', 'REVIEW', 'REJECT')),
  photo_retention_days    integer NOT NULL DEFAULT 90 CHECK (photo_retention_days > 0),
  -- ห้ามรับรูปจาก gallery ใน strict mode (spec §6.3)
  require_live_capture    boolean NOT NULL DEFAULT true,

  effective_from date NOT NULL,
  effective_to   date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT attendance_policy_groups_range
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX attendance_policy_groups_lookup_idx
  ON workforce.attendance_policy_groups (tenant_id, company_id, effective_from DESC);
CREATE UNIQUE INDEX attendance_policy_groups_open_key
  ON workforce.attendance_policy_groups (tenant_id, company_id, lower(code))
  WHERE effective_to IS NULL;

CREATE TABLE workforce.attendance_policy_group_members (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  policy_group_id uuid NOT NULL REFERENCES workforce.attendance_policy_groups (id),
  employment_id  uuid NOT NULL REFERENCES workforce.employments (id),
  effective_from date NOT NULL,
  effective_to   date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT attendance_policy_group_members_range
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX attendance_policy_group_members_lookup_idx
  ON workforce.attendance_policy_group_members (tenant_id, employment_id, effective_from DESC);
-- พนักงานอยู่ได้กลุ่มเดียว ณ เวลาหนึ่ง — ไม่งั้นนโยบายขัดกันเอง
CREATE UNIQUE INDEX attendance_policy_group_members_open_key
  ON workforce.attendance_policy_group_members (tenant_id, employment_id)
  WHERE effective_to IS NULL;

CREATE TRIGGER attendance_policy_group_members_no_overlap
  BEFORE INSERT OR UPDATE ON workforce.attendance_policy_group_members
  FOR EACH ROW EXECUTE FUNCTION workforce.assert_no_effective_overlap('employment_id');

-- ---------------------------------------------------------------------------
-- Mobile device registration (spec §6.4)
--
-- 1 เครื่องต่อพนักงานตามนโยบาย; เปลี่ยนเครื่องต้องขออนุมัติ
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.mobile_device_registrations (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES workforce.tenants (id),
  employment_id   uuid NOT NULL REFERENCES workforce.employments (id),
  -- ตัวระบุเครื่องที่แอปสร้างขึ้น ไม่ใช่ IMEI หรือ advertising id
  device_fingerprint text NOT NULL,
  platform        text NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  model           text,
  app_version     text,
  -- ผลการยืนยันความน่าเชื่อถือของเครื่อง; PWA ทำได้แค่ UNAVAILABLE (spec §6.4)
  attestation_status text NOT NULL DEFAULT 'UNAVAILABLE'
                       CHECK (attestation_status IN ('VERIFIED', 'FAILED', 'UNAVAILABLE')),
  status          text NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED', 'REPLACED')),
  approved_by     uuid,
  approved_at     timestamptz,
  revoked_at      timestamptz,
  revoked_reason  text,
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  version         integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX mobile_device_registrations_active_key
  ON workforce.mobile_device_registrations (tenant_id, employment_id)
  WHERE status = 'ACTIVE';
CREATE INDEX mobile_device_registrations_employment_idx
  ON workforce.mobile_device_registrations (tenant_id, employment_id, status);
CREATE UNIQUE INDEX mobile_device_registrations_fingerprint_key
  ON workforce.mobile_device_registrations (tenant_id, employment_id, device_fingerprint);

-- ---------------------------------------------------------------------------
-- Photo check-in session
--
-- แยก create → upload → commit เพื่อให้ upload ที่ล้มเหลว retry ได้
-- โดยไม่สร้าง time event ซ้ำ (spec §13)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.photo_checkin_sessions (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  employment_id  uuid NOT NULL REFERENCES workforce.employments (id),
  mobile_device_registration_id uuid REFERENCES workforce.mobile_device_registrations (id),
  event_intent   text NOT NULL DEFAULT 'AUTO',
  status         text NOT NULL DEFAULT 'OPEN'
                   CHECK (status IN ('OPEN', 'EVIDENCE_ATTACHED', 'COMMITTED', 'EXPIRED', 'ABANDONED')),
  -- ผู้ใช้ต้องยืนยันภายในเวลานี้ ไม่งั้นรูปที่ถ่ายไว้ล่วงหน้าจะถูกนำมาใช้ทีหลังได้
  expires_at     timestamptz NOT NULL,
  committed_event_id uuid REFERENCES workforce.raw_time_events (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  committed_at   timestamptz
);
CREATE INDEX photo_checkin_sessions_employment_idx
  ON workforce.photo_checkin_sessions (tenant_id, employment_id, created_at DESC);

-- metadata ของรูป — bytes อยู่ใน private object storage (ADR-0010)
CREATE TABLE workforce.photo_evidence_objects (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  session_id     uuid REFERENCES workforce.photo_checkin_sessions (id),
  storage_object_id uuid NOT NULL REFERENCES workforce.storage_objects (id),
  sha256         bytea NOT NULL,
  captured_at_client timestamptz NOT NULL,
  uploaded_at_server timestamptz NOT NULL DEFAULT now(),
  content_type   text NOT NULL,
  size_bytes     bigint NOT NULL CHECK (size_bytes > 0),
  -- true = ถ่ายสดจากกล้อง; false = เลือกจาก gallery (strict policy ไม่รับ)
  live_capture   boolean NOT NULL DEFAULT true,
  retention_until date NOT NULL,
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX photo_evidence_objects_session_idx
  ON workforce.photo_evidence_objects (tenant_id, session_id);
-- ตรวจรูปซ้ำจาก checksum โดยไม่ต้องดาวน์โหลดไฟล์ (anti-fraud, spec §6.4)
CREATE INDEX photo_evidence_objects_sha_idx ON workforce.photo_evidence_objects (tenant_id, sha256);
CREATE INDEX photo_evidence_objects_retention_idx
  ON workforce.photo_evidence_objects (retention_until)
  WHERE deleted_at IS NULL;

-- หลักฐานประกอบ event: พิกัด อุปกรณ์ และผลการประเมินความเสี่ยง
CREATE TABLE workforce.time_event_evidence (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  raw_time_event_id uuid REFERENCES workforce.raw_time_events (id),
  session_id     uuid REFERENCES workforce.photo_checkin_sessions (id),
  photo_evidence_id uuid REFERENCES workforce.photo_evidence_objects (id),
  latitude       numeric(9, 6),
  longitude      numeric(9, 6),
  accuracy_m     numeric(9, 2),
  site_id        uuid REFERENCES workforce.sites (id),
  distance_from_site_m numeric(12, 2),
  platform       text,
  app_version    text,
  attestation_status text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX time_event_evidence_event_idx
  ON workforce.time_event_evidence (tenant_id, raw_time_event_id);

CREATE TABLE workforce.mobile_risk_assessments (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  session_id     uuid REFERENCES workforce.photo_checkin_sessions (id),
  raw_time_event_id uuid REFERENCES workforce.raw_time_events (id),
  employment_id  uuid NOT NULL REFERENCES workforce.employments (id),
  decision       text NOT NULL
                   CHECK (decision IN ('ACCEPTED', 'ACCEPTED_WITH_WARNING', 'PENDING_REVIEW', 'REJECTED_POLICY')),
  risk_flags     text[] NOT NULL DEFAULT ARRAY[]::text[],
  score          integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  policy_group_id uuid REFERENCES workforce.attendance_policy_groups (id),
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_at    timestamptz,
  reviewed_by    uuid,
  review_outcome text CHECK (review_outcome IS NULL OR review_outcome IN ('APPROVED', 'REJECTED')),
  review_reason  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mobile_risk_assessments_review_idx
  ON workforce.mobile_risk_assessments (tenant_id, decision, created_at DESC)
  WHERE reviewed_at IS NULL;
CREATE INDEX mobile_risk_assessments_employment_idx
  ON workforce.mobile_risk_assessments (tenant_id, employment_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Triggers, RLS and grants
-- ---------------------------------------------------------------------------

CREATE TRIGGER attendance_policy_groups_touch BEFORE UPDATE ON workforce.attendance_policy_groups
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER attendance_policy_group_members_touch
  BEFORE UPDATE ON workforce.attendance_policy_group_members
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();
CREATE TRIGGER mobile_device_registrations_touch
  BEFORE UPDATE ON workforce.mobile_device_registrations
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();

ALTER TABLE workforce.attendance_policy_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.attendance_policy_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY attendance_policy_groups_isolation ON workforce.attendance_policy_groups
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.attendance_policy_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.attendance_policy_group_members FORCE ROW LEVEL SECURITY;
CREATE POLICY attendance_policy_group_members_isolation
  ON workforce.attendance_policy_group_members
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.mobile_device_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.mobile_device_registrations FORCE ROW LEVEL SECURITY;
CREATE POLICY mobile_device_registrations_isolation ON workforce.mobile_device_registrations
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.photo_checkin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.photo_checkin_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY photo_checkin_sessions_isolation ON workforce.photo_checkin_sessions
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.photo_evidence_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.photo_evidence_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY photo_evidence_objects_isolation ON workforce.photo_evidence_objects
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.time_event_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.time_event_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY time_event_evidence_isolation ON workforce.time_event_evidence
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.mobile_risk_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.mobile_risk_assessments FORCE ROW LEVEL SECURITY;
CREATE POLICY mobile_risk_assessments_isolation ON workforce.mobile_risk_assessments
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

-- grant เฉพาะตารางของ migration นี้ (ห้าม GRANT ... ON ALL TABLES — ดู 0002)
GRANT SELECT, INSERT, UPDATE, DELETE ON
  workforce.attendance_policy_groups,
  workforce.attendance_policy_group_members,
  workforce.mobile_device_registrations,
  workforce.photo_checkin_sessions,
  workforce.photo_evidence_objects,
  workforce.time_event_evidence,
  workforce.mobile_risk_assessments
TO workforce_app;
