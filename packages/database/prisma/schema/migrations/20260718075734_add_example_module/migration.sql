-- CreateTable
CREATE TABLE "core"."example_items" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "example_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "example_items_org_id_idx" ON "core"."example_items"("org_id");
