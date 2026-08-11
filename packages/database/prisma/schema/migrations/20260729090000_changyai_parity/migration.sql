-- ChangYai parity: คืนของ/ของมีปัญหา + ผู้ทำ/เวลาแต่ละสเต็ปของ PR→PO
-- (พอร์ตจาก migration 058 / 059 / 060 ของ ChangYai)

ALTER TABLE "maintenance"."purchase_orders"
  ADD COLUMN IF NOT EXISTS "po_created_by" TEXT,
  ADD COLUMN IF NOT EXISTS "po_created_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ordered_by"    TEXT,
  ADD COLUMN IF NOT EXISTS "ordered_at"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "received_by"   TEXT,
  ADD COLUMN IF NOT EXISTS "received_at"   TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "maintenance"."equipment_returns" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "property_id" TEXT,
    "item_name" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "problem_type" TEXT NOT NULL DEFAULT 'other',
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "image_urls" TEXT[],
    "resolution_note" TEXT,
    "created_by" TEXT,
    "resolved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "equipment_returns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "equipment_returns_org_id_idx"
  ON "maintenance"."equipment_returns"("org_id");
CREATE INDEX IF NOT EXISTS "equipment_returns_purchase_order_id_idx"
  ON "maintenance"."equipment_returns"("purchase_order_id");
CREATE INDEX IF NOT EXISTS "equipment_returns_status_idx"
  ON "maintenance"."equipment_returns"("status");

DO $$ BEGIN
  ALTER TABLE "maintenance"."equipment_returns"
    ADD CONSTRAINT "equipment_returns_purchase_order_id_fkey"
    FOREIGN KEY ("purchase_order_id")
    REFERENCES "maintenance"."purchase_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
