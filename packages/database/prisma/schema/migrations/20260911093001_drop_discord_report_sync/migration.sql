/*
  Warnings:

  - You are about to drop the `discord_channels` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `discord_links` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `report_submissions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "report_task"."discord_channels" DROP CONSTRAINT "discord_channels_org_id_fkey";

-- DropForeignKey
ALTER TABLE "report_task"."discord_links" DROP CONSTRAINT "discord_links_org_id_fkey";

-- DropForeignKey
ALTER TABLE "report_task"."report_submissions" DROP CONSTRAINT "report_submissions_org_id_fkey";

-- DropTable
DROP TABLE "report_task"."discord_channels";

-- DropTable
DROP TABLE "report_task"."discord_links";

-- DropTable
DROP TABLE "report_task"."report_submissions";
