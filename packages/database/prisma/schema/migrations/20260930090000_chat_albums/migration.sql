-- อัลบั้มแชทแบบ LINE — ตารางใหม่ 2 ตาราง ไม่แตะข้อมูลเดิม

-- CreateTable
CREATE TABLE "chat"."albums" (
    "org_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "albums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat"."album_items" (
    "org_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "album_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumb_url" TEXT,
    "kind" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "source_message_id" TEXT,
    "added_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "album_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "albums_org_id_channel_id_idx" ON "chat"."albums"("org_id", "channel_id");

-- CreateIndex
CREATE INDEX "album_items_org_id_url_idx" ON "chat"."album_items"("org_id", "url");

-- CreateIndex
CREATE INDEX "album_items_org_id_thumb_url_idx" ON "chat"."album_items"("org_id", "thumb_url");

-- CreateIndex
CREATE UNIQUE INDEX "album_items_album_id_url_key" ON "chat"."album_items"("album_id", "url");

-- AddForeignKey
ALTER TABLE "chat"."albums" ADD CONSTRAINT "albums_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "chat"."channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat"."album_items" ADD CONSTRAINT "album_items_album_id_fkey" FOREIGN KEY ("album_id") REFERENCES "chat"."albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;
