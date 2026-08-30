-- AlterTable
ALTER TABLE "company_files"."folders" ADD COLUMN     "room_id" TEXT;

-- CreateIndex
CREATE INDEX "folders_org_id_room_id_idx" ON "company_files"."folders"("org_id", "room_id");
