-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "report_task";

-- CreateTable
CREATE TABLE "report_task"."stores" (
    "org_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("org_id","key")
);

-- AddForeignKey
ALTER TABLE "report_task"."stores" ADD CONSTRAINT "stores_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
