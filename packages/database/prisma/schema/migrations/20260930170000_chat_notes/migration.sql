-- โน้ตแชทแบบ LINE — ตารางใหม่ 3 ตาราง ไม่แตะข้อมูลเดิม

-- CreateTable
CREATE TABLE "chat"."notes" (
    "org_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat"."note_comments" (
    "org_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "note_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat"."note_likes" (
    "org_id" TEXT NOT NULL,
    "note_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_likes_pkey" PRIMARY KEY ("note_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notes_message_id_key" ON "chat"."notes"("message_id");

-- CreateIndex
CREATE INDEX "notes_org_id_channel_id_created_at_idx" ON "chat"."notes"("org_id", "channel_id", "created_at");

-- CreateIndex
CREATE INDEX "note_comments_note_id_created_at_idx" ON "chat"."note_comments"("note_id", "created_at");

-- CreateIndex
CREATE INDEX "note_comments_org_id_idx" ON "chat"."note_comments"("org_id");

-- CreateIndex
CREATE INDEX "note_likes_org_id_idx" ON "chat"."note_likes"("org_id");

-- AddForeignKey
ALTER TABLE "chat"."notes" ADD CONSTRAINT "notes_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "chat"."channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat"."note_comments" ADD CONSTRAINT "note_comments_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "chat"."notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat"."note_likes" ADD CONSTRAINT "note_likes_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "chat"."notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
