-- CreateTable
CREATE TABLE "daily_worker"."audit_events" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by_user_id" TEXT NOT NULL,
    "by_name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "employment_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "work_date" DATE,
    "summary" TEXT NOT NULL,
    "detail" JSONB,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_org_id_at_idx" ON "daily_worker"."audit_events"("org_id", "at");


-- เพิ่มได้อย่างเดียว + แยกตามบริษัท (RLS แบบเดียวกับตารางเงิน)
ALTER TABLE "daily_worker"."audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_worker"."audit_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_events_isolation ON "daily_worker"."audit_events"
  USING ("org_id" = "daily_worker".current_org_id()) WITH CHECK ("org_id" = "daily_worker".current_org_id());
GRANT SELECT, INSERT ON "daily_worker"."audit_events" TO workforce_app;
