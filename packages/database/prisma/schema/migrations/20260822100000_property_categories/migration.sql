-- หมวดหมู่บ้านที่ "คนเลือกเอง" แทนการเดาจากคำนำหน้าชื่อบ้าน
--
-- ของเดิม: หมวดถูกคำนวณจากชื่อ (BS-M4 → BS-M) ทุกครั้งที่ render
--   ⇒ ย้ายบ้านข้ามหมวดไม่ได้เลยนอกจากเปลี่ยนชื่อบ้าน
--   ⇒ บ้านที่ตั้งชื่อไม่ตามรหัสจะตกไปกอง "อื่นๆ" ตลอดกาล
--   ⇒ สร้างหมวดเปล่า (ยังไม่มีบ้าน) ไม่ได้
--
-- ของใหม่: property_categories เป็นตารางจริง และ properties.category_id ชี้ไปหา

-- ── 1. คอลัมน์ category (text) เดิมเป็นคอลัมน์ตาย ────────────────────────
-- ไม่มีโค้ดไหนเขียนค่าลงไปเลย (ฟอร์มไม่ส่ง · สคริปต์ import ไม่ใส่) และไม่มีใครอ่าน
-- ตรวจก่อนรันได้ด้วย:  SELECT count(category) FROM maintenance.properties;  ← ต้องได้ 0
ALTER TABLE "maintenance"."properties" DROP COLUMN "category";

-- ── 2. หมวดหมู่กลายเป็นของที่สร้างเองได้ ─────────────────────────────────
-- prefix เป็น null ได้ = หมวดที่สร้างเองทีหลังไม่ต้องมีคำนำหน้าปลอม
-- (Postgres ยอมให้ null ซ้ำกันในดัชนี unique จึงสร้างได้ไม่จำกัด)
ALTER TABLE "maintenance"."property_categories" ALTER COLUMN "prefix" DROP NOT NULL;
ALTER TABLE "maintenance"."property_categories" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "property_categories_org_id_idx" ON "maintenance"."property_categories"("org_id");

-- ── 3. ผูกบ้านเข้ากับหมวด ────────────────────────────────────────────────
-- SET NULL ไม่ใช่ CASCADE — ลบหมวดทิ้งต้องไม่ลบบ้านตามไปด้วย
-- บ้านจะกลับไปอยู่กลุ่ม "ยังไม่จัดหมวด" ให้คนมาจัดใหม่
ALTER TABLE "maintenance"."properties" ADD COLUMN "category_id" TEXT;
CREATE INDEX "properties_category_id_idx" ON "maintenance"."properties"("category_id");
ALTER TABLE "maintenance"."properties"
  ADD CONSTRAINT "properties_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "maintenance"."property_categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 4. ย้ายกลุ่มเดิมมาเป็นข้อมูลจริง ─────────────────────────────────────
-- regex ตรงกับ categoryPrefix() ใน data/properties.ts บรรทัดต่อบรรทัด:
--   BS-A1   → BS-A     (คำนำหน้าแบบ ตัวอักษร-ตัวอักษร)
--   PT-BT01 → PT-BT
--   BT10    → BT       (fallback: ตัดตัวเลขท้ายออก)
-- ไม่ทำขั้นนี้ = ทุกบ้านกลายเป็น "ยังไม่จัดหมวด" พร้อมกันในวันที่ deploy
-- แล้วต้องไล่จัดใหม่ทีละหลังด้วยมือ

INSERT INTO "maintenance"."property_categories" (id, org_id, prefix, display_name, sort_order, created_at)
SELECT gen_random_uuid()::text, t.org_id, t.prefix, t.prefix, 0, now()
FROM (
  SELECT DISTINCT
    org_id,
    upper(COALESCE(
      substring(name from '^[A-Za-z]+-[A-Za-z]+'),
      substring(name from '^(.+?)[0-9]+$')
    )) AS prefix
  FROM "maintenance"."properties"
) t
WHERE t.prefix IS NOT NULL
ON CONFLICT (org_id, prefix) DO NOTHING;

-- ชื่อหมวดที่เคยตั้งเองไว้แล้ว (display_name) ไม่ถูกทับ เพราะ DO NOTHING ข้างบน

UPDATE "maintenance"."properties" p
SET category_id = c.id
FROM "maintenance"."property_categories" c
WHERE c.org_id = p.org_id
  AND c.prefix = upper(COALESCE(
        substring(p.name from '^[A-Za-z]+-[A-Za-z]+'),
        substring(p.name from '^(.+?)[0-9]+$')
      ));
