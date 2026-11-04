-- สิทธิ์ใหม่ "ลบใบงานที่ยังไม่ปิดและยังไม่เลยกำหนด" (ผู้ใช้ 4/11/2569) — ยังไม่ให้บทบาทไหน ติ๊กเองที่หลังบ้าน › บทบาท
-- แอดมินโมดูลยังลบได้ทุกใบเหมือนเดิม
INSERT INTO "core"."permissions" ("id", "code", "module_id")
SELECT gen_random_uuid()::text, 'maintenance.workorder.delete', (SELECT m."id" FROM "core"."modules" m WHERE m."code" = 'maintenance')
ON CONFLICT ("code") DO NOTHING;
