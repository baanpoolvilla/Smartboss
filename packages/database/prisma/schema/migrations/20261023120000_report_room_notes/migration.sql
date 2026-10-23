-- โน้ตของห้องรายงาน (แบบ Notes ใน Teams) — แก้พร้อมกันได้ (Yjs) · เพิ่มตารางใหม่อย่างเดียว ไม่แตะของเดิม
CREATE TABLE "report_task"."note_sections" (
  "id" UUID NOT NULL,
  "org_id" TEXT NOT NULL,
  "topic_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT 'violet',
  "sort" INTEGER NOT NULL DEFAULT 0,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "note_sections_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "note_sections_org_id_topic_id_idx" ON "report_task"."note_sections"("org_id", "topic_id");

CREATE TABLE "report_task"."note_pages" (
  "id" UUID NOT NULL,
  "org_id" TEXT NOT NULL,
  "topic_id" TEXT NOT NULL,
  "section_id" UUID,
  "title" TEXT NOT NULL,
  "sort" INTEGER NOT NULL DEFAULT 0,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "state" BYTEA NOT NULL,
  "state_update_id" BIGINT NOT NULL DEFAULT 0,
  "state_size" INTEGER NOT NULL DEFAULT 0,
  "search_text" TEXT NOT NULL DEFAULT '',
  "session_editors" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "last_edit_at" TIMESTAMP(3),
  "last_version_at" TIMESTAMP(3),
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" TEXT,
  CONSTRAINT "note_pages_pkey" PRIMARY KEY ("id"),
  -- กันหน้าบวม: เอกสารเกิน 8 MB ไม่ให้บันทึก (แอปตัดที่ 5 MB ก่อนแล้ว นี่คือรั้วสุดท้าย)
  CONSTRAINT "note_pages_state_size_cap" CHECK (octet_length("state") <= 8388608)
);
CREATE INDEX "note_pages_org_id_topic_id_deleted_at_idx" ON "report_task"."note_pages"("org_id", "topic_id", "deleted_at");

CREATE TABLE "report_task"."note_updates" (
  "id" BIGSERIAL NOT NULL,
  "page_id" UUID NOT NULL,
  "org_id" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "by_user_id" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "note_updates_pkey" PRIMARY KEY ("id"),
  -- ชุดแก้เดียวไม่เกิน 2 MB (แอปตัดที่ 1 MB)
  CONSTRAINT "note_updates_data_cap" CHECK (octet_length("data") <= 2097152)
);
CREATE INDEX "note_updates_page_id_id_idx" ON "report_task"."note_updates"("page_id", "id");
ALTER TABLE "report_task"."note_updates" ADD CONSTRAINT "note_updates_page_id_fkey"
  FOREIGN KEY ("page_id") REFERENCES "report_task"."note_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "report_task"."note_versions" (
  "id" UUID NOT NULL,
  "page_id" UUID NOT NULL,
  "org_id" TEXT NOT NULL,
  "state" BYTEA NOT NULL,
  "text" TEXT NOT NULL DEFAULT '',
  "title" TEXT NOT NULL DEFAULT '',
  "editors" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "reason" TEXT NOT NULL DEFAULT 'session',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "note_versions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "note_versions_page_id_created_at_idx" ON "report_task"."note_versions"("page_id", "created_at");
ALTER TABLE "report_task"."note_versions" ADD CONSTRAINT "note_versions_page_id_fkey"
  FOREIGN KEY ("page_id") REFERENCES "report_task"."note_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
