-- ══════════════════════════════════════════════════════════════════════
--  ให้ผู้ใช้แอปสวมบทเป็น workforce_app ได้ผ่าน SET LOCAL ROLE
--  ซึ่งเป็นวิธีที่ withTenant() ใช้บังคับให้ RLS มีผลจริง แม้ connection
--  จะเป็นเจ้าของตาราง (หรือมี BYPASSRLS ติดมาอย่างบน Neon)
--
--  ⚠ ต้องรัน **หลัง** `pnpm wf:migrate` เพราะอ้างถึง schema workforce
--    ที่ migration เป็นคนสร้าง — รันก่อนจะ error ว่าไม่มี schema
--
--  ── ใครคือ "ผู้ใช้แอป" ──
--  ปกติ = CURRENT_USER (คนที่รันไฟล์นี้) ซึ่งถูกต้องบนคลาวด์ เพราะ
--  neondb_owner / postgres เป็นทั้งแอดมินและ user ใน DATABASE_URL
--
--  ถ้า dev แยกกัน (รันไฟล์นี้ด้วย superuser แต่แอปต่อด้วยอีก user)
--  ให้บอกชื่อ user ของแอปผ่าน GUC:
--      PGOPTIONS="-c workforce.app_user=easyboss" psql -U postgres -f 01-...
-- ══════════════════════════════════════════════════════════════════════

DO $do$
DECLARE
  app_user text := coalesce(nullif(current_setting('workforce.app_user', true), ''), current_user);
BEGIN
  EXECUTE format('GRANT workforce_app TO %I', app_user);

  -- workforce_app ต้องอ่าน/เขียนตาราง workforce ได้ (แต่ยังถูก RLS คุมอยู่)
  EXECUTE 'GRANT USAGE ON SCHEMA workforce TO workforce_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA workforce TO workforce_app';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA workforce TO workforce_app';

  -- ตารางที่ migration รุ่นถัดไปสร้าง ให้ได้สิทธิ์เดียวกันอัตโนมัติ
  -- default privileges ผูกกับ "ผู้สร้างตาราง" จึงต้องระบุ FOR ROLE ให้ตรงกับ
  -- user ที่รัน migration ไม่ใช่ user ที่รันไฟล์นี้
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA workforce '
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO workforce_app', app_user);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA workforce '
    'GRANT USAGE, SELECT ON SEQUENCES TO workforce_app', app_user);

  RAISE NOTICE 'workforce_app ผูกกับ user ของแอป: %', app_user;
END
$do$;

SELECT 'granted' AS status,
       coalesce(nullif(current_setting('workforce.app_user', true), ''), current_user) AS app_user;
