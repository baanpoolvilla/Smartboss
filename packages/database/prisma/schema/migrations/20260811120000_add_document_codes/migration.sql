-- เลขที่เอกสารให้คนอ่าน (SM0001 / WO-2569-0001 / PO-2569-0001)
--
-- id ยังเป็น uuid เหมือนเดิม ไม่แตะ — workforce.tenants.id ต้องเท่ากับ
-- core.organizations.id เป๊ะ เพราะการแยกข้อมูลระหว่างบริษัท (RLS) พึ่งกติกานี้
-- คอลัมน์ใหม่นี้มีไว้แสดงผลและให้คนอ้างอิงกันเท่านั้น
--
-- เขียนมือแทนให้ Prisma generate เพราะตารางมีข้อมูลอยู่แล้ว
-- การ ADD COLUMN ... NOT NULL UNIQUE ตรง ๆ จะล้มทันที ต้องเติมค่าก่อนค่อยบังคับ

-- ── ตัวเดินเลข ──────────────────────────────────────────────────────────
CREATE TABLE "core"."document_counters" (
    "org_id"     TEXT    NOT NULL,
    "doc_type"   TEXT    NOT NULL,
    "period"     TEXT    NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "document_counters_pkey" PRIMARY KEY ("org_id","doc_type","period")
);

-- ── 1) รหัสบริษัท SM0001 ────────────────────────────────────────────────
ALTER TABLE "core"."organizations" ADD COLUMN "code" TEXT;

WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS n
  FROM "core"."organizations"
)
UPDATE "core"."organizations" o
SET "code" = 'SM' || lpad(numbered.n::text, 4, '0')
FROM numbered
WHERE o.id = numbered.id;

ALTER TABLE "core"."organizations" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "organizations_code_key" ON "core"."organizations"("code");

INSERT INTO "core"."document_counters" ("org_id","doc_type","period","next_value")
SELECT '', 'ORG', '-', COALESCE(COUNT(*), 0) + 1 FROM "core"."organizations";

-- ── 2) เลขที่ใบงานซ่อม WO-2569-0001 ─────────────────────────────────────
-- เดินเลขแยกตามบริษัทและปี พ.ศ. ของวันที่สร้าง
ALTER TABLE "maintenance"."work_orders" ADD COLUMN "code" TEXT;

WITH numbered AS (
  SELECT id,
         org_id,
         (EXTRACT(YEAR FROM created_at)::int + 543)::text AS be_year,
         row_number() OVER (
           PARTITION BY org_id, EXTRACT(YEAR FROM created_at)
           ORDER BY created_at, id
         ) AS n
  FROM "maintenance"."work_orders"
)
UPDATE "maintenance"."work_orders" w
SET "code" = 'WO-' || numbered.be_year || '-' || lpad(numbered.n::text, 4, '0')
FROM numbered
WHERE w.id = numbered.id;

ALTER TABLE "maintenance"."work_orders" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "work_orders_org_id_code_key"
  ON "maintenance"."work_orders"("org_id","code");

INSERT INTO "core"."document_counters" ("org_id","doc_type","period","next_value")
SELECT org_id,
       'WO',
       (EXTRACT(YEAR FROM created_at)::int + 543)::text,
       COUNT(*) + 1
FROM "maintenance"."work_orders"
GROUP BY org_id, EXTRACT(YEAR FROM created_at)
ON CONFLICT ("org_id","doc_type","period") DO NOTHING;

-- ── 3) เลขที่ใบสั่งซื้อ PO-2569-0001 ────────────────────────────────────
ALTER TABLE "maintenance"."purchase_orders" ADD COLUMN "code" TEXT;

WITH numbered AS (
  SELECT id,
         org_id,
         (EXTRACT(YEAR FROM created_at)::int + 543)::text AS be_year,
         row_number() OVER (
           PARTITION BY org_id, EXTRACT(YEAR FROM created_at)
           ORDER BY created_at, id
         ) AS n
  FROM "maintenance"."purchase_orders"
)
UPDATE "maintenance"."purchase_orders" p
SET "code" = 'PO-' || numbered.be_year || '-' || lpad(numbered.n::text, 4, '0')
FROM numbered
WHERE p.id = numbered.id;

ALTER TABLE "maintenance"."purchase_orders" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "purchase_orders_org_id_code_key"
  ON "maintenance"."purchase_orders"("org_id","code");

INSERT INTO "core"."document_counters" ("org_id","doc_type","period","next_value")
SELECT org_id,
       'PO',
       (EXTRACT(YEAR FROM created_at)::int + 543)::text,
       COUNT(*) + 1
FROM "maintenance"."purchase_orders"
GROUP BY org_id, EXTRACT(YEAR FROM created_at)
ON CONFLICT ("org_id","doc_type","period") DO NOTHING;
