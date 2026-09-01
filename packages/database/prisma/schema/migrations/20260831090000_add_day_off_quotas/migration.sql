-- CreateTable
CREATE TABLE "core"."day_off_quota_settings" (
    "org_id" TEXT NOT NULL,
    "default_days_per_month" INTEGER NOT NULL DEFAULT 4,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "day_off_quota_settings_pkey" PRIMARY KEY ("org_id")
);

-- CreateTable
CREATE TABLE "core"."employee_day_off_quotas" (
    "org_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "days_per_month" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "employee_day_off_quotas_pkey" PRIMARY KEY ("org_id","employment_id")
);

-- AddForeignKey
ALTER TABLE "core"."day_off_quota_settings" ADD CONSTRAINT "day_off_quota_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."employee_day_off_quotas" ADD CONSTRAINT "employee_day_off_quotas_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
