-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "company_files";

-- CreateTable
CREATE TABLE "company_files"."folders" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_files"."files" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "folder_id" TEXT,
    "name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_files"."file_versions" (
    "id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_files"."file_share_links" (
    "id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'view',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "revoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "file_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "folders_org_id_idx" ON "company_files"."folders"("org_id");

-- CreateIndex
CREATE INDEX "folders_org_id_parent_id_idx" ON "company_files"."folders"("org_id", "parent_id");

-- CreateIndex
CREATE INDEX "files_org_id_idx" ON "company_files"."files"("org_id");

-- CreateIndex
CREATE INDEX "files_org_id_folder_id_idx" ON "company_files"."files"("org_id", "folder_id");

-- CreateIndex
CREATE INDEX "file_versions_file_id_idx" ON "company_files"."file_versions"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_versions_file_id_version_number_key" ON "company_files"."file_versions"("file_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "file_share_links_token_key" ON "company_files"."file_share_links"("token");

-- CreateIndex
CREATE INDEX "file_share_links_file_id_idx" ON "company_files"."file_share_links"("file_id");

-- AddForeignKey
ALTER TABLE "company_files"."folders" ADD CONSTRAINT "folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "company_files"."folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_files"."files" ADD CONSTRAINT "files_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "company_files"."folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_files"."file_versions" ADD CONSTRAINT "file_versions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "company_files"."files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_files"."file_share_links" ADD CONSTRAINT "file_share_links_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "company_files"."files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
