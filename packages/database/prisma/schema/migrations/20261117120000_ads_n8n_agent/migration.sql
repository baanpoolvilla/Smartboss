-- Google Ads: ย้าย AI ทั้งหมดไปอยู่บน n8n (ผู้ใช้ 17/11/2569 "ตัดส่วนนี้ออกจากระบบไป ทำงานบน n8n แค่ต้องทำ API รองรับทั้งหมด")
--   - n8n ดึงข้อมูลจาก Google Ads แล้วส่งเข้า Smartboss · Smartboss ไม่ถือ token ของ Google อีกต่อไป
--   - รายงาน/แผนปฏิบัติการของ AI ตัวเดิมทิ้งได้ (ผู้ใช้: "แผนเก่าทั้งหมดที่รอดำเนินงานไม่ต้องสนใจทิ้งได้")
--   - เพิ่ม token ของ n8n · การตั้งค่าการเชื่อมต่อ/นโยบาย · บทสรุปที่ n8n ส่งมา · คำขอปรับที่ต้องอนุมัติ
--   - คนอนุมัติ = สมาชิกกลุ่มแชท "🤖 Ads Agent" ห้องเดียวต่อบริษัท กดได้ครั้งเดียว คนแรกชนะ

DROP TABLE IF EXISTS "ads"."ads_ai_actions";
DROP TABLE IF EXISTS "ads"."ads_ai_reports";

CREATE TABLE "ads"."ads_agent_tokens" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "token_prefix" VARCHAR(20) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "ads_agent_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ads_agent_tokens_token_hash_key" ON "ads"."ads_agent_tokens"("token_hash");
CREATE INDEX "ads_agent_tokens_org_id_idx" ON "ads"."ads_agent_tokens"("org_id");

CREATE TABLE "ads"."ads_agent_settings" (
    "org_id" TEXT NOT NULL,
    "webhook_url" TEXT,
    "webhook_secret" VARCHAR(100),
    "allowed_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "max_budget_change_pct" DECIMAL(6,2) NOT NULL DEFAULT 30,
    "proposal_expiry_hours" INTEGER NOT NULL DEFAULT 72,
    "self_approve" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3),
    "last_seen_info" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ads_agent_settings_pkey" PRIMARY KEY ("org_id")
);

CREATE TABLE "ads"."ads_summaries" (
    "id" BIGSERIAL NOT NULL,
    "org_id" TEXT NOT NULL,
    "customer_id" VARCHAR(20),
    "period_from" DATE,
    "period_to" DATE,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "highlights" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ads_summaries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ads_summaries_org_id_customer_id_created_at_idx" ON "ads"."ads_summaries"("org_id", "customer_id", "created_at");

CREATE TABLE "ads"."ads_change_proposals" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "customer_id" VARCHAR(20) NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "source" VARCHAR(10) NOT NULL DEFAULT 'ai',
    "requested_by" TEXT,
    "campaign_id" VARCHAR(30),
    "campaign_name" VARCHAR(255),
    "ad_group_id" VARCHAR(30),
    "ad_group_name" VARCHAR(255),
    "target_id" VARCHAR(60),
    "target_name" VARCHAR(500),
    "before" JSONB,
    "proposed" JSONB NOT NULL,
    "approved" JSONB,
    "reason" TEXT NOT NULL,
    "evidence" JSONB,
    "risk" VARCHAR(10) NOT NULL DEFAULT 'medium',
    "expected_impact" TEXT,
    "status" VARCHAR(15) NOT NULL DEFAULT 'pending',
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "claimed_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "result" JSONB,
    "error" TEXT,
    "measurement" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ads_change_proposals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ads_change_proposals_org_id_code_key" ON "ads"."ads_change_proposals"("org_id", "code");
CREATE INDEX "ads_change_proposals_org_id_status_created_at_idx" ON "ads"."ads_change_proposals"("org_id", "status", "created_at");

-- คนอนุมัติคำขอปรับ = สมาชิกกลุ่มแชท "🤖 Ads Agent" (chat.channels id adsbot-<org_id>) ไม่ใช่ permission — ไม่มีสิทธิ์ใหม่
