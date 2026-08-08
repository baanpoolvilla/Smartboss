-- ══════════════════════════════════════════════════════════════════════
--  ตรวจสุขภาพหลัง bootstrap — รันหลัง 00/01/02 และหลัง wf:migrate
--
--  ไฟล์นี้ไม่แก้อะไร อ่านอย่างเดียว ทุกบรรทัดที่ขึ้น FAIL คือของที่พังแน่นอน
--  ตอนใช้งานจริง ให้แก้ก่อนเปิดใช้
-- ══════════════════════════════════════════════════════════════════════

\echo '=== 1) role ต้องมีครบและ workforce_app ต้องข้าม RLS ไม่ได้ ==='
SELECT
  rolname,
  rolbypassrls,
  CASE
    WHEN rolname = 'workforce_app' AND rolbypassrls THEN 'FAIL — workforce_app มี BYPASSRLS จะทำให้ RLS ไม่มีผลทั้งระบบ'
    ELSE 'ok'
  END AS verdict
FROM pg_roles
WHERE rolname IN ('workforce_app', 'workforce_lookup')
ORDER BY rolname;

\echo ''
\echo '=== 2) user ของแอปต้องสวมบท workforce_app ได้ (withTenant ใช้) ==='
SELECT
  CASE WHEN pg_has_role(CURRENT_USER, 'workforce_app', 'USAGE')
       THEN 'ok'
       ELSE 'FAIL — ยังไม่ได้รัน 01-grant-app-role.sql (หรือรันด้วย user คนละตัวกับที่แอปใช้)'
  END AS verdict,
  CURRENT_USER AS checked_as;

\echo ''
\echo '=== 3) ฟังก์ชัน lookup ต้องเป็นของ workforce_lookup และเป็น SECURITY DEFINER ==='
\echo '    (ถ้าไม่ใช่ เครื่องสแกนจะ activate ไม่ได้ ขึ้น 401 invalid activation token)'
SELECT
  p.proname,
  pg_get_userbyid(p.proowner) AS owner,
  p.prosecdef                 AS security_definer,
  CASE
    WHEN pg_get_userbyid(p.proowner) <> 'workforce_lookup' THEN 'FAIL — ยังไม่ได้รัน 02-lookup-functions-owner.sql'
    WHEN NOT p.prosecdef THEN 'FAIL — ไม่ใช่ SECURITY DEFINER'
    ELSE 'ok'
  END AS verdict
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'workforce'
  AND p.proname IN ('lookup_activation_token', 'lookup_device_credential', 'lookup_legacy_device')
ORDER BY p.proname;

\echo ''
\echo '=== 4) policy ข้าม tenant ต้องมีครบ 3 ตาราง และต้องผูกกับ workforce_lookup เท่านั้น ==='
WITH expected(tablename) AS (
  VALUES ('device_activation_tokens'), ('devices'), ('device_credentials')
)
SELECT
  e.tablename,
  p.policyname,
  p.roles::text AS applies_to,
  CASE
    WHEN p.policyname IS NULL THEN 'FAIL — ยังไม่ได้รัน 02-lookup-functions-owner.sql (เครื่องสแกนจะ activate ไม่ได้)'
    WHEN p.roles::text <> '{workforce_lookup}' THEN 'FAIL — policy ข้าม tenant ต้องจำกัดที่ workforce_lookup เท่านั้น'
    ELSE 'ok'
  END AS verdict
FROM expected e
LEFT JOIN pg_policies p
  ON p.schemaname = 'workforce'
 AND p.tablename = e.tablename
 AND p.policyname LIKE '%_lookup'
ORDER BY e.tablename;

\echo ''
\echo '=== 5) ตารางที่มี tenant_id ต้องเปิด RLS แบบ FORCE ==='
\echo '    ยกเว้น 4 ตารางโครงสร้างพื้นฐานที่ตั้งใจไม่มี RLS — เข้าถึงผ่าน service'
\echo '    ที่ไม่รับ tenant จาก client (ล็อกไว้ด้วย schema-invariants.test.ts)'
SELECT
  c.relname,
  c.relrowsecurity      AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  CASE
    WHEN NOT c.relrowsecurity THEN 'FAIL — ไม่ได้เปิด RLS ข้อมูลรั่วข้ามบริษัทได้'
    ELSE 'FAIL — ไม่ FORCE เจ้าของตารางจะมองข้าม RLS'
  END AS verdict
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'workforce'
  AND c.relkind = 'r'
  AND EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped
  )
  AND c.relname NOT IN ('idempotency_keys', 'inbox_messages', 'jobs', 'outbox_messages')
  AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
ORDER BY c.relname;
\echo '    (ไม่มีแถว = ผ่านทุกตาราง)'

\echo ''
\echo '=== 6) พิสูจน์ว่า RLS ปิดกั้นจริง — สวมบท workforce_app โดยไม่ตั้ง tenant ==='
\echo '    ต้องได้ 0 ทุกช่อง ถ้าไม่ใช่ แปลว่า isolation ข้ามบริษัทพัง'
BEGIN;
SET LOCAL ROLE workforce_app;
SELECT
  (SELECT count(*) FROM workforce.devices)      AS devices_visible,
  (SELECT count(*) FROM workforce.employments)  AS employments_visible;
ROLLBACK;
