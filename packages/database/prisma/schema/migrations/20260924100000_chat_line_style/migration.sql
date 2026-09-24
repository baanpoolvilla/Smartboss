-- แชทแบบ LINE: ตอบกลับ, @แท็ก, อีโมจิ, กันส่งซ้ำ (client_id), กลุ่มแผนก, ประกาศ,
-- ปัก/ปิดเสียงต่อคน, ตารางไฟล์แชท (นับพื้นที่) และ Web Push — เพิ่มอย่างเดียว ไม่แตะข้อมูลเดิม


-- AlterTable
ALTER TABLE "chat"."channels" ADD COLUMN     "announcement_id" TEXT,
ADD COLUMN     "department_id" TEXT;

-- AlterTable
ALTER TABLE "chat"."channel_members" ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'member';

-- AlterTable
ALTER TABLE "chat"."read_states" ADD COLUMN     "muted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "chat"."messages" ADD COLUMN     "client_id" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'text',
ADD COLUMN     "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "reply_to_id" TEXT;

-- CreateTable
CREATE TABLE "chat"."reactions" (
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reactions_pkey" PRIMARY KEY ("message_id","user_id","emoji")
);

-- CreateTable
CREATE TABLE "chat"."files" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."web_push_subscriptions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "files_url_key" ON "chat"."files"("url");

-- CreateIndex
CREATE INDEX "files_org_id_idx" ON "chat"."files"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "web_push_subscriptions_endpoint_key" ON "core"."web_push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "web_push_subscriptions_user_id_idx" ON "core"."web_push_subscriptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "channels_org_id_department_id_key" ON "chat"."channels"("org_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_channel_id_author_id_client_id_key" ON "chat"."messages"("channel_id", "author_id", "client_id");

-- AddForeignKey
ALTER TABLE "chat"."reactions" ADD CONSTRAINT "reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat"."messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
