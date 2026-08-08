-- CreateTable
CREATE TABLE "core"."performance_settings" (
    "org_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "base_score" INTEGER NOT NULL DEFAULT 100,
    "late_threshold_minutes" INTEGER NOT NULL DEFAULT 15,
    "absence_threshold_minutes" INTEGER NOT NULL DEFAULT 240,
    "pm_grace_days" INTEGER NOT NULL DEFAULT 7,
    "attendance_lookback_days" INTEGER NOT NULL DEFAULT 45,
    "rule_points" JSONB NOT NULL DEFAULT '{}',
    "grade_thresholds" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "performance_settings_pkey" PRIMARY KEY ("org_id")
);

-- AddForeignKey
ALTER TABLE "core"."performance_settings" ADD CONSTRAINT "performance_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
