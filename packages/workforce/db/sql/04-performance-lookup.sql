-- ══════════════════════════════════════════════════════════════════════
--  ทางอ่านผลลงเวลาข้ามบริษัท สำหรับงานสรุปคะแนนผลงาน
--
--  ⚠ ต้องรัน **หลัง** `pnpm wf:migrate`
--
--  ปัญหา: หน้าสรุปผลงานรายคนของผู้บริหารต้องรวมการมาสาย/ขาดงานจาก workforce
--  แต่ตารางฝั่งนั้นเปิด FORCE ROW LEVEL SECURITY ทุกใบ และงานนี้รันจาก cron
--  ซึ่งไม่มี session ของผู้ใช้ จึงตั้ง workforce.tenant_id ไม่ได้
--  ⇒ ถ้าอ่านตรง ๆ จะได้ 0 แถวตลอดไป **โดยไม่มี error ให้เห็น**
--
--  วิธีแก้: ใช้แพตเทิร์นเดียวกับ 02-lookup-functions-owner.sql — ฟังก์ชัน
--  SECURITY DEFINER ที่เจ้าของเป็น workforce_lookup (ไม่ใช่เจ้าของตาราง จึงไม่โดน
--  FORCE) แล้วเปิด policy ให้ role นั้นอ่านข้ามบริษัทได้เฉพาะ 3 ตารางนี้
--
--  ฟังก์ชันคืนเฉพาะสิ่งที่จำเป็นต่อการคิดคะแนน: ใครสายกี่นาที/ขาดกี่นาที วันไหน
--  ไม่คืนชื่อ เงินเดือน หรือรายละเอียดอื่น — ให้สิทธิ์เท่าที่ใช้จริง
-- ══════════════════════════════════════════════════════════════════════

-- role มีอยู่แล้วจาก 02 แต่เผื่อรันไฟล์นี้ก่อน
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workforce_lookup') THEN
    CREATE ROLE workforce_lookup NOLOGIN NOBYPASSRLS;
  END IF;
END
$do$;

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
GRANT SELECT ON workforce.attendance_results TO workforce_lookup;
GRANT SELECT ON workforce.employments        TO workforce_lookup;
GRANT SELECT ON workforce.principals         TO workforce_lookup;

-- policy ข้าม tenant: เฉพาะ role นี้ · เฉพาะ SELECT · เฉพาะ 3 ตาราง
DROP POLICY IF EXISTS attendance_results_lookup ON workforce.attendance_results;
CREATE POLICY attendance_results_lookup ON workforce.attendance_results
  FOR SELECT TO workforce_lookup USING (true);

DROP POLICY IF EXISTS employments_lookup ON workforce.employments;
CREATE POLICY employments_lookup ON workforce.employments
  FOR SELECT TO workforce_lookup USING (true);

DROP POLICY IF EXISTS principals_lookup ON workforce.principals;
CREATE POLICY principals_lookup ON workforce.principals
  FOR SELECT TO workforce_lookup USING (true);

/*
 * คืนวันที่ "สายเกินเกณฑ์" หรือ "ขาดงานเกินเกณฑ์" ของทุกบริษัท
 *
 * subject = core.users.id (ผูกไว้ตอน wf:sync จับคู่ principal กับ person ด้วยอีเมล)
 * ตัดวันลา/วันหยุด/วันหยุดประจำออกแล้ว — ลาที่อนุมัติแล้วไม่ใช่ความผิด
 */
CREATE OR REPLACE FUNCTION workforce.performance_attendance(
  p_from date,
  p_late_threshold integer,
  p_absence_threshold integer
)
RETURNS TABLE (
  subject text,
  work_date date,
  late_minutes integer,
  absence_minutes integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = workforce, pg_temp
AS $$
  SELECT p.subject,
         ar.work_date,
         ar.late_minutes,
         ar.absence_minutes
  FROM workforce.attendance_results ar
  JOIN workforce.employments e ON e.id = ar.employment_id
  JOIN workforce.principals  p ON p.person_id = e.person_id
  WHERE ar.is_current
    AND ar.work_date >= p_from
    AND ar.is_on_leave = false
    AND ar.is_holiday  = false
    AND ar.is_rest_day = false
    AND p.subject IS NOT NULL
    AND (ar.late_minutes > p_late_threshold
         OR ar.absence_minutes > p_absence_threshold);
$$;

-- ย้ายเจ้าของเฉพาะตอนที่ยังไม่ถูก — ทำให้รันซ้ำได้บนเครื่องที่ตั้งค่าไว้แล้ว
DO $do$
BEGIN
  IF (SELECT pg_get_userbyid(p.proowner)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'workforce' AND p.proname = 'performance_attendance')
     IS DISTINCT FROM 'workforce_lookup' THEN
    ALTER FUNCTION workforce.performance_attendance(date, integer, integer)
      OWNER TO workforce_lookup;
  END IF;
END
$do$;

/*
 * ตรวจให้แน่ใจว่าเจ้าของถูกจริง — ถ้าไม่ ต้องล้มดัง ๆ ตรงนี้
 *
 * ถ้าปล่อยผ่าน ฟังก์ชันจะยังเรียกได้แต่ถูก FORCE RLS กรองทิ้ง คืน 0 แถวเสมอ
 * แล้วหน้าสรุปผลงานจะแสดง "ไม่มีการมาสาย/ขาดงาน" ตลอดกาลโดยไม่มีใครรู้ว่าพัง
 * — ความผิดพลาดแบบเงียบที่อันตรายกว่าการล้มตอนติดตั้ง
 */
DO $do$
DECLARE
  owner_name text;
BEGIN
  SELECT pg_get_userbyid(p.proowner) INTO owner_name
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'workforce' AND p.proname = 'performance_attendance';

  IF owner_name IS DISTINCT FROM 'workforce_lookup' THEN
    RAISE EXCEPTION
      'performance_attendance เจ้าของเป็น % ต้องเป็น workforce_lookup — ต้องรันไฟล์นี้ด้วย role ที่มี CREATEROLE (Neon: neondb_owner)',
      owner_name;
  END IF;
END
$do$;

-- ผู้ใช้ของแอปเรียกได้
DO $do$
DECLARE
  app_user text := coalesce(nullif(current_setting('workforce.app_user', true), ''), current_user);
BEGIN
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION workforce.performance_attendance(date, integer, integer) TO %I',
    app_user);
END
$do$;

SELECT p.proname,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef                 AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'workforce' AND p.proname = 'performance_attendance';
