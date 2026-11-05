-- Group work orders follow group tasks: closing rule, and who already finished their part.
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "completion_rule" TEXT;
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "completed_member_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
