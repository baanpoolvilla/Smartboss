-- สิทธิ์ใหม่ "อนุมัติใบลา/วันหยุด" (ผู้ใช้ 8/11/2569 "ทำไม IT กดอนุมัติได้และเห็นแจ้งเตือน ต้อง HR/CEO")
-- เดิมใครได้บทบาทอนุมัติลาในระบบบุคคล (แปลงจาก ตั้งค่าบุคคล / จัดการพนักงาน / จัดการคนงานรายวัน / หัวหน้างาน)
-- ก็อนุมัติใบลาและได้แจ้งเตือนได้หมด — ตอนนี้ปุ่มอนุมัติและแจ้งเตือนต้องมีสิทธิ์นี้ด้วย
-- เพิ่มอย่างเดียว: ให้ทุกบทบาทที่อนุมัติได้อยู่แล้ว (ไม่มีบริษัทไหนเสียสิทธิ์) · แต่ละบริษัทเอาออกเองที่ หลังบ้าน › บทบาท
-- ไม่ใส่ให้ SUPER_ADMIN ตรง ๆ — ทีมหลังบ้านผ่านสิทธิ์นี้โดยอัตโนมัติอยู่แล้ว (กดได้) แต่ไม่ควรได้แจ้งเตือนใบลาทุกบริษัท (usersWithPermission)
INSERT INTO "core"."permissions" ("id", "code", "module_id")
SELECT gen_random_uuid()::text, 'hr.leave.approve', (SELECT m."id" FROM "core"."modules" m WHERE m."code" = 'hr')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "core"."role_permissions" ("role_id", "permission_id")
SELECT DISTINCT r."id", np."id"
FROM "core"."roles" r
JOIN "core"."permissions" np ON np."code" = 'hr.leave.approve'
WHERE r."code" IN ('MANAGER', 'HR_OFFICER')
   OR EXISTS (
     SELECT 1 FROM "core"."role_permissions" rp
     JOIN "core"."permissions" op ON op."id" = rp."permission_id"
     WHERE rp."role_id" = r."id" AND op."code" IN ('hr.employee.manage', 'hr.setting.manage', 'daily_worker.manage')
   )
ON CONFLICT DO NOTHING;
