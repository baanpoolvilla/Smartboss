-- Keep (แบบ LINE): คลังของที่เก็บไว้ส่วนตัว + คอลเลกชัน — ตารางใหม่ล้วน ไม่แตะตารางเดิม
-- ห้อง "Keep Memo" ของแต่ละคนใช้ตาราง chat.channels เดิม (id คงที่ keep-<userId>) ไม่ต้องเพิ่มคอลัมน์
CREATE TABLE IF NOT EXISTS "chat"."keep_items" (
  "org_id"            TEXT NOT NULL,
  "id"                TEXT NOT NULL,
  "user_id"           TEXT NOT NULL,
  "kind"              TEXT NOT NULL,
  "body"              TEXT,
  "attachment"        JSONB,
  "size"              INTEGER NOT NULL DEFAULT 0,
  "source_channel_id" TEXT,
  "source_message_id" TEXT,
  "source_author_id"  TEXT,
  "source_label"      TEXT,
  "dedupe_key"        TEXT,
  "collection_ids"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "keep_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "keep_items_org_id_user_id_created_at_idx" ON "chat"."keep_items" ("org_id", "user_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "keep_items_user_id_dedupe_key_key" ON "chat"."keep_items" ("user_id", "dedupe_key");

CREATE TABLE IF NOT EXISTS "chat"."keep_collections" (
  "org_id"     TEXT NOT NULL,
  "id"         TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "keep_collections_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "keep_collections_org_id_user_id_idx" ON "chat"."keep_collections" ("org_id", "user_id");
