-- ═══════════════════════════════════════════════════════════════════════
--  ย้ายข้อมูลโมดูลซ่อมบำรุงจาก Supabase (ChangYai) เข้า Smartboss
--
--  ใช้หลังจากโหลด dump ของ Supabase เข้ามาไว้ใน schema `changyai_raw` แล้ว
--  วิธีดึง dump ออกจาก Supabase อยู่ใน docs/changyai_import.md
--
--  วิธีรัน (บนเซิร์ฟเวอร์):
--    sudo bash /opt/smartboss/deploy/psql.sh \
--      -v org="'<uuid ของบริษัทปลายทาง>'" -v yr="'2568'" \
--      -f /opt/smartboss/deploy/import-changyai.sql
--
--  ⚠ ทั้งไฟล์อยู่ใน transaction เดียว — พังตรงไหนก็ย้อนกลับหมด ไม่มีข้อมูลค้างครึ่ง ๆ
--  ⚠ สำรองฐานข้อมูลก่อนเสมอ: sudo bash /opt/smartboss/deploy/backup.sh
-- ═══════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
BEGIN;

-- ── ด่านตรวจก่อนแตะข้อมูล ────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM core.organizations WHERE id = :org) THEN
    RAISE EXCEPTION 'ไม่พบบริษัทปลายทาง % — ตรวจ core.organizations ก่อน', :org;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'changyai_raw') THEN
    RAISE EXCEPTION 'ยังไม่ได้โหลด dump เข้า schema changyai_raw';
  END IF;
END $$;

-- ═══ 1. ผู้ใช้ ═══════════════════════════════════════════════════════
--
-- ต้องมาก่อนทุกตาราง เพราะ assigned_to / created_by ชี้มาที่นี่
--
-- ⚠ รหัสผ่านย้ายมาไม่ได้ (Supabase Auth คนละวิธีเข้ารหัส) ⇒ ใส่ hash ที่
--   ไม่มีทางตรงกับรหัสไหนเลย แล้วให้แอดมินกด "ตั้งรหัสผ่านใหม่" ให้ทีละคน
--   ปลอดภัยกว่าตั้งรหัสกลางเหมือนกันทุกคนซึ่งกลายเป็นช่องโหว่ทันที
INSERT INTO core.users (id, org_id, email, name, password_hash, line_user_id, is_active, created_at, updated_at)
SELECT
  u.id::text,
  :org,
  lower(btrim(u.email)),
  COALESCE(NULLIF(btrim(u.name), ''), split_part(u.email, '@', 1)),
  '$argon2id$v=19$m=1,t=1,p=1$aW1wb3J0ZWQ$aW1wb3J0ZWQtbm8tbG9naW4',  -- ล็อกอินไม่ได้จนกว่าจะตั้งรหัสใหม่
  u.line_user_id,
  TRUE,
  COALESCE(u.created_at, now()),
  now()
FROM changyai_raw.users u
WHERE u.email IS NOT NULL AND btrim(u.email) <> ''
ON CONFLICT (email) DO NOTHING;   -- อีเมลซ้ำกับผู้ใช้เดิมในระบบ = ข้าม ไม่ทับของเดิม

-- ═══ 2. หมวดหมู่บ้าน ═════════════════════════════════════════════════
INSERT INTO maintenance.property_categories (id, org_id, prefix, display_name, created_at)
SELECT gen_random_uuid()::text, :org, c.prefix, c.display_name, COALESCE(c.created_at, now())
FROM changyai_raw.property_categories c
ON CONFLICT DO NOTHING;

-- ═══ 3. บ้าน / ทรัพย์สิน ═════════════════════════════════════════════
INSERT INTO maintenance.properties
  (id, org_id, name, address, owner_name, owner_contact, notes, caretaker_id, created_at)
SELECT p.id::text, :org, p.name, p.address, p.owner_name, p.owner_contact, p.notes,
       p.caretaker_id::text, COALESCE(p.created_at, now())
FROM changyai_raw.properties p;

-- ═══ 4. อุปกรณ์ ══════════════════════════════════════════════════════
INSERT INTO maintenance.assets
  (id, org_id, property_id, name, category, brand, model, install_date, warranty_expiry, notes, image_url, created_at)
SELECT a.id::text, :org, a.property_id::text, a.name, a.category, a.brand, a.model,
       a.install_date, a.warranty_expiry, a.notes, a.image_url, COALESCE(a.created_at, now())
FROM changyai_raw.assets a;

-- ═══ 5. ผู้รับเหมา ═══════════════════════════════════════════════════
INSERT INTO maintenance.contractors
  (id, org_id, name, phone, specialty, company, zone, rating, is_active, notes, created_at)
SELECT c.id::text, :org, c.name, c.phone, c.specialty, c.company, c.zone,
       c.rating, COALESCE(c.is_active, TRUE), c.notes, COALESCE(c.created_at, now())
FROM changyai_raw.contractors c;

-- ═══ 6. แผนบำรุงรักษา ════════════════════════════════════════════════
INSERT INTO maintenance.pm_schedules
  (id, org_id, property_id, asset_id, title, description, frequency, next_due_date, anchor_date,
   rounds_per_year, total_rounds, rounds_done, awaiting_schedule, last_completed_date,
   is_active, assigned_to, cc_user_ids, requires_expense, created_by, created_at)
SELECT s.id::text, :org, s.property_id::text, s.asset_id::text, s.title, s.description,
       s.frequency, s.next_due_date, s.anchor_date,
       s.rounds_per_year, s.total_rounds, COALESCE(s.rounds_done, 0),
       COALESCE(s.awaiting_schedule, FALSE), s.last_completed_date,
       COALESCE(s.is_active, TRUE), s.assigned_to::text,
       COALESCE(s.cc_user_ids::text[], '{}'), COALESCE(s.requires_expense, TRUE),
       s.created_by::text, COALESCE(s.created_at, now())
FROM changyai_raw.pm_schedules s;

-- ═══ 7. ใบงาน ════════════════════════════════════════════════════════
--
-- ⚠ code เป็น NOT NULL + UNIQUE(org_id, code) แต่ ChangYai ไม่มีเลขที่เอกสาร
--   ⇒ เดินเลขตามลำดับเวลาที่สร้าง ให้เลขเรียงตรงกับความเป็นจริง
INSERT INTO maintenance.work_orders
  (id, org_id, code, property_id, asset_id, assigned_to, created_by, title, description,
   status, priority, due_date, completed_at, completion_notes, photo_urls, after_photo_urls,
   cc_user_ids, additional_property_ids, pm_schedule_id, pm_schedule_ids,
   auto_created, requires_expense, created_at)
SELECT w.id::text, :org,
       'WO-' || :yr || '-' || lpad(row_number() OVER (ORDER BY w.created_at, w.id)::text, 4, '0'),
       w.property_id::text, w.asset_id::text, w.assigned_to::text, w.created_by::text,
       w.title, w.description, w.status, COALESCE(w.priority, 'medium'),
       w.due_date, w.completed_at, w.completion_notes,
       COALESCE(w.photo_urls::text[], '{}'), COALESCE(w.after_photo_urls::text[], '{}'),
       COALESCE(w.cc_user_ids::text[], '{}'), COALESCE(w.additional_property_ids::text[], '{}'),
       w.pm_schedule_id::text, COALESCE(w.pm_schedule_ids::text[], '{}'),
       COALESCE(w.auto_created, FALSE), COALESCE(w.requires_expense, TRUE),
       COALESCE(w.created_at, now())
FROM changyai_raw.work_orders w;

-- ═══ 8. คอมเมนต์ใบงาน ════════════════════════════════════════════════
INSERT INTO maintenance.work_order_comments
  (id, org_id, work_order_id, user_id, content, image_urls, created_at)
SELECT c.id::text, :org, c.work_order_id::text, c.user_id::text,
       COALESCE(c.content, ''), COALESCE(c.image_urls::text[], '{}'),
       COALESCE(c.created_at, now())
FROM changyai_raw.work_order_comments c;

-- ═══ 9. ใบสั่งซื้อ ═══════════════════════════════════════════════════
INSERT INTO maintenance.purchase_orders
  (id, org_id, code, property_id, created_by, po_assigned_to, title, status, items,
   total_price, receipt_image_urls, pr_image_urls, is_self_purchase, is_emergency_purchase,
   emergency_reason, po_created_by, po_created_at, ordered_by, ordered_at,
   received_by, received_at, created_at)
SELECT o.id::text, :org,
       'PO-' || :yr || '-' || lpad(row_number() OVER (ORDER BY o.created_at, o.id)::text, 4, '0'),
       o.property_id::text, o.created_by::text, o.po_assigned_to::text,
       o.title, o.status, COALESCE(o.items, '[]'::jsonb), COALESCE(o.total_price, 0),
       COALESCE(o.receipt_image_urls::text[], '{}'), COALESCE(o.pr_image_urls::text[], '{}'),
       COALESCE(o.is_self_purchase, FALSE), COALESCE(o.is_emergency_purchase, FALSE),
       o.emergency_reason, o.po_created_by::text, o.po_created_at,
       o.ordered_by::text, o.ordered_at, o.received_by::text, o.received_at,
       COALESCE(o.created_at, now())
FROM changyai_raw.purchase_orders o;

-- ═══ 10. คอมเมนต์ใบสั่งซื้อ ══════════════════════════════════════════
--
-- ต้นทางเก็บรูปเดี่ยว (image_url) ของเราเก็บเป็นอาเรย์ ⇒ ห่อเป็นอาเรย์ 1 ช่อง
INSERT INTO maintenance.purchase_order_comments
  (id, org_id, purchase_order_id, user_id, content, image_urls, created_at)
SELECT c.id::text, :org, c.purchase_order_id::text, c.user_id::text,
       COALESCE(c.content, ''),
       CASE WHEN c.image_url IS NULL OR c.image_url = '' THEN '{}'::text[]
            ELSE ARRAY[c.image_url] END,
       COALESCE(c.created_at, now())
FROM changyai_raw.purchase_order_comments c;

-- ═══ 11. คืนของ ══════════════════════════════════════════════════════
INSERT INTO maintenance.equipment_returns
  (id, org_id, purchase_order_id, property_id, reported_by, item_name, quantity, reason,
   status, image_urls, resolution_notes, resolved_by, resolved_at, created_at)
SELECT r.id::text, :org, r.purchase_order_id::text, r.property_id::text, r.reported_by::text,
       r.item_name, COALESCE(r.quantity, 1), r.reason, COALESCE(r.status, 'pending'),
       COALESCE(r.image_urls::text[], '{}'), r.resolution_notes,
       r.resolved_by::text, r.resolved_at, COALESCE(r.created_at, now())
FROM changyai_raw.equipment_returns r;

-- ═══ 12. ค่าใช้จ่าย ══════════════════════════════════════════════════
--
-- ท้ายสุด เพราะชี้ไปเกือบทุกตารางข้างบน
INSERT INTO maintenance.expenses
  (id, org_id, work_order_id, pm_schedule_id, purchase_order_id, property_id, created_by,
   title, amount, category, receipt_url, billable_to_partner, cost_type, paid_by,
   is_no_expense, expense_date, created_at)
SELECT e.id::text, :org, e.work_order_id::text, e.pm_schedule_id::text,
       e.purchase_order_id::text, e.property_id::text, e.created_by::text,
       e.title, COALESCE(e.amount, 0), e.category, e.receipt_url,
       COALESCE(e.billable_to_partner, FALSE), e.cost_type, e.paid_by,
       COALESCE(e.is_no_expense, FALSE), e.expense_date, COALESCE(e.created_at, now())
FROM changyai_raw.expenses e;

-- ═══ 13. ประวัติผู้รับเหมา ═══════════════════════════════════════════
INSERT INTO maintenance.contractor_history
  (id, org_id, contractor_id, work_order_id, property_id, description, amount, rating, work_date, created_at)
SELECT h.id::text, :org, h.contractor_id::text, h.work_order_id::text, h.property_id::text,
       h.description, COALESCE(h.amount, 0), h.rating, h.work_date, COALESCE(h.created_at, now())
FROM changyai_raw.contractor_history h;

-- ═══ 14. ⚠ ตั้งตัวเดินเลขต่อ — ลืมข้อนี้แล้วพังวันรุ่งขึ้น ═══════════
--
-- core.document_counters ไม่รู้ว่าเพิ่ง insert ใบงานไปกี่ร้อยใบ มันยังคิดว่า
-- เลขถัดไปคือ 1 ⇒ ใบงานใบแรกที่คนสร้างหลัง import จะได้เลขซ้ำแล้ว insert ไม่ผ่าน
--
-- ไม่พังตอน import แต่ไปพังตอนใช้งานจริง ซึ่งหาสาเหตุยากกว่ามาก
INSERT INTO core.document_counters (org_id, doc_type, period, next_value)
SELECT :org, 'WO', :yr, COUNT(*) + 1 FROM maintenance.work_orders WHERE org_id = :org
ON CONFLICT (org_id, doc_type, period) DO UPDATE SET next_value = EXCLUDED.next_value;

INSERT INTO core.document_counters (org_id, doc_type, period, next_value)
SELECT :org, 'PO', :yr, COUNT(*) + 1 FROM maintenance.purchase_orders WHERE org_id = :org
ON CONFLICT (org_id, doc_type, period) DO UPDATE SET next_value = EXCLUDED.next_value;

-- ═══ สรุปผล ══════════════════════════════════════════════════════════
\echo ''
\echo '── จำนวนแถวที่เข้ามา ──'
SELECT 'properties' AS ตาราง, COUNT(*) FROM maintenance.properties WHERE org_id = :org
UNION ALL SELECT 'assets',           COUNT(*) FROM maintenance.assets            WHERE org_id = :org
UNION ALL SELECT 'pm_schedules',     COUNT(*) FROM maintenance.pm_schedules      WHERE org_id = :org
UNION ALL SELECT 'work_orders',      COUNT(*) FROM maintenance.work_orders       WHERE org_id = :org
UNION ALL SELECT 'purchase_orders',  COUNT(*) FROM maintenance.purchase_orders   WHERE org_id = :org
UNION ALL SELECT 'expenses',         COUNT(*) FROM maintenance.expenses          WHERE org_id = :org
UNION ALL SELECT 'contractors',      COUNT(*) FROM maintenance.contractors       WHERE org_id = :org;

COMMIT;

\echo ''
\echo 'เสร็จแล้ว — ขั้นต่อไป:'
\echo '  1. ตรวจตาม docs/changyai_import.md หัวข้อ "ตรวจหลัง import"'
\echo '  2. ย้ายไฟล์รูปจาก Supabase Storage เข้า MinIO แล้วแก้ URL'
\echo '  3. ตั้งรหัสผ่านให้ผู้ใช้ทีละคนที่ /admin/users (ตอนนี้ยังล็อกอินไม่ได้)'
\echo '  4. เมื่อมั่นใจแล้วค่อย: DROP SCHEMA changyai_raw CASCADE;'
