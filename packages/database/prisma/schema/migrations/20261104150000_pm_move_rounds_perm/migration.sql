-- Temporary tick: lets a user change a PM plan date and move its open orders. No role has it by default.
INSERT INTO "core"."permissions" ("id", "code", "module_id")
SELECT gen_random_uuid()::text, 'maintenance.pm.move_rounds', (SELECT m."id" FROM "core"."modules" m WHERE m."code" = 'maintenance')
ON CONFLICT ("code") DO NOTHING;
