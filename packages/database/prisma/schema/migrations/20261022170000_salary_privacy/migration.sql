-- ข้อมูลเงินเดือนเห็นได้เฉพาะ CEO + คนที่ CEO เลือก (ผู้ใช้กำหนด 22/10/2569)
--   "มีแค่ CEO และหัวหน้า HR เท่านั้นที่สามารถกรอกข้อมูลเงินเดือนได้ ฐานเงินเดือน และอื่นๆ"
--   "เจ้าหน้าที่บุคคลคนอื่น และผู้ดูแลบริษัท (IT) ... ไม่เห็นเลย"
--
-- เดิมสิทธิ์ฐานเงินเดือน/งวดเงินเดือน (hr.salary.* / hr.payroll.*) ติดมากับบทบาท ADMIN / HR_OFFICER / MANAGER
-- ⇒ เจ้าหน้าที่บุคคลทุกคนและ IT เห็นและแก้ฐานเงินเดือนได้ทั้งในหน้าจอและที่ API ของระบบบุคคล
-- ตอนนี้: ถอดออกจากทุกบทบาทยกเว้น CEO · คนที่ CEO เลือก (salary.settings.editor_user_ids) ได้สิทธิ์ฝั่ง
-- ระบบบุคคลตอน sync (apps/web/modules/admin/data/user-guards.ts → salary/lib/access.ts)
--
-- ⚠ หลัง deploy: หัวหน้า HR จะแก้ฐานเงินเดือนไม่ได้จนกว่า CEO จะเพิ่มชื่อที่ เงินเดือน › ตั้งค่า (ตั้งใจ)

DELETE FROM "core"."role_permissions" rp
 USING "core"."permissions" p, "core"."roles" r
 WHERE rp."permission_id" = p."id"
   AND rp."role_id" = r."id"
   AND p."code" IN ('hr.salary.view', 'hr.salary.manage', 'hr.payroll.view', 'hr.payroll.manage', 'hr.payroll.approve')
   AND r."code" <> 'CEO';

-- ฝั่งระบบบุคคล: ถอน role เงินเดือนที่ระบบเคย sync ให้คนที่ไม่ใช่ CEO (การ sync ครั้งถัดไปจะให้คืนเฉพาะคนที่ CEO เลือก)
-- ไม่แตะ role ที่แอดมินระบบบุคคลมอบด้วยมือ (reason อื่น) · ฐานข้อมูลที่ยังไม่มีตารางระบบบุคคล (ติดตั้งใหม่) ข้าม
DO $$
BEGIN
  IF to_regclass('workforce.principal_role_assignments') IS NOT NULL THEN
    DELETE FROM "workforce"."principal_role_assignments" a
     USING "workforce"."roles" wr, "workforce"."principals" pr
     WHERE a."role_id" = wr."id"
       AND a."principal_id" = pr."id"
       AND a."reason" = 'synced from Smartboss'
       AND upper(wr."code") IN ('PAYROLL_PREPARER', 'PAYROLL_APPROVER', 'COMPENSATION_MANAGER', 'FINANCE_OFFICER', 'AUDITOR')
       AND NOT EXISTS (
         SELECT 1 FROM "core"."user_roles" ur
           JOIN "core"."roles" cr ON cr."id" = ur."role_id"
          WHERE ur."user_id" = pr."subject" AND cr."code" = 'CEO'
       );
  END IF;
END
$$;
