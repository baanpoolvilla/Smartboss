-- CreateTable
CREATE TABLE "core"."security_settings" (
    "org_id" TEXT NOT NULL,
    "max_failed_logins" INTEGER NOT NULL DEFAULT 5,
    "lock_minutes" INTEGER NOT NULL DEFAULT 15,
    "password_min_length" INTEGER NOT NULL DEFAULT 12,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "security_settings_pkey" PRIMARY KEY ("org_id")
);

-- AddForeignKey
ALTER TABLE "core"."security_settings" ADD CONSTRAINT "security_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
