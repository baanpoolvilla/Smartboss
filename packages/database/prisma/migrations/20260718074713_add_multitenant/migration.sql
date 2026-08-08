-- AlterTable
ALTER TABLE "core"."users" ADD COLUMN     "org_id" TEXT;

-- CreateTable
CREATE TABLE "core"."organizations" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "plan_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."org_modules" (
    "org_id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_modules_pkey" PRIMARY KEY ("org_id","module_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "core"."organizations"("slug");

-- CreateIndex
CREATE INDEX "org_modules_module_id_idx" ON "core"."org_modules"("module_id");

-- CreateIndex
CREATE INDEX "users_org_id_idx" ON "core"."users"("org_id");

-- AddForeignKey
ALTER TABLE "core"."users" ADD CONSTRAINT "users_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."org_modules" ADD CONSTRAINT "org_modules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."org_modules" ADD CONSTRAINT "org_modules_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "core"."modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
