-- โมดูล Google Ads Report (google-ads-report-module-spec.md §4) — schema "ads"

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ads";

-- CreateTable
CREATE TABLE "ads"."ads_accounts" (
    "customer_id" VARCHAR(20) NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" VARCHAR(255),
    "currency_code" CHAR(3),
    "time_zone" VARCHAR(64),
    "sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMP(3),

    CONSTRAINT "ads_accounts_pkey" PRIMARY KEY ("customer_id")
);

-- CreateTable
CREATE TABLE "ads"."ads_campaigns" (
    "campaign_id" BIGINT NOT NULL,
    "org_id" TEXT NOT NULL,
    "customer_id" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255),
    "status" VARCHAR(20),
    "channel_type" VARCHAR(40),
    "daily_budget" DECIMAL(14,2),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "ads_campaigns_pkey" PRIMARY KEY ("campaign_id")
);

-- CreateTable
CREATE TABLE "ads"."ads_ad_groups" (
    "ad_group_id" BIGINT NOT NULL,
    "org_id" TEXT NOT NULL,
    "campaign_id" BIGINT NOT NULL,
    "name" VARCHAR(255),
    "status" VARCHAR(20),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "ads_ad_groups_pkey" PRIMARY KEY ("ad_group_id")
);

-- CreateTable
CREATE TABLE "ads"."ads_campaign_daily" (
    "campaign_id" BIGINT NOT NULL,
    "date" DATE NOT NULL,
    "org_id" TEXT NOT NULL,
    "impressions" BIGINT,
    "clicks" BIGINT,
    "cost" DECIMAL(14,2),
    "conversions" DECIMAL(14,4),
    "conversions_value" DECIMAL(14,2),
    "search_impr_share" DECIMAL(6,4),
    "search_budget_lost_is" DECIMAL(6,4),
    "search_rank_lost_is" DECIMAL(6,4),
    "top_impr_pct" DECIMAL(6,4),
    "abs_top_impr_pct" DECIMAL(6,4),

    CONSTRAINT "ads_campaign_daily_pkey" PRIMARY KEY ("campaign_id","date")
);

-- CreateTable
CREATE TABLE "ads"."ads_ad_group_daily" (
    "ad_group_id" BIGINT NOT NULL,
    "date" DATE NOT NULL,
    "org_id" TEXT NOT NULL,
    "impressions" BIGINT,
    "clicks" BIGINT,
    "cost" DECIMAL(14,2),
    "conversions" DECIMAL(14,4),
    "conversions_value" DECIMAL(14,2),
    "top_impr_pct" DECIMAL(6,4),
    "abs_top_impr_pct" DECIMAL(6,4),

    CONSTRAINT "ads_ad_group_daily_pkey" PRIMARY KEY ("ad_group_id","date")
);

-- CreateTable
CREATE TABLE "ads"."ads_keyword_daily" (
    "criterion_id" BIGINT NOT NULL,
    "ad_group_id" BIGINT NOT NULL,
    "date" DATE NOT NULL,
    "org_id" TEXT NOT NULL,
    "keyword_text" VARCHAR(255),
    "match_type" VARCHAR(20),
    "impressions" BIGINT,
    "clicks" BIGINT,
    "cost" DECIMAL(14,2),
    "conversions" DECIMAL(14,4),

    CONSTRAINT "ads_keyword_daily_pkey" PRIMARY KEY ("ad_group_id","criterion_id","date")
);

-- CreateTable
CREATE TABLE "ads"."ads_search_term_daily" (
    "id" BIGSERIAL NOT NULL,
    "org_id" TEXT NOT NULL,
    "ad_group_id" BIGINT NOT NULL,
    "date" DATE NOT NULL,
    "search_term" VARCHAR(500),
    "impressions" BIGINT,
    "clicks" BIGINT,
    "cost" DECIMAL(14,2),
    "conversions" DECIMAL(14,4),

    CONSTRAINT "ads_search_term_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads"."ads_kpi_benchmarks" (
    "id" SERIAL NOT NULL,
    "org_id" TEXT NOT NULL,
    "customer_id" VARCHAR(20),
    "metric" VARCHAR(40) NOT NULL,
    "direction" VARCHAR(20) NOT NULL,
    "poor_threshold" DECIMAL(12,4) NOT NULL,
    "good_threshold" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "ads_kpi_benchmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads"."ads_analysis_settings" (
    "customer_id" VARCHAR(20) NOT NULL,
    "org_id" TEXT NOT NULL,
    "min_clicks_to_judge" INTEGER NOT NULL DEFAULT 50,
    "min_budget_util_to_scale" DECIMAL(5,2) NOT NULL DEFAULT 80,
    "budget_lost_is_limit" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "rank_lost_is_limit" DECIMAL(5,2) NOT NULL DEFAULT 30,
    "wasted_term_min_clicks" INTEGER NOT NULL DEFAULT 10,
    "primary_goal" VARCHAR(10) NOT NULL DEFAULT 'lead',
    "target_cpa" DECIMAL(12,2),
    "avg_lead_value" DECIMAL(12,2),
    "business_context" TEXT,
    "email_recipients" TEXT,

    CONSTRAINT "ads_analysis_settings_pkey" PRIMARY KEY ("customer_id")
);

-- CreateTable
CREATE TABLE "ads"."ads_ai_reports" (
    "id" BIGSERIAL NOT NULL,
    "org_id" TEXT NOT NULL,
    "customer_id" VARCHAR(20) NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "compare_from" DATE,
    "compare_to" DATE,
    "input_json" JSONB,
    "output_json" JSONB,
    "prompt_version" VARCHAR(20),
    "model" VARCHAR(60),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(40),

    CONSTRAINT "ads_ai_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads"."ads_ai_actions" (
    "id" BIGSERIAL NOT NULL,
    "org_id" TEXT NOT NULL,
    "report_id" BIGINT NOT NULL,
    "seq" INTEGER,
    "title" VARCHAR(255),
    "rationale" TEXT,
    "impact" VARCHAR(10),
    "urgency" VARCHAR(20),
    "entity_type" VARCHAR(20),
    "entity_id" BIGINT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "ads_ai_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads"."ads_sync_logs" (
    "id" BIGSERIAL NOT NULL,
    "org_id" TEXT NOT NULL,
    "customer_id" VARCHAR(20),
    "job_type" VARCHAR(10),
    "range_from" DATE,
    "range_to" DATE,
    "rows_upserted" INTEGER,
    "duration_ms" INTEGER,
    "status" VARCHAR(10),
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),

    CONSTRAINT "ads_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ads_accounts_org_id_idx" ON "ads"."ads_accounts"("org_id");

-- CreateIndex
CREATE INDEX "ads_campaigns_org_id_customer_id_idx" ON "ads"."ads_campaigns"("org_id", "customer_id");

-- CreateIndex
CREATE INDEX "ads_ad_groups_org_id_campaign_id_idx" ON "ads"."ads_ad_groups"("org_id", "campaign_id");

-- CreateIndex
CREATE INDEX "ads_campaign_daily_org_id_date_idx" ON "ads"."ads_campaign_daily"("org_id", "date");

-- CreateIndex
CREATE INDEX "ads_ad_group_daily_org_id_date_idx" ON "ads"."ads_ad_group_daily"("org_id", "date");

-- CreateIndex
CREATE INDEX "ads_keyword_daily_org_id_date_idx" ON "ads"."ads_keyword_daily"("org_id", "date");

-- CreateIndex
CREATE INDEX "ads_search_term_daily_org_id_date_idx" ON "ads"."ads_search_term_daily"("org_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ads_search_term_daily_ad_group_id_date_search_term_key" ON "ads"."ads_search_term_daily"("ad_group_id", "date", "search_term");

-- CreateIndex
CREATE INDEX "ads_kpi_benchmarks_org_id_customer_id_idx" ON "ads"."ads_kpi_benchmarks"("org_id", "customer_id");

-- CreateIndex
CREATE INDEX "ads_analysis_settings_org_id_idx" ON "ads"."ads_analysis_settings"("org_id");

-- CreateIndex
CREATE INDEX "ads_ai_reports_org_id_customer_id_created_at_idx" ON "ads"."ads_ai_reports"("org_id", "customer_id", "created_at");

-- CreateIndex
CREATE INDEX "ads_ai_actions_org_id_report_id_idx" ON "ads"."ads_ai_actions"("org_id", "report_id");

-- CreateIndex
CREATE INDEX "ads_sync_logs_org_id_customer_id_started_at_idx" ON "ads"."ads_sync_logs"("org_id", "customer_id", "started_at");

-- AddForeignKey
ALTER TABLE "ads"."ads_ai_actions" ADD CONSTRAINT "ads_ai_actions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "ads"."ads_ai_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

