-- บันทึกการใช้งานโมดูลแจ้งซ่อมบำรุง (เมนู "Log การใช้งาน" — เห็นเฉพาะ Super admin / CEO)
-- ตารางใหม่ล้วน ไม่แตะตารางเดิม · เขียนจาก server action ทุกตัวของโมดูล (ใครทำอะไร กับอะไร เมื่อไหร่)
CREATE TABLE IF NOT EXISTS "maintenance"."activity_logs" (
  "id"          TEXT NOT NULL,
  "org_id"      TEXT NOT NULL,
  "user_id"     TEXT,
  "actor_label" TEXT,
  "entity"      TEXT NOT NULL,
  "entity_id"   TEXT,
  "entity_code" TEXT,
  "action"      TEXT NOT NULL,
  "summary"     TEXT NOT NULL,
  "detail"      JSONB,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "activity_logs_org_id_created_at_idx" ON "maintenance"."activity_logs" ("org_id", "created_at");
CREATE INDEX IF NOT EXISTS "activity_logs_org_id_entity_entity_id_idx" ON "maintenance"."activity_logs" ("org_id", "entity", "entity_id");
