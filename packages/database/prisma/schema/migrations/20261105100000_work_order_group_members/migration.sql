-- Group work orders: assigned_to is the first person, this column holds the rest. Empty means a single-person order.
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "group_member_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
