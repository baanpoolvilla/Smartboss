-- ══════════════════════════════════════════════════════════════════════
--  แก้ให้ฟังก์ชันค้นหาข้ามบริษัททำงานได้จริง
--
--  ⚠ ต้องรัน **หลัง** `pnpm wf:migrate` เพราะอ้างถึงตารางกับฟังก์ชัน
--    ที่ migration เป็นคนสร้าง
--
--  ปัญหา: ตารางใน schema workforce เปิด FORCE ROW LEVEL SECURITY ซึ่ง
--  "บังคับกับเจ้าของตารางด้วย" ฟังก์ชัน SECURITY DEFINER สามตัวด้านล่างจึงถูก
--  RLS กรองทิ้งเมื่อเจ้าของฟังก์ชันเป็น role ธรรมดา (ไม่ใช่ superuser)
--
--  ฟังก์ชันกลุ่มนี้ต้องค้นข้าม tenant โดยเจตนา เพราะเครื่องสแกน "ยังไม่รู้ว่า
--  ตัวเองอยู่บริษัทไหน" ตอน activate — ถ้าถูกกรอง เครื่องจะ activate ไม่ได้เลย
--  และอาการคือ 401 invalid activation token ทั้งที่ token ถูกต้อง
--
--  วิธีแก้: ย้ายเจ้าของ 3 ฟังก์ชันนี้ไปเป็น role เฉพาะกิจ ซึ่ง "ไม่ใช่เจ้าของตาราง"
--  ⇒ FORCE ไม่มีผลกับมัน ⇒ ใช้ RLS policy ปกติคุมได้ แล้วเปิด policy ให้
--  role นั้นอ่านข้ามบริษัทได้เฉพาะ SELECT เฉพาะ 3 ตารางนี้เท่านั้น
--
--  ทำไมไม่ใช้ BYPASSRLS (เวอร์ชันก่อนหน้าใช้):
--    1. CREATE ROLE ... BYPASSRLS ต้องใช้ superuser — Neon กับ Supabase ไม่ให้
--       ⇒ deploy บนคลาวด์ไม่ผ่าน แล้วเครื่องสแกน activate ไม่ได้
--    2. BYPASSRLS ข้าม RLS *ทุกตารางในฐานข้อมูล* ส่วน policy ด้านล่างจำกัด
--       ไว้แค่ 3 ตาราง อ่านอย่างเดียว — แคบกว่าและตรวจสอบง่ายกว่า
--
--  ที่ยังคงเดิม: ไม่ให้สิทธิ์ข้าม tenant กับ role ของแอป (workforce_app)
--  เพราะจะทำให้ทุก query ที่ลืมตั้ง tenant มองเห็นข้อมูลข้ามบริษัท
--  โดยไม่มี error ให้เห็น (HANDOFF กับดักข้อ 1)
-- ══════════════════════════════════════════════════════════════════════

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workforce_lookup') THEN
    CREATE ROLE workforce_lookup NOLOGIN NOBYPASSRLS;
  END IF;
END
$do$;

-- ถ้า role ถูกสร้างไว้ตั้งแต่เวอร์ชันเก่าที่ยังใช้ BYPASSRLS ให้ถอดออก
-- (ถ้าฐานข้อมูลไม่ยอมให้แก้ attribute นี้ ก็ไม่เป็นไร — policy ด้านล่างครอบคลุมอยู่แล้ว)
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workforce_lookup' AND rolbypassrls) THEN
    BEGIN
      ALTER ROLE workforce_lookup NOBYPASSRLS;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'ถอด BYPASSRLS ออกจาก workforce_lookup ไม่ได้ (ไม่ใช่ superuser) — ข้ามไป';
    END;
  END IF;
END
$do$;

-- ต้องเป็นสมาชิกของ role ปลายทางก่อน ถึงจะ ALTER FUNCTION ... OWNER TO ได้
-- เครื่องที่ตั้งค่าไว้แล้วอาจไม่มีสิทธิ์ GRANT (ไม่มี CREATEROLE) — ข้ามได้
-- เพราะ ALTER OWNER ด้านล่างจะถูกข้ามไปด้วยถ้าเจ้าของถูกอยู่แล้ว
DO $do$
BEGIN
  IF NOT pg_has_role(CURRENT_USER, 'workforce_lookup', 'USAGE') THEN
    EXECUTE format('GRANT workforce_lookup TO %I', CURRENT_USER);
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'เพิ่ม % เข้า workforce_lookup ไม่ได้ — ถ้าเจ้าของฟังก์ชันถูกอยู่แล้วไม่มีปัญหา', CURRENT_USER;
END
$do$;

GRANT USAGE ON SCHEMA workforce TO workforce_lookup;

-- อ่านได้เฉพาะ 3 ตารางที่ฟังก์ชันเหล่านี้ต้องใช้ ไม่ให้ทั้ง schema
GRANT SELECT ON workforce.device_activation_tokens TO workforce_lookup;
GRANT SELECT ON workforce.devices                  TO workforce_lookup;
GRANT SELECT ON workforce.device_credentials       TO workforce_lookup;

-- ── policy ข้าม tenant: เฉพาะ role นี้ · เฉพาะ SELECT · เฉพาะ 3 ตาราง ──
-- policy แบบ permissive จะถูก OR รวมกับ *_isolation ที่มีอยู่เดิม
-- ตัว *_isolation ไม่ได้ระบุ TO จึงมีผลกับทุก role ⇒ role อื่นยังถูกคุมเหมือนเดิม
DROP POLICY IF EXISTS device_activation_tokens_lookup ON workforce.device_activation_tokens;
CREATE POLICY device_activation_tokens_lookup ON workforce.device_activation_tokens
  FOR SELECT TO workforce_lookup USING (true);

DROP POLICY IF EXISTS devices_lookup ON workforce.devices;
CREATE POLICY devices_lookup ON workforce.devices
  FOR SELECT TO workforce_lookup USING (true);

DROP POLICY IF EXISTS device_credentials_lookup ON workforce.device_credentials;
CREATE POLICY device_credentials_lookup ON workforce.device_credentials
  FOR SELECT TO workforce_lookup USING (true);

-- ย้ายเจ้าของเฉพาะตัวที่ยังไม่ถูก — ทำให้รันซ้ำได้บนเครื่องที่ตั้งค่าไว้แล้ว
DO $do$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'workforce.lookup_activation_token(bytea)',
    'workforce.lookup_device_credential(uuid)',
    'workforce.lookup_legacy_device(text)'
  ] LOOP
    IF (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = fn::regprocedure)
       IS DISTINCT FROM 'workforce_lookup' THEN
      EXECUTE format('ALTER FUNCTION %s OWNER TO workforce_lookup', fn);
    END IF;
  END LOOP;
END
$do$;

-- แอปยังต้องเรียกได้เหมือนเดิม
GRANT EXECUTE ON FUNCTION workforce.lookup_activation_token(bytea) TO workforce_app;
GRANT EXECUTE ON FUNCTION workforce.lookup_device_credential(uuid) TO workforce_app;
GRANT EXECUTE ON FUNCTION workforce.lookup_legacy_device(text)     TO workforce_app;

SELECT p.proname,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef                 AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'workforce'
  AND p.proname IN ('lookup_activation_token', 'lookup_device_credential', 'lookup_legacy_device')
ORDER BY p.proname;
