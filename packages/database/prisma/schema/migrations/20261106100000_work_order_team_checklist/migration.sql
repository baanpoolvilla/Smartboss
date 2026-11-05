-- Edit team after creation, checklists like tasks, and group PM plans. All additive; existing rows keep working unchanged.
-- removed_member_ids: people taken off a work order; their existing overdue docks are kept, not revoked.
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "removed_member_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
-- checklist: [{ id, text, done, ownerId, doneBy, doneAt }] · null = no checklist (closes as before).
ALTER TABLE "maintenance"."work_orders" ADD COLUMN IF NOT EXISTS "checklist" JSONB;
-- PM plans: team + closing rule + checklist template copied onto every round's work order.
ALTER TABLE "maintenance"."pm_schedules" ADD COLUMN IF NOT EXISTS "group_member_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "maintenance"."pm_schedules" ADD COLUMN IF NOT EXISTS "completion_rule" TEXT;
ALTER TABLE "maintenance"."pm_schedules" ADD COLUMN IF NOT EXISTS "checklist" JSONB;
