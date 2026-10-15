-- โมดูลคนงานรายวัน: สิทธิ์ใหม่ 3 อย่าง (อยู่ใต้โมดูล hr ในแคตตาล็อก)
-- ค่าตั้งต้นให้ผู้ดูแลบ้าน (CARETAKER) กับเจ้าหน้าที่บุคคล (HR_OFFICER) เท่านั้น — CEO/ADMIN ติ๊กเพิ่มเองที่ /admin/roles
INSERT INTO "core"."permissions" ("id", "code", "module_id")
SELECT gen_random_uuid()::text, c.code, (SELECT m."id" FROM "core"."modules" m WHERE m."code" = 'hr')
FROM (VALUES ('daily_worker.view'), ('daily_worker.manage'), ('daily_worker.override')) AS c(code)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "core"."role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "core"."roles" r
JOIN "core"."permissions" p ON p."code" IN ('daily_worker.view', 'daily_worker.manage', 'daily_worker.override')
WHERE r."org_id" IS NOT NULL AND r."code" IN ('CARETAKER', 'HR_OFFICER')
ON CONFLICT DO NOTHING;
