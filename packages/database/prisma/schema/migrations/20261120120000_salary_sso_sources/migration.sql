-- คิดประกันสังคมจาก: ค่าคอม / เบี้ยขยัน ย้ายมาเป็นสวิตช์ในตั้งค่า (คู่กับ ot_sso_base) — ผู้ใช้ 20/11/2569
-- ค่าคอมเดิมอ่านธงจากรายการ "คอมมิชชั่น" (แม้ปิดใช้) → คัดค่าเดิมมา ยอดไม่เปลี่ยนจนกว่าจะแก้เอง
ALTER TABLE "salary"."settings" ADD COLUMN "commission_sso_base" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "salary"."settings" ADD COLUMN "diligence_sso_base" BOOLEAN NOT NULL DEFAULT false;
UPDATE "salary"."settings" s SET "commission_sso_base" = i."sso_base"
  FROM "salary"."items" i
  WHERE i."org_id" = s."org_id" AND i."kind" = 'earning' AND btrim(i."name") = 'คอมมิชชั่น';
