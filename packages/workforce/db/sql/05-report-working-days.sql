-- ══════════════════════════════════════════════════════════════════════
--  ทางอ่าน "วันทำงานรายคน" ข้ามบริษัท สำหรับ Discord Report Sync
--
--  ⚠ ต้องรัน **หลัง** `pnpm wf:migrate` และหลัง 04-performance-lookup.sql
--
--  ใช้แพตเทิร์นเดียวกับ 04: ฟังก์ชัน SECURITY DEFINER เจ้าของ workforce_lookup
--  (ไม่โดน FORCE RLS) เพื่อให้ตัวตัดสินของ Discord ถามได้ว่า "วันนี้คนนี้ต้อง
--  ทำงานไหม" โดยไม่ต้องมี session ผู้ใช้
--
--  subject = core.users.id · state = WORKING | OFF | LEAVE | HOLIDAY | NO_SHIFT
-- ══════════════════════════════════════════════════════════════════════

-- role + policy มีอยู่แล้วจาก 04 แต่ guard เผื่อรันไฟล์นี้เดี่ยว ๆ
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workforce_lookup') THEN
    CREATE ROLE workforce_lookup NOLOGIN NOBYPASSRLS;
  END IF;
END
$do$;

GRANT USAGE ON SCHEMA workforce TO workforce_lookup;
GRANT SELECT ON workforce.attendance_results TO workforce_lookup;
GRANT SELECT ON workforce.employments        TO workforce_lookup;
GRANT SELECT ON workforce.principals         TO workforce_lookup;

DROP POLICY IF EXISTS attendance_results_lookup ON workforce.attendance_results;
CREATE POLICY attendance_results_lookup ON workforce.attendance_results
  FOR SELECT TO workforce_lookup USING (true);

/*
 * คืน state วันทำงานรายคนรายวัน ของทุกบริษัท ในช่วง [p_from, p_to]
 * อ่านจาก attendance_results (แถว is_current) — แหล่งความจริงเดียวกับที่
 * โมดูล attendance ใช้หักคะแนน จึง "ล้อกัน"
 */
CREATE OR REPLACE FUNCTION workforce.report_working_days(
  p_from date,
  p_to   date
)
RETURNS TABLE (
  subject   text,
  work_date date,
  state     text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = workforce, pg_temp
AS $$
  SELECT p.subject,
         ar.work_date,
         CASE
           WHEN ar.is_on_leave              THEN 'LEAVE'
           WHEN ar.is_holiday               THEN 'HOLIDAY'
           WHEN ar.is_rest_day              THEN 'OFF'
           WHEN ar.scheduled_in_at IS NOT NULL THEN 'WORKING'
           ELSE 'NO_SHIFT'
         END AS state
  FROM workforce.attendance_results ar
  JOIN workforce.employments e ON e.id = ar.employment_id
  JOIN workforce.principals  p ON p.person_id = e.person_id
  WHERE ar.is_current
    AND ar.work_date BETWEEN p_from AND p_to
    AND p.subject IS NOT NULL;
$$;

-- เจ้าของต้องเป็น workforce_lookup ไม่งั้นโดน FORCE RLS กรองทิ้ง คืน 0 แถวเงียบ ๆ
DO $do$
BEGIN
  IF (SELECT pg_get_userbyid(p.proowner)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'workforce' AND p.proname = 'report_working_days')
     IS DISTINCT FROM 'workforce_lookup' THEN
    ALTER FUNCTION workforce.report_working_days(date, date)
      OWNER TO workforce_lookup;
  END IF;
END
$do$;

DO $do$
DECLARE owner_name text;
BEGIN
  SELECT pg_get_userbyid(p.proowner) INTO owner_name
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'workforce' AND p.proname = 'report_working_days';

  IF owner_name IS DISTINCT FROM 'workforce_lookup' THEN
    RAISE EXCEPTION
      'report_working_days เจ้าของเป็น % ต้องเป็น workforce_lookup — รันด้วย role ที่มี CREATEROLE',
      owner_name;
  END IF;
END
$do$;

DO $do$
DECLARE app_user text := coalesce(nullif(current_setting('workforce.app_user', true), ''), current_user);
BEGIN
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION workforce.report_working_days(date, date) TO %I',
    app_user);
END
$do$;
