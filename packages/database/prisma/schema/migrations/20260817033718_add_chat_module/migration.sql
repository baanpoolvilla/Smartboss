-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "chat";

-- CreateTable
CREATE TABLE "chat"."channels" (
    "org_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "created_by_id" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat"."channel_members" (
    "channel_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "muted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "channel_members_pkey" PRIMARY KEY ("channel_id","user_id")
);

-- CreateTable
CREATE TABLE "chat"."read_states" (
    "channel_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "last_read_seq" BIGINT,
    "last_read_at" TIMESTAMP(3),

    CONSTRAINT "read_states_pkey" PRIMARY KEY ("channel_id","user_id")
);

-- CreateTable
CREATE TABLE "chat"."messages" (
    "org_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "channel_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channels_org_id_type_idx" ON "chat"."channels"("org_id", "type");

-- CreateIndex
CREATE INDEX "channel_members_org_id_user_id_idx" ON "chat"."channel_members"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "read_states_org_id_user_id_idx" ON "chat"."read_states"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "messages_channel_id_seq_idx" ON "chat"."messages"("channel_id", "seq");

-- CreateIndex
CREATE INDEX "messages_org_id_idx" ON "chat"."messages"("org_id");

-- AddForeignKey
ALTER TABLE "chat"."channels" ADD CONSTRAINT "channels_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat"."channel_members" ADD CONSTRAINT "channel_members_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "chat"."channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat"."read_states" ADD CONSTRAINT "read_states_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "chat"."channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat"."messages" ADD CONSTRAINT "messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "chat"."channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
