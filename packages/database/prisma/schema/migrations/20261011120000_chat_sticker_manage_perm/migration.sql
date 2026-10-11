-- สติกเกอร์บริษัท: เดิมใช้ chat.manage (แอดมินแชท) ตัวเดียวกับสิทธิ์คุมทุกห้อง
-- แยกออกมาเป็น chat.sticker.manage ให้เฉพาะ ADMIN (ฝ่าย IT) / CEO / MARKETING
-- เป็นคนเพิ่ม/จัดการ — บทบาทอื่นยังเลือกใช้สติกเกอร์ได้เหมือนเดิม
-- บริษัทมอบเพิ่มให้บทบาทอื่นเองได้ที่ /admin/roles
INSERT INTO "core"."permissions" ("id", "code", "module_id")
SELECT gen_random_uuid()::text, 'chat.sticker.manage', (SELECT m."id" FROM "core"."modules" m WHERE m."code" = 'chat')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "core"."role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "core"."roles" r
JOIN "core"."permissions" p ON p."code" = 'chat.sticker.manage'
WHERE r."org_id" IS NOT NULL AND r."code" IN ('ADMIN', 'CEO', 'MARKETING')
ON CONFLICT DO NOTHING;
