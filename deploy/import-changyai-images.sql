-- ═══════════════════════════════════════════════════════════════════════
--  แก้ URL รูปจาก Supabase Storage → MinIO ของเรา
--
--  รันหลังจาก rclone ก๊อปไฟล์เข้า MinIO แล้ว (ดู docs/changyai_import.md 0.6)
--
--    sudo bash deploy/psql.sh -v org="'<uuid>'" -f deploy/import-changyai-images.sql
--
--  ⚠ รันซ้ำได้ปลอดภัย — แปลงเฉพาะ URL ที่ยังชี้ไป supabase เท่านั้น
-- ═══════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
BEGIN;

-- ตัดหัว URL ของ Supabase ทิ้งแล้วใส่ของเราแทน
--
--   https://xxx.supabase.co/storage/v1/object/public/<bucket>/a/b.jpg
--                                                            └──┬──┘
--   /api/files/maintenance/imported/a/b.jpg  ←────────────────────┘
--
-- regex ตัดถึง /public/<bucket>/ — ครอบทั้งแบบ public และ sign
CREATE OR REPLACE FUNCTION pg_temp.fix_url(u text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN u IS NULL OR u = '' THEN u
    WHEN u NOT LIKE '%supabase%' THEN u          -- แก้ไปแล้วหรือเป็น path ของเราอยู่แล้ว
    ELSE '/api/files/maintenance/imported/' ||
         regexp_replace(u, '^.*/storage/v1/object/(public|sign)/[^/]+/', '')
  END
$$;

CREATE OR REPLACE FUNCTION pg_temp.fix_urls(a text[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(array_agg(pg_temp.fix_url(x)), '{}') FROM unnest(COALESCE(a, '{}')) AS x
$$;

UPDATE maintenance.assets      SET image_url   = pg_temp.fix_url(image_url)    WHERE org_id = :org AND image_url   LIKE '%supabase%';
UPDATE maintenance.expenses    SET receipt_url = pg_temp.fix_url(receipt_url)  WHERE org_id = :org AND receipt_url LIKE '%supabase%';
UPDATE maintenance.work_order_comments SET image_url = pg_temp.fix_url(image_url) WHERE org_id = :org AND image_url LIKE '%supabase%';

UPDATE maintenance.work_orders
   SET photo_urls       = pg_temp.fix_urls(photo_urls),
       after_photo_urls = pg_temp.fix_urls(after_photo_urls)
 WHERE org_id = :org
   AND (array_to_string(photo_urls, ',') LIKE '%supabase%'
     OR array_to_string(after_photo_urls, ',') LIKE '%supabase%');

UPDATE maintenance.purchase_orders
   SET receipt_image_urls = pg_temp.fix_urls(receipt_image_urls),
       pr_image_urls      = pg_temp.fix_urls(pr_image_urls)
 WHERE org_id = :org
   AND (array_to_string(receipt_image_urls, ',') LIKE '%supabase%'
     OR array_to_string(pr_image_urls, ',') LIKE '%supabase%');

UPDATE maintenance.purchase_order_comments
   SET image_urls = pg_temp.fix_urls(image_urls)
 WHERE org_id = :org AND array_to_string(image_urls, ',') LIKE '%supabase%';

UPDATE maintenance.equipment_returns
   SET image_urls = pg_temp.fix_urls(image_urls)
 WHERE org_id = :org AND array_to_string(image_urls, ',') LIKE '%supabase%';

-- รูปจากช่างนอกเก็บเป็น path ล้วนอยู่แล้ว เติมแค่ส่วนหน้า
UPDATE maintenance.work_order_external_photos
   SET storage_path = 'maintenance/imported/' || storage_path
 WHERE org_id = :org AND storage_path <> '' AND storage_path NOT LIKE 'maintenance/%';

\echo ''
\echo '── เหลือ URL ที่ยังชี้ไป Supabase (ต้องได้ 0 ทุกบรรทัด) ──'
SELECT 'assets' AS ตาราง, count(*) FROM maintenance.assets WHERE org_id = :org AND image_url LIKE '%supabase%'
UNION ALL SELECT 'expenses',    count(*) FROM maintenance.expenses    WHERE org_id = :org AND receipt_url LIKE '%supabase%'
UNION ALL SELECT 'work_orders', count(*) FROM maintenance.work_orders WHERE org_id = :org
  AND (array_to_string(photo_urls,',') LIKE '%supabase%' OR array_to_string(after_photo_urls,',') LIKE '%supabase%')
UNION ALL SELECT 'purchase_orders', count(*) FROM maintenance.purchase_orders WHERE org_id = :org
  AND (array_to_string(receipt_image_urls,',') LIKE '%supabase%' OR array_to_string(pr_image_urls,',') LIKE '%supabase%');

COMMIT;

\echo ''
\echo 'เสร็จแล้ว — เปิดเว็บกดดูรูปจริงสักใบก่อน ถึงจะถือว่าย้ายรูปสำเร็จ'
\echo '⚠ อย่าเพิ่งลบโปรเจกต์ Supabase จนกว่าจะเปิดรูปได้'
