-- % OT คนงาน: true = ตั้งรายคนได้ (แบบเดิม) · false = ทุกคนใช้ % กลาง
ALTER TABLE "daily_worker"."settings" ADD COLUMN IF NOT EXISTS "ot_per_person" BOOLEAN NOT NULL DEFAULT true;
