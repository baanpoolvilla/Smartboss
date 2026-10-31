-- เลิกใช้บ้าน (ผู้ใช้ 31/10/2569 "ช่างใหญ่ลบบ้านออกไม่ได้ ต้องแจ้ง IT อย่างเดียว")
-- เพิ่มอย่างเดียว: คอลัมน์ใหม่เป็น null = ใช้อยู่ (บ้านเดิมทุกหลังยังใช้อยู่เหมือนเดิม)
ALTER TABLE "maintenance"."properties" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);
ALTER TABLE "maintenance"."properties" ADD COLUMN IF NOT EXISTS "archived_by" TEXT;

-- สิทธิ์ใหม่ "เลิกใช้บ้าน / ใช้บ้านต่อ" — ให้บทบาทที่จัดการบ้านหรือจัดการใบงานได้อยู่แล้ว (หัวหน้างาน ผู้ดูแลบ้าน ฯลฯ)
INSERT INTO "core"."permissions" ("id", "code", "module_id")
SELECT gen_random_uuid()::text, 'maintenance.property.archive', (SELECT m."id" FROM "core"."modules" m WHERE m."code" = 'maintenance')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "core"."role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", np."id"
FROM "core"."role_permissions" rp
JOIN "core"."permissions" op ON op."id" = rp."permission_id"
JOIN "core"."permissions" np ON np."code" = 'maintenance.property.archive'
WHERE op."code" IN ('maintenance.property.manage', 'maintenance.workorder.manage')
ON CONFLICT DO NOTHING;
