-- Discord Report Sync (ชั่วคราว) — 3 ตารางใน schema report_task
-- ถอดออกได้เมื่อเลิกใช้: DROP TABLE ทั้ง 3 + DROP FUNCTION report_working_days

-- discord_links: ผูก Discord user -> พนักงาน
CREATE TABLE "report_task"."discord_links" (
    "org_id" TEXT NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "discord_links_pkey" PRIMARY KEY ("org_id","discord_user_id")
);
CREATE INDEX "discord_links_org_id_employee_id_idx"
    ON "report_task"."discord_links"("org_id","employee_id");

-- discord_channels: ผูกห้อง Discord -> topic + กฎรอบ (กรอกเองในหน้าตั้งค่า)
CREATE TABLE "report_task"."discord_channels" (
    "org_id" TEXT NOT NULL,
    "discord_channel_id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "rounds" JSONB NOT NULL DEFAULT '[]',
    "min_images" INTEGER NOT NULL DEFAULT 0,
    "required_weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "use_roster" BOOLEAN NOT NULL DEFAULT true,
    "keyword_only" BOOLEAN NOT NULL DEFAULT false,
    "keyword" TEXT NOT NULL DEFAULT 'daily',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "discord_channels_pkey" PRIMARY KEY ("org_id","discord_channel_id")
);

-- report_submissions: การส่งดิบ ต่อคน/วัน/รอบ
CREATE TABLE "report_task"."report_submissions" (
    "org_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "employee_id" TEXT,
    "discord_user_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "round_id" TEXT NOT NULL,
    "report_date" DATE NOT NULL,
    "posted_at" TIMESTAMP(3),
    "message_id" TEXT NOT NULL,
    "image_count" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL DEFAULT '',
    "status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "report_submissions_pkey" PRIMARY KEY ("org_id","id")
);
CREATE UNIQUE INDEX "report_submissions_org_id_message_id_key"
    ON "report_task"."report_submissions"("org_id","message_id");
CREATE INDEX "report_submissions_org_id_topic_id_report_date_idx"
    ON "report_task"."report_submissions"("org_id","topic_id","report_date");
CREATE INDEX "report_submissions_org_id_employee_id_report_date_idx"
    ON "report_task"."report_submissions"("org_id","employee_id","report_date");

-- FK -> core.organizations
ALTER TABLE "report_task"."discord_links"
    ADD CONSTRAINT "discord_links_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_task"."discord_channels"
    ADD CONSTRAINT "discord_channels_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_task"."report_submissions"
    ADD CONSTRAINT "report_submissions_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
