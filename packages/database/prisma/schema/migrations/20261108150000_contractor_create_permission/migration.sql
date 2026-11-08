-- สิทธิ์ใหม่ "เพิ่ม Contact ใหม่" (ผู้ใช้ 8/11/2569 "ให้ผู้ดูแลบ้านเพิ่ม contact ได้ด้วย")
-- แยกจาก contractor.manage (เพิ่ม/แก้/ลบ) — ให้เพิ่มได้โดยไม่แก้/ลบของคนอื่น
-- เพิ่มอย่างเดียว: ให้บทบาทที่มี contractor.manage อยู่แล้ว (ไม่มีใครเสียหรือได้สิทธิ์ต่างจากเดิม)
-- บทบาทอื่น (เช่น ผู้ดูแลบ้าน) ติ๊กเพิ่มเองที่หลังบ้าน › บทบาท ของแต่ละบริษัท
INSERT INTO "core"."permissions" ("id", "code", "module_id")
SELECT gen_random_uuid()::text, 'maintenance.contractor.create', (SELECT m."id" FROM "core"."modules" m WHERE m."code" = 'maintenance')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "core"."role_permissions" ("role_id", "permission_id")
SELECT rp."role_id", np."id"
FROM "core"."role_permissions" rp
JOIN "core"."permissions" op ON op."id" = rp."permission_id" AND op."code" = 'maintenance.contractor.manage'
JOIN "core"."permissions" np ON np."code" = 'maintenance.contractor.create'
ON CONFLICT DO NOTHING;
