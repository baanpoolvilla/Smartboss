-- แก้ backfill ของ core.data.view_all ใน 20260816120000_role_only_department_heads
-- ที่ hardcode grant ให้เฉพาะ role.code IN ('ADMIN', 'CEO') — บริษัทที่ตั้ง role
-- แอดมินไว้คนละ code (เช่น seed รุ่นเก่า หรือ role ที่สร้างเองแล้วเปลี่ยนชื่อ code)
-- จะไม่ได้สิทธิ์นี้แบบเงียบๆ หลัง migration นั้น แล้วเสีย scope มองเห็นข้อมูล
-- ข้ามแผนกไปโดยไม่มีใครรู้ตัว
--
-- ใช้เกณฑ์ทั่วไปกว่าแทนการเดา code: role ไหนก็ตามที่ถือสิทธิ์จัดการผู้ใช้
-- (core.user.manage) หรือจัดการบทบาท (core.role.manage) อยู่แล้ว ถือว่าเป็น
-- role ระดับแอดมินของบริษัทนั้น สมควรได้ core.data.view_all ไปด้วย — ครอบคลุม
-- ADMIN/CEO เดิมอยู่แล้ว (ทั้งสอง role ถือสิทธิ์นี้อยู่แล้วตาม defaults.ts)
-- และไม่พลาด role แอดมินที่ตั้ง code เองนอกเหนือจากสองตัวนั้น

INSERT INTO "core"."role_permissions" ("role_id", "permission_id")
SELECT DISTINCT admin_role."role_id", view_all."id"
FROM (
  SELECT rp."role_id"
  FROM "core"."role_permissions" rp
  JOIN "core"."permissions" p ON p."id" = rp."permission_id"
  WHERE p."code" IN ('core.user.manage', 'core.role.manage')
) admin_role
CROSS JOIN (
  SELECT "id" FROM "core"."permissions" WHERE "code" = 'core.data.view_all'
) view_all
ON CONFLICT DO NOTHING;
