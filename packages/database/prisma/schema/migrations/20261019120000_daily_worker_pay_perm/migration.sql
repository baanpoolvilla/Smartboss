-- คนงานรายวัน: สิทธิ์ใหม่ "ตั้งค่าแรง/% OT" (แยกจากงานหน้างานของผู้ดูแลบ้าน — ผู้ใช้ตกลง 19/10/2569)
-- ค่าตั้งต้น: HR_OFFICER + CEO ได้ตั้งค่าแรง · CEO ได้ดูตาราง/ยอดเงินด้วย · ผู้ดูแลบ้านไม่ได้
INSERT INTO "core"."permissions" ("id", "code", "module_id")
SELECT gen_random_uuid()::text, 'daily_worker.pay', (SELECT m."id" FROM "core"."modules" m WHERE m."code" = 'hr')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "core"."role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "core"."roles" r
JOIN "core"."permissions" p ON p."code" = 'daily_worker.pay'
WHERE r."org_id" IS NOT NULL AND r."code" IN ('HR_OFFICER', 'CEO')
ON CONFLICT DO NOTHING;

INSERT INTO "core"."role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "core"."roles" r
JOIN "core"."permissions" p ON p."code" = 'daily_worker.view'
WHERE r."org_id" IS NOT NULL AND r."code" = 'CEO'
ON CONFLICT DO NOTHING;
