-- ตามหลังฟีเจอร์ "ถังขยะ + ลิงก์แชร์มีรหัสผ่าน + audit log" (commit 4c15bfb) ที่แก้
-- schema.prisma ไปแล้วแต่ไม่เคยมี migration คู่กันมาก่อน — โค้ดอ่าน/เขียนคอลัมน์พวกนี้
-- มาตลอดตั้งแต่ commit นั้น ทำให้ /company-files พังด้วย P2022 "column does not exist"
-- นี่คือ migration ที่ควรจะมาคู่กับตอนนั้น เพิ่มคอลัมน์/ตารางล้วน ไม่แตะข้อมูลเดิม

-- AlterTable: folders — soft-delete (ถังขยะ)
ALTER TABLE "company_files"."folders" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "company_files"."folders" ADD COLUMN "deleted_by" TEXT;

-- AlterTable: files — soft-delete (ถังขยะ)
ALTER TABLE "company_files"."files" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "company_files"."files" ADD COLUMN "deleted_by" TEXT;

-- CreateIndex
CREATE INDEX "files_org_id_deleted_at_idx" ON "company_files"."files"("org_id", "deleted_at");

-- AlterTable: file_share_links — scope + รหัสผ่านลิงก์
ALTER TABLE "company_files"."file_share_links" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'anyone';
ALTER TABLE "company_files"."file_share_links" ADD COLUMN "password_hash" TEXT;

-- CreateTable: file_activity (audit log)
CREATE TABLE "company_files"."file_activity" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "file_id" TEXT,
    "folder_id" TEXT,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_activity_org_id_idx" ON "company_files"."file_activity"("org_id");

-- CreateIndex
CREATE INDEX "file_activity_file_id_idx" ON "company_files"."file_activity"("file_id");
