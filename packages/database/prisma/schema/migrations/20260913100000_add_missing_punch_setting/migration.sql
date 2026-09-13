-- AlterTable
ALTER TABLE "core"."performance_settings" ADD COLUMN "missing_punch_counts_as_absent" BOOLEAN NOT NULL DEFAULT false;
