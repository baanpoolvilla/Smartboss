-- PM แบบนับรอบเป็นค่าพื้นฐาน ไม่ต้องติ๊ก (ผู้ใช้ 4/11/2569) เริ่มนับวันที่ deploy ตามเวลาไทย
-- รอบที่ครบกำหนดก่อนวันนี้ไม่โดนหักคะแนน · บริษัทที่ตั้งวันไว้แล้วคงวันเดิม
INSERT INTO "core"."performance_settings" ("org_id", "updated_at")
SELECT "id", now() FROM "core"."organizations"
ON CONFLICT ("org_id") DO NOTHING;

UPDATE "core"."performance_settings"
SET "pm_rounds_from" = (now() AT TIME ZONE 'Asia/Bangkok')::date
WHERE "pm_rounds_from" IS NULL;

-- คะแนนตามที่ผู้ใช้กำหนด: PM เกินรอบ -1 · ใบงานเกินกำหนด -3 · ขาดงาน -5 มีผลกับการหักครั้งถัดไป ของที่หักไปแล้วคงเดิม
UPDATE "core"."performance_settings"
SET "rule_points" = "rule_points" || '{"pm_missed": -1, "workorder_overdue": -3, "attendance_absent": -5}'::jsonb;
