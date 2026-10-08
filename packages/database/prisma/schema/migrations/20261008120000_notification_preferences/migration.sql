-- ตั้งค่าแจ้งเตือนรายคน — เพิ่มตารางใหม่อย่างเดียว ไม่แตะข้อมูลเดิม
-- ไม่มีแถว = ค่าเริ่มต้น "เห็นทั้งหมด" (เหมือนก่อนมีตารางนี้ทุกอย่าง)

-- CreateTable
CREATE TABLE "core"."notification_preferences" (
    "user_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'all',
    "overrides" JSONB NOT NULL DEFAULT '{}',
    "since" JSONB NOT NULL DEFAULT '{}',
    "banner_dismissed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "notification_preferences_org_id_idx" ON "core"."notification_preferences"("org_id");
