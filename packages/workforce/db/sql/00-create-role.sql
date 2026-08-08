-- role ที่ workforce ใช้ต่อฐานข้อมูล — ต้อง NOBYPASSRLS ไม่งั้น RLS ไม่มีผล
-- (ดู HANDOFF ข้อ 5.1: RLS หลุดเงียบ ๆ ถ้า connection มีสิทธิ์ข้าม)
--
-- ไฟล์นี้ไม่พึ่ง schema ใด รันเป็นขั้นแรกสุดได้เลย
-- ส่วน 01/02 ต้องรัน **หลัง** `pnpm wf:migrate` — ดูลำดับเต็มที่ docs/deploy.md ข้อ 2
-- ต้องการสิทธิ์ CREATEROLE (Neon: neondb_owner · Supabase: postgres มีให้อยู่แล้ว)
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workforce_app') THEN
    CREATE ROLE workforce_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$do$;

SELECT rolname, rolcanlogin, rolbypassrls, rolsuper
FROM pg_roles
WHERE rolname = 'workforce_app';
