-- สรุปรายงานให้ Boss เก็บถาวรเป็นแถว (13/11/2569) — เพิ่มตารางใหม่อย่างเดียว ไม่แตะของเดิม
-- ข้อมูลเดิมใน report_task.stores key "boss-brief-results" ระบบคัดลอกมาเองตอนเปิดครั้งแรก (lib/boss-brief/server.ts)
CREATE TABLE IF NOT EXISTS "report_task"."boss_briefs" (
    "org_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "is_range" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "boss_briefs_pkey" PRIMARY KEY ("org_id", "id")
);
CREATE INDEX IF NOT EXISTS "boss_briefs_org_id_topic_id_day_idx" ON "report_task"."boss_briefs"("org_id", "topic_id", "day");
DO $$ BEGIN
  ALTER TABLE "report_task"."boss_briefs" ADD CONSTRAINT "boss_briefs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
