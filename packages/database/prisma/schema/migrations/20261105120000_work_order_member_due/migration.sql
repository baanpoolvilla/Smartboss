-- Per-person due dates on group work orders, same idea as group tasks. Null means everyone uses due_date.
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "member_due_dates" JSONB;
