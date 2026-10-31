-- เงินสดย่อย: แยกสิทธิ์ออกจากสิทธิ์ใบเบิก (ผู้ใช้ 31/10/2569 "อยากให้ติ๊กได้มากกว่า")
-- เพิ่มอย่างเดียว · บทบาทที่เห็น/ทำได้อยู่แล้วได้สิทธิ์ใหม่ตามของเดิม ไม่มีใครเห็นน้อยลงตอนอัปเดต
--   petty_view   ← เดิมเห็นทุกคนผ่าน อนุมัติ / อนุมัติระดับ CEO / บันทึกจ่าย / ดูทุกใบ
--   petty_topup  ← เดิมเติมเงิน/อนุมัติคำขอเติมผ่าน อนุมัติ / อนุมัติระดับ CEO
--   petty_adjust ← เดิมปรับยอด/ยกเลิกรายการคนอื่นผ่าน บันทึกจ่าย
INSERT INTO "core"."permissions" ("id", "code", "module_id")
SELECT gen_random_uuid()::text, c, (SELECT m."id" FROM "core"."modules" m WHERE m."code" = 'hr')
FROM unnest(ARRAY['requests.petty_view', 'requests.petty_topup', 'requests.petty_adjust']) AS c
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "core"."role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", np."id"
FROM "core"."role_permissions" rp
JOIN "core"."permissions" op ON op."id" = rp."permission_id"
JOIN "core"."permissions" np ON
     (np."code" = 'requests.petty_view'   AND op."code" IN ('requests.approve', 'requests.approve_ceo', 'requests.pay', 'requests.view_all'))
  OR (np."code" = 'requests.petty_topup'  AND op."code" IN ('requests.approve', 'requests.approve_ceo'))
  OR (np."code" = 'requests.petty_adjust' AND op."code" = 'requests.pay')
ON CONFLICT DO NOTHING;
