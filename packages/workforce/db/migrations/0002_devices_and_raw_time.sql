-- 0002_devices_and_raw_time
--
-- Phase 2: per-device identity, signed batch ingestion, immutable raw time events,
-- device commands with nonce/expiry, biometric references (never templates).
--
-- อ้างอิง: spec §6.1, §6.2, §12, §19.1; ADR-0002, ADR-0008, ADR-0012
--
-- rollback: DROP TABLE workforce.raw_time_event_quarantine, workforce.raw_time_events, ... CASCADE;

-- ---------------------------------------------------------------------------
-- Devices and credentials
--
-- ระบบเดิมใช้ shared `DEVICE_KEY` ตัวเดียวทุกเครื่อง hard-code ไว้ใน firmware
-- (spec §3.3 C3) เครื่องหนึ่งหลุด = ปลอมได้ทุกเครื่อง และ revoke ทีละเครื่องไม่ได้
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.devices (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id       uuid NOT NULL REFERENCES workforce.companies (id),
  device_code      text NOT NULL,
  name             text NOT NULL DEFAULT '',
  site_id          uuid REFERENCES workforce.sites (id),
  device_type      text NOT NULL DEFAULT 'FINGERPRINT_TERMINAL'
                     CHECK (device_type IN ('FINGERPRINT_TERMINAL', 'KIOSK', 'GATEWAY')),
  status           text NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED')),
  time_zone        text NOT NULL DEFAULT 'Asia/Bangkok',
  firmware_version text,
  config_version   integer NOT NULL DEFAULT 0,
  last_seen_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid,
  version          integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX devices_company_code_key
  ON workforce.devices (tenant_id, company_id, lower(device_code));
CREATE INDEX devices_status_idx ON workforce.devices (tenant_id, status);

CREATE TABLE workforce.device_credentials (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  device_id      uuid NOT NULL REFERENCES workforce.devices (id),
  -- public key เท่านั้น — private key ไม่เคยออกจากเครื่อง
  public_key     bytea NOT NULL,
  algorithm      text NOT NULL DEFAULT 'ed25519' CHECK (algorithm IN ('ed25519')),
  status         text NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE', 'REVOKED')),
  activated_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  revoked_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  CONSTRAINT device_credentials_revoked_has_reason
    CHECK (status <> 'REVOKED' OR (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL))
);
-- หนึ่งเครื่องมี credential ที่ใช้งานอยู่ได้ใบเดียว — การหมุนกุญแจต้อง revoke ใบเก่าก่อน
CREATE UNIQUE INDEX device_credentials_active_key
  ON workforce.device_credentials (device_id)
  WHERE status = 'ACTIVE';
CREATE INDEX device_credentials_device_idx ON workforce.device_credentials (tenant_id, device_id);

CREATE TABLE workforce.device_activation_tokens (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES workforce.tenants (id),
  device_id  uuid NOT NULL REFERENCES workforce.devices (id),
  -- เก็บเฉพาะ hash — token ตัวจริงแสดงครั้งเดียวตอนสร้างแล้วหายไป
  token_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX device_activation_tokens_hash_key
  ON workforce.device_activation_tokens (token_hash);
CREATE INDEX device_activation_tokens_device_idx
  ON workforce.device_activation_tokens (tenant_id, device_id);

CREATE TABLE workforce.device_heartbeats (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES workforce.tenants (id),
  device_id        uuid NOT NULL REFERENCES workforce.devices (id),
  reported_at      timestamptz NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  -- ความต่างระหว่างนาฬิกาเครื่องกับ server — ใช้ตรวจ anomaly ไม่ใช้แก้เวลา (spec §6.2)
  clock_drift_ms   bigint NOT NULL DEFAULT 0,
  queue_depth      integer NOT NULL DEFAULT 0,
  template_count   integer NOT NULL DEFAULT 0,
  firmware_version text,
  config_version   integer,
  metrics          jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX device_heartbeats_device_time_idx
  ON workforce.device_heartbeats (tenant_id, device_id, reported_at DESC);

-- ---------------------------------------------------------------------------
-- Device commands
--
-- ระบบเดิมใช้ตัวแปร in-memory (`enrollQueue`, `sensorClearPending`) ซึ่งหายเมื่อ
-- restart และแยกเครื่องไม่ได้ (spec §3.3 S6)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.device_commands (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES workforce.tenants (id),
  device_id    uuid NOT NULL REFERENCES workforce.devices (id),
  command_type text NOT NULL
                 CHECK (command_type IN (
                   'ENROLL_BIOMETRIC', 'DELETE_BIOMETRIC', 'CLEAR_SENSOR',
                   'UPDATE_CONFIG', 'REBOOT'
                 )),
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- one-time nonce กัน replay ของคำสั่งเดิม (spec §6.2)
  nonce        bytea NOT NULL,
  status       text NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING', 'DELIVERED', 'ACKED', 'FAILED', 'EXPIRED', 'CANCELLED')),
  expires_at   timestamptz NOT NULL,
  delivered_at timestamptz,
  acked_at     timestamptz,
  result       jsonb,
  requested_by uuid,
  reason       text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX device_commands_nonce_key ON workforce.device_commands (nonce);
CREATE INDEX device_commands_pending_idx
  ON workforce.device_commands (tenant_id, device_id, status, created_at);

-- ---------------------------------------------------------------------------
-- Biometric references
--
-- ห้ามเก็บ template หรือภาพลายนิ้วมือใน cloud (spec §6.2, §16)
-- ตารางนี้เก็บเฉพาะ "นิ้วของใครอยู่ slot ไหนของเครื่องไหน" + hash ไว้เทียบ
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.biometric_enrollments (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES workforce.tenants (id),
  employment_id    uuid NOT NULL REFERENCES workforce.employments (id),
  device_id        uuid NOT NULL REFERENCES workforce.devices (id),
  template_slot    integer NOT NULL CHECK (template_slot >= 0),
  -- hash ของ template ที่อยู่ในเครื่อง ใช้ยืนยันว่า sync ตรงกัน ไม่ใช่ตัว template
  template_hash    bytea,
  template_version integer NOT NULL DEFAULT 1,
  quality          integer CHECK (quality IS NULL OR quality BETWEEN 0 AND 100),
  finger_position  text,
  status           text NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('PENDING', 'ACTIVE', 'DELETED')),
  enrolled_at      timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid
);
-- หนึ่ง slot ของเครื่องหนึ่งเป็นของคนเดียว — ป้องกัน slot ค้างแล้ว match ผิดคน
CREATE UNIQUE INDEX biometric_enrollments_device_slot_key
  ON workforce.biometric_enrollments (device_id, template_slot)
  WHERE status IN ('PENDING', 'ACTIVE');
CREATE INDEX biometric_enrollments_employment_idx
  ON workforce.biometric_enrollments (tenant_id, employment_id, status);

CREATE TABLE workforce.biometric_deletion_jobs (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES workforce.tenants (id),
  employment_id uuid NOT NULL REFERENCES workforce.employments (id),
  device_id     uuid NOT NULL REFERENCES workforce.devices (id),
  enrollment_id uuid REFERENCES workforce.biometric_enrollments (id),
  command_id    uuid REFERENCES workforce.device_commands (id),
  status        text NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'SENT', 'ACKED', 'FAILED')),
  reason        text NOT NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  acked_at      timestamptz,
  last_error    text
);
CREATE INDEX biometric_deletion_jobs_status_idx
  ON workforce.biometric_deletion_jobs (tenant_id, status, requested_at);

-- ---------------------------------------------------------------------------
-- Device authentication lookups
--
-- เครื่องสแกนไม่มี JWT และไม่รู้จัก tenant_id ของตัวเอง — server ต้องหาให้ได้
-- จาก device id ก่อนจึงจะตั้ง tenant context ได้ ซึ่งเป็นสถานการณ์ไก่กับไข่กับ RLS
--
-- แก้ด้วย SECURITY DEFINER function ที่คืนเฉพาะ field ที่จำเป็นต่อการ authenticate
-- เท่านั้น แคบกว่าการเปิด bypass ทั้ง connection มาก และตรวจสอบได้ว่าเปิดช่องอะไรไว้บ้าง
-- `SET search_path` จำเป็นเพื่อกันการ hijack ด้วย object ที่ชื่อชนกัน
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION workforce.lookup_device_credential(p_device_id uuid)
RETURNS TABLE (
  tenant_id     uuid,
  company_id    uuid,
  device_status text,
  public_key    bytea,
  algorithm     text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = workforce, pg_temp
AS $$
  SELECT d.tenant_id, d.company_id, d.status, c.public_key, c.algorithm
  FROM workforce.devices d
  JOIN workforce.device_credentials c
    ON c.device_id = d.id AND c.status = 'ACTIVE'
  WHERE d.id = p_device_id
$$;

CREATE OR REPLACE FUNCTION workforce.lookup_activation_token(p_token_hash bytea)
RETURNS TABLE (
  token_id   uuid,
  tenant_id  uuid,
  device_id  uuid,
  expires_at timestamptz,
  used_at    timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = workforce, pg_temp
AS $$
  SELECT t.id, t.tenant_id, t.device_id, t.expires_at, t.used_at
  FROM workforce.device_activation_tokens t
  WHERE t.token_hash = p_token_hash
$$;

-- legacy adapter: firmware เดิมรู้จักแค่ device code เป็นสตริง (เช่น 'OFFICE')
-- คืนแถวเดียวเมื่อ code นั้นไม่กำกวมทั้งระบบเท่านั้น — ถ้าซ้ำข้าม tenant จะคืน 0 แถว
-- และ adapter จะปฏิเสธ ดีกว่าเดาว่าเป็นของ tenant ไหน
CREATE OR REPLACE FUNCTION workforce.lookup_legacy_device(p_device_code text)
RETURNS TABLE (
  device_id  uuid,
  tenant_id  uuid,
  company_id uuid,
  status     text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = workforce, pg_temp
AS $$
  SELECT d.id, d.tenant_id, d.company_id, d.status
  FROM workforce.devices d
  WHERE lower(d.device_code) = lower(p_device_code)
    AND (SELECT count(*) FROM workforce.devices x
         WHERE lower(x.device_code) = lower(p_device_code)) = 1
$$;

GRANT EXECUTE ON FUNCTION workforce.lookup_device_credential(uuid) TO workforce_app;
GRANT EXECUTE ON FUNCTION workforce.lookup_activation_token(bytea) TO workforce_app;
GRANT EXECUTE ON FUNCTION workforce.lookup_legacy_device(text) TO workforce_app;

-- ---------------------------------------------------------------------------
-- Raw time events — immutable, append only
--
-- ตารางนี้ห้ามมีผลลัพธ์ทางธุรกิจที่เปลี่ยนได้ เช่น is_late (spec §12)
-- ค่าเหล่านั้นอยู่ใน attendance_results ที่มี version (Phase 4)
-- ---------------------------------------------------------------------------

CREATE TABLE workforce.raw_time_events (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  company_id     uuid NOT NULL REFERENCES workforce.companies (id),
  -- NULL ได้: สแกนด้วยนิ้วที่ไม่รู้จักก็ยังต้องเก็บเป็นหลักฐาน แต่จะไม่กลายเป็นเวลาทำงาน
  -- (ระบบเดิมสร้าง attendance log ให้ 'Unknown' — spec §3.3 C9)
  employment_id  uuid REFERENCES workforce.employments (id),
  source_type    text NOT NULL
                   CHECK (source_type IN (
                     'FINGERPRINT_DEVICE', 'MOBILE_APP', 'WEB', 'MANUAL', 'LEGACY_UNTRUSTED', 'IMPORT'
                   )),
  source_id      uuid,
  event_intent   text NOT NULL DEFAULT 'AUTO'
                   CHECK (event_intent IN (
                     'AUTO', 'CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_END',
                     'SITE_CHECK_IN', 'SITE_CHECK_OUT'
                   )),
  -- เวลาที่เครื่องบันทึก ไม่ใช่เวลาที่ server ได้รับ — offline sync ต้องได้เวลาจริง
  captured_at    timestamptz NOT NULL,
  time_zone      text NOT NULL DEFAULT 'Asia/Bangkok',
  received_at    timestamptz NOT NULL DEFAULT now(),
  sequence       bigint,
  payload_hash   bytea NOT NULL,
  evidence       jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature      bytea,
  status         text NOT NULL DEFAULT 'ACCEPTED'
                   CHECK (status IN ('ACCEPTED', 'QUARANTINED')),
  quarantine_reason text,
  ingest_batch_id   uuid
);
-- (source, sequence) ต้องไม่ซ้ำ — retry ของ batch เดิมจึงสร้างแถวเดียว (spec §6.1)
CREATE UNIQUE INDEX raw_time_events_source_sequence_key
  ON workforce.raw_time_events (source_id, sequence)
  WHERE source_id IS NOT NULL AND sequence IS NOT NULL;
CREATE INDEX raw_time_events_employment_time_idx
  ON workforce.raw_time_events (tenant_id, employment_id, captured_at DESC);
CREATE INDEX raw_time_events_company_time_idx
  ON workforce.raw_time_events (tenant_id, company_id, captured_at DESC);
CREATE INDEX raw_time_events_source_idx
  ON workforce.raw_time_events (tenant_id, source_type, source_id, captured_at DESC);

-- raw event แก้ไขหรือลบไม่ได้ (spec §1.4, §21) — การแก้เวลาใช้ adjustment ใน Phase 4
CREATE TRIGGER raw_time_events_immutable
  BEFORE UPDATE OR DELETE ON workforce.raw_time_events
  FOR EACH ROW EXECUTE FUNCTION workforce.reject_mutation();

-- เหตุการณ์ที่ sequence ซ้ำแต่ payload ต่าง — ห้ามทับของเดิมและห้ามทิ้งเงียบ (spec §6.1)
CREATE TABLE workforce.raw_time_event_quarantine (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  source_type    text NOT NULL,
  source_id      uuid,
  sequence       bigint,
  claimed_event_id uuid,
  existing_event_id uuid REFERENCES workforce.raw_time_events (id),
  reason         text NOT NULL,
  payload        jsonb NOT NULL,
  payload_hash   bytea NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_at    timestamptz,
  reviewed_by    uuid,
  resolution     text
);
CREATE INDEX raw_time_event_quarantine_open_idx
  ON workforce.raw_time_event_quarantine (tenant_id, received_at DESC)
  WHERE reviewed_at IS NULL;

-- บันทึกการรับ batch เพื่อให้ ACK high-water mark ตรวจสอบย้อนหลังได้
CREATE TABLE workforce.device_ingest_batches (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES workforce.tenants (id),
  device_id      uuid NOT NULL REFERENCES workforce.devices (id),
  received_at    timestamptz NOT NULL DEFAULT now(),
  event_count    integer NOT NULL DEFAULT 0,
  accepted_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  quarantined_count integer NOT NULL DEFAULT 0,
  min_sequence   bigint,
  max_sequence   bigint,
  acked_sequence bigint,
  clock_drift_ms bigint NOT NULL DEFAULT 0
);
CREATE INDEX device_ingest_batches_device_idx
  ON workforce.device_ingest_batches (tenant_id, device_id, received_at DESC);

-- ---------------------------------------------------------------------------
-- Triggers, RLS and grants
-- ---------------------------------------------------------------------------

CREATE TRIGGER devices_touch BEFORE UPDATE ON workforce.devices
  FOR EACH ROW EXECUTE FUNCTION workforce.touch_row();

ALTER TABLE workforce.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.devices FORCE ROW LEVEL SECURITY;
CREATE POLICY devices_isolation ON workforce.devices
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.device_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.device_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY device_credentials_isolation ON workforce.device_credentials
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.device_activation_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.device_activation_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY device_activation_tokens_isolation ON workforce.device_activation_tokens
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.device_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.device_heartbeats FORCE ROW LEVEL SECURITY;
CREATE POLICY device_heartbeats_isolation ON workforce.device_heartbeats
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.device_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.device_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY device_commands_isolation ON workforce.device_commands
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.biometric_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.biometric_enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY biometric_enrollments_isolation ON workforce.biometric_enrollments
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.biometric_deletion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.biometric_deletion_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY biometric_deletion_jobs_isolation ON workforce.biometric_deletion_jobs
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

-- raw_time_events: อ่านและเขียนได้ในขอบเขต tenant แต่ไม่มี policy UPDATE/DELETE
-- จึงถูกปฏิเสธที่ชั้น RLS ก่อนถึง trigger
ALTER TABLE workforce.raw_time_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.raw_time_events FORCE ROW LEVEL SECURITY;
CREATE POLICY raw_time_events_select ON workforce.raw_time_events
  FOR SELECT USING (tenant_id = workforce.current_tenant_id());
CREATE POLICY raw_time_events_insert ON workforce.raw_time_events
  FOR INSERT WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.raw_time_event_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.raw_time_event_quarantine FORCE ROW LEVEL SECURITY;
CREATE POLICY raw_time_event_quarantine_isolation ON workforce.raw_time_event_quarantine
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

ALTER TABLE workforce.device_ingest_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.device_ingest_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY device_ingest_batches_isolation ON workforce.device_ingest_batches
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

-- Grant เฉพาะตารางใหม่ของ migration นี้
--
-- ห้ามใช้ `GRANT ... ON ALL TABLES IN SCHEMA workforce` เด็ดขาด: มันจะคืนสิทธิ์
-- UPDATE/DELETE ให้ตารางที่เคย REVOKE ไว้ (audit_events) โดยไม่มีใครสังเกต
-- `append_only_tables_have_no_write_grants` ใน schema-invariants.test.ts เฝ้าข้อนี้อยู่
GRANT SELECT, INSERT, UPDATE, DELETE ON
  workforce.devices,
  workforce.device_credentials,
  workforce.device_activation_tokens,
  workforce.device_heartbeats,
  workforce.device_commands,
  workforce.biometric_enrollments,
  workforce.biometric_deletion_jobs,
  workforce.raw_time_event_quarantine,
  workforce.device_ingest_batches
TO workforce_app;

-- raw_time_events เป็น append-only เช่นเดียวกับ audit_events (spec §1.4)
--
-- ต้อง REVOKE ให้ชัด ไม่ใช่แค่ "ไม่ GRANT": migration 0001 ตั้ง
-- ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE ไว้
-- ตารางที่สร้างหลังจากนั้นจึงได้สิทธิ์ครบทั้งสี่มาโดยอัตโนมัติ
GRANT SELECT, INSERT ON workforce.raw_time_events TO workforce_app;
REVOKE UPDATE, DELETE, TRUNCATE ON workforce.raw_time_events FROM workforce_app;
