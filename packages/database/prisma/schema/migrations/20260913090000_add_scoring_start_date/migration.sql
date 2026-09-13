-- AlterTable
ALTER TABLE "core"."performance_settings" ADD COLUMN "scoring_start_date" DATE;

-- late_minutes จาก workforce หักผ่อนผันของกะให้แล้ว ค่านี้คือผ่อนผันเพิ่ม ปกติ 0
ALTER TABLE "core"."performance_settings" ALTER COLUMN "late_threshold_minutes" SET DEFAULT 0;
