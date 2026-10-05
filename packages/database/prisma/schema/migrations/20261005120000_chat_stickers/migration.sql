-- สติกเกอร์ของบริษัท + หมวด (แชท + รายงาน) — schema "chat"

-- CreateTable
CREATE TABLE "chat"."sticker_packs" (
    "org_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sticker_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat"."stickers" (
    "org_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "pack_id" TEXT,
    "name" TEXT NOT NULL,
    "keywords" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stickers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sticker_packs_org_id_sort_order_idx" ON "chat"."sticker_packs"("org_id", "sort_order");

-- CreateIndex
CREATE INDEX "stickers_org_id_pack_id_sort_order_idx" ON "chat"."stickers"("org_id", "pack_id", "sort_order");

-- AddForeignKey
ALTER TABLE "chat"."stickers" ADD CONSTRAINT "stickers_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "chat"."sticker_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
