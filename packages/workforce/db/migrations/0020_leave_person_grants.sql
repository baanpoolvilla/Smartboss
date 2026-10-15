-- สิทธิ์ Holiday ที่ HR เพิ่มให้รายคน (เพิ่มจากสิทธิ์รายเดือนของบริษัท)
--
-- ที่มา: บางคนยังไม่ได้ใช้วันหยุดของเดือนก่อนเริ่มนับสิทธิ์ (เช่นวันแม่ ส.ค. 2569 ก่อนเปิดระบบ ต.ค.)
-- HR จึงเพิ่มให้เฉพาะคนนั้นเป็นสิทธิ์ของเดือนใดเดือนหนึ่ง — กติกาอายุใช้งานเหมือนสิทธิ์ของบริษัท (3 เดือนรวมเดือนนั้น)
-- ไม่มีแถว = ไม่มีอะไรเปลี่ยน คนอื่น/เดือนอื่นคิดเหมือนเดิมทุกอย่าง

CREATE TABLE IF NOT EXISTS workforce.leave_person_grants (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  company_id    uuid NOT NULL,
  employment_id uuid NOT NULL REFERENCES workforce.employments(id),
  leave_type_id uuid NOT NULL REFERENCES workforce.leave_types(id),
  -- วันแรกของเดือนที่นับเป็นสิทธิ์
  month         date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  days          integer NOT NULL CHECK (days >= 1 AND days <= 31),
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);

CREATE INDEX IF NOT EXISTS leave_person_grants_lookup_idx
  ON workforce.leave_person_grants (tenant_id, leave_type_id, employment_id);

ALTER TABLE workforce.leave_person_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.leave_person_grants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_person_grants_isolation ON workforce.leave_person_grants;
CREATE POLICY leave_person_grants_isolation ON workforce.leave_person_grants
  USING (tenant_id = workforce.current_tenant_id())
  WITH CHECK (tenant_id = workforce.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON workforce.leave_person_grants TO workforce_app;
