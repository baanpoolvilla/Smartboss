-- ═══════════════════════════════════════════════════════════════════════
--  ดึงข้อมูลรอบสอง (และรอบถัดๆ ไป) จาก ChangYai (Supabase) เข้า Smartboss
--  แบบ "เติมของใหม่ + อัปเดตเฉพาะที่ไม่ชนกัน + รายงานที่ชนให้เช็คเอง"
--
--  ใช้ต่อจาก import-changyai.sql (รอบแรก) เมื่อพนักงานยังใช้ระบบเก่าคู่ขนาน
--  กับ Smartboss ต่อไปอีกพักหนึ่ง แล้วอยากดึงของใหม่/ความคืบหน้าเข้ามาอีกรอบ
--  โดยไม่ทับสิ่งที่คนใน Smartboss ทำไปแล้ว
--
--  ก่อนรัน:
--    1. schema เดิมจากรอบก่อน (changyai_raw) ต้อง rename ไปเก็บเป็น baseline ก่อน
--       dump รอบใหม่ทับ:  ALTER SCHEMA changyai_raw RENAME TO changyai_raw_<วันที่รอบก่อน>;
--    2. dump วันนี้ + โหลดเข้า schema `changyai_raw` ใหม่ (วิธีเดียวกับ
--       docs/changyai_import.md ขั้น 0.1-0.3)
--
--  วิธีรัน (baseline_schema ห้ามใส่ quote — เป็นชื่อ schema ไม่ใช่ string):
--    sudo bash deploy/psql.sh \
--      -v org="'<uuid บริษัท>'" -v yr="'2568'" \
--      -v baseline_schema=changyai_raw_0905 -v cutover="'2026-09-05'" \
--      -f deploy/reimport-changyai-diff.sql
--
--  ⚠ ทั้งไฟล์อยู่ใน transaction เดียว — พังตรงไหนก็ย้อนกลับหมด
--  ⚠ สำรองฐานข้อมูลก่อนเสมอ: sudo bash deploy/backup.sh
--
--  หลักการ (ต่อ 1 แถวที่มีอยู่แล้วทั้งสองฝั่ง เทียบกับ baseline ตอน import รอบก่อน):
--    - "ฝั่งระบบเก่าขยับ"    = ค่าฟิลด์ตอนนี้ในระบบเก่า ต่างจาก baseline
--    - "ฝั่ง Smartboss ขยับ" = ค่าฟิลด์ตอนนี้ใน Smartboss ต่างจาก baseline
--                              (หรือมีคอมเมนต์ใหม่หลัง cutover)
--    - ขยับแค่ฝั่งเก่า  → อัปเดตอัตโนมัติ (ปลอดภัย ไม่มีใครแตะฝั่งนี้)
--    - ขยับทั้งสองฝั่ง  → ไม่แตะ ใส่ตาราง maintenance._reimport_conflicts ให้เช็คเอง
--    - ไม่ขยับเลย      → ไม่ทำอะไร
--  คอมเมนต์ (work_order_comments ฯลฯ) เป็นข้อมูลเพิ่มเติมอย่างเดียว ไม่ทับใคร
--  ⇒ ดึงเข้ามาเสมอถ้ายังไม่มี id นั้น ไม่ต้องรอผลตัดสินสถานะ
-- ═══════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
BEGIN;

-- ด่านตรวจ schema — error ธรรมชาติถ้าไม่มีจริง (regnamespace แปลงไม่ได้ = ไม่มี schema นี้)
SELECT 'changyai_raw'::regnamespace    AS _check_changyai_raw;
SELECT :'baseline_schema'::regnamespace AS _check_baseline_schema;

CREATE TEMP TABLE _cfg AS
SELECT :org::text AS org, :yr::text AS yr, :cutover::timestamptz AS cutover;

DO $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM _cfg;
  IF NOT EXISTS (SELECT 1 FROM core.organizations WHERE id = c.org) THEN
    RAISE EXCEPTION 'ไม่พบบริษัทปลายทาง %', c.org;
  END IF;
END $$;

-- ═══ 1. ผู้ใช้ — คนที่เคย import แล้วจะมี core.users.id = old_id อยู่แล้ว ═══
CREATE TABLE changyai_raw._user_map (old_id text PRIMARY KEY, new_id text NOT NULL);

INSERT INTO changyai_raw._user_map (old_id, new_id)
SELECT u.id::text, u.id::text
FROM changyai_raw.users u
WHERE EXISTS (SELECT 1 FROM core.users c WHERE c.id = u.id::text);

INSERT INTO changyai_raw._user_map (old_id, new_id)
SELECT u.id::text, e.id
FROM changyai_raw.users u
JOIN core.users e ON lower(btrim(e.email)) = lower(btrim(u.email))
WHERE u.email IS NOT NULL AND btrim(u.email) <> ''
  AND NOT EXISTS (SELECT 1 FROM changyai_raw._user_map m WHERE m.old_id = u.id::text);

-- คนใหม่ที่ไม่เคยเห็นมาก่อนเลย (เพิ่งเข้าทีมหลัง import รอบก่อน) → สร้างบัญชีใหม่
INSERT INTO core.users (id, org_id, email, name, password_hash, line_user_id, is_active, created_at, updated_at)
SELECT
  u.id::text, (SELECT org FROM _cfg),
  COALESCE(NULLIF(lower(btrim(u.email)), ''),
           'imported-' || left(u.id::text, 8) || '@changyai.invalid'),
  COALESCE(NULLIF(btrim(u.full_name), ''), 'ยังไม่ระบุชื่อ ' || left(u.id::text, 8)),
  'IMPORTED-NO-LOGIN', u.line_user_id, TRUE, COALESCE(u.created_at, now()), now()
FROM changyai_raw.users u
WHERE NOT EXISTS (SELECT 1 FROM changyai_raw._user_map m WHERE m.old_id = u.id::text);

INSERT INTO changyai_raw._user_map (old_id, new_id)
SELECT u.id::text, u.id::text FROM changyai_raw.users u
WHERE NOT EXISTS (SELECT 1 FROM changyai_raw._user_map m WHERE m.old_id = u.id::text);

CREATE FUNCTION changyai_raw.uid(p uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT new_id FROM changyai_raw._user_map WHERE old_id = p::text
$$;
CREATE FUNCTION changyai_raw.uids(p uuid[]) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(changyai_raw.uid(x)) FILTER (WHERE changyai_raw.uid(x) IS NOT NULL), '{}')
  FROM unnest(COALESCE(p, '{}')) AS x
$$;
CREATE FUNCTION changyai_raw.jarr(p jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p) = 'array'
              THEN ARRAY(SELECT jsonb_array_elements_text(p))
              ELSE '{}'::text[] END
$$;

-- ตารางรายงานความขัดแย้ง (ถาวร ดูย้อนหลังได้)
CREATE TABLE IF NOT EXISTS maintenance._reimport_conflicts (
  id          bigserial PRIMARY KEY,
  entity      text NOT NULL,
  row_id      text NOT NULL,
  org_id      text NOT NULL,
  detail      text NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT now()
);

-- ═══ 2. หมวดหมู่บ้าน — เติมเฉพาะ prefix ที่ยังไม่มี ═══════════════════════
INSERT INTO maintenance.property_categories (id, org_id, prefix, display_name, created_at)
SELECT gen_random_uuid()::text, (SELECT org FROM _cfg), c.prefix, c.display_name, COALESCE(c.created_at, now())
FROM changyai_raw.property_categories c
WHERE c.prefix IS NOT NULL
ON CONFLICT (org_id, prefix) DO NOTHING;

-- ═══ 3. บ้าน / อุปกรณ์ / ผู้รับเหมา — เติมเฉพาะ id ใหม่ ═══════════════════
INSERT INTO maintenance.properties
  (id, org_id, name, address, owner_name, owner_contact, notes, caretaker_id, created_at)
SELECT p.id::text, (SELECT org FROM _cfg), p.name, p.address, p.owner_name, p.owner_contact, p.notes,
       changyai_raw.uid(p.caretaker_id), COALESCE(p.created_at, now())
FROM changyai_raw.properties p
WHERE NOT EXISTS (SELECT 1 FROM maintenance.properties m WHERE m.id = p.id::text);

INSERT INTO maintenance.assets
  (id, org_id, property_id, name, category, brand, model, install_date, warranty_expiry, notes, image_url, created_at)
SELECT a.id::text, (SELECT org FROM _cfg), a.property_id::text, a.name, a.category, a.brand, a.model,
       a.install_date, a.warranty_expiry, a.notes, a.image_url, COALESCE(a.created_at, now())
FROM changyai_raw.assets a
WHERE NOT EXISTS (SELECT 1 FROM maintenance.assets m WHERE m.id = a.id::text)
  AND EXISTS (SELECT 1 FROM maintenance.properties p WHERE p.id = a.property_id::text);

INSERT INTO maintenance.contractors
  (id, org_id, name, phone, specialty, company_name, zone, rating, is_active, notes, price, category, created_at)
SELECT c.id::text, (SELECT org FROM _cfg), c.name, c.phone, c.specialty, c.company_name, c.zone,
       c.rating, COALESCE(c.is_active, TRUE), c.notes, c.price, c.category, COALESCE(c.created_at, now())
FROM changyai_raw.contractors c
WHERE NOT EXISTS (SELECT 1 FROM maintenance.contractors m WHERE m.id = c.id::text);

-- ═══ 4. แผนบำรุงรักษา (PM) ═══════════════════════════════════════════════
INSERT INTO maintenance.pm_schedules
  (id, org_id, property_id, asset_id, title, description, frequency, next_due_date, anchor_date,
   rounds_per_year, total_rounds, rounds_done, awaiting_schedule, last_completed_date,
   is_active, assigned_to, cc_user_ids, requires_expense, created_by, created_at)
SELECT s.id::text, (SELECT org FROM _cfg), s.property_id::text, s.asset_id::text, s.title, s.description,
       s.frequency, s.next_due_date, s.anchor_date,
       s.rounds_per_year, s.total_rounds, COALESCE(s.rounds_done, 0),
       COALESCE(s.awaiting_schedule, FALSE), s.last_completed_date,
       COALESCE(s.is_active, TRUE), changyai_raw.uid(s.assigned_to),
       changyai_raw.uids(s.cc_user_ids), COALESCE(s.requires_expense, TRUE),
       changyai_raw.uid(s.created_by), COALESCE(s.created_at, now())
FROM changyai_raw.pm_schedules s
WHERE NOT EXISTS (SELECT 1 FROM maintenance.pm_schedules m WHERE m.id = s.id::text)
  AND EXISTS (SELECT 1 FROM maintenance.properties p WHERE p.id = s.property_id::text)
  AND (s.asset_id IS NULL OR EXISTS (SELECT 1 FROM maintenance.assets a2 WHERE a2.id = s.asset_id::text));

-- ของเดิมที่มีอยู่แล้วทั้งสองฝั่ง — เทียบ 3 ทาง (baseline / Smartboss ตอนนี้ / ระบบเก่าตอนนี้)
CREATE TEMP TABLE _pm_diff AS
SELECT
  cur.id,
  (base.rounds_done IS DISTINCT FROM new.rounds_done
    OR base.next_due_date IS DISTINCT FROM new.next_due_date
    OR base.last_completed_date IS DISTINCT FROM new.last_completed_date
    OR base.awaiting_schedule IS DISTINCT FROM new.awaiting_schedule) AS old_moved,
  (base.rounds_done IS DISTINCT FROM cur.rounds_done
    OR base.next_due_date IS DISTINCT FROM cur.next_due_date
    OR base.last_completed_date IS DISTINCT FROM cur.last_completed_date
    OR base.awaiting_schedule IS DISTINCT FROM cur.awaiting_schedule) AS sb_moved,
  base.rounds_done AS base_rounds_done, cur.rounds_done AS cur_rounds_done, new.rounds_done AS new_rounds_done,
  new.next_due_date AS new_next_due_date, new.last_completed_date AS new_last_completed_date,
  new.awaiting_schedule AS new_awaiting_schedule
FROM maintenance.pm_schedules cur
JOIN changyai_raw.pm_schedules new ON new.id::text = cur.id
JOIN :baseline_schema.pm_schedules base ON base.id::text = cur.id
WHERE cur.org_id = (SELECT org FROM _cfg);

UPDATE maintenance.pm_schedules m
SET rounds_done = d.new_rounds_done,
    next_due_date = d.new_next_due_date,
    last_completed_date = d.new_last_completed_date,
    awaiting_schedule = d.new_awaiting_schedule
FROM _pm_diff d
WHERE m.id = d.id AND d.old_moved AND NOT d.sb_moved;

INSERT INTO maintenance._reimport_conflicts (entity, row_id, org_id, detail)
SELECT 'pm_schedule', d.id, (SELECT org FROM _cfg),
       format('รอบที่ทำแล้วตอน import=%s | Smartbossตอนนี้=%s | ระบบเก่าตอนนี้=%s — ถูกแตะทั้งสองฝั่งหลัง cutover',
              d.base_rounds_done, d.cur_rounds_done, d.new_rounds_done)
FROM _pm_diff d
WHERE d.old_moved AND d.sb_moved;

-- ═══ 5. ใบงาน ═════════════════════════════════════════════════════════
-- 5.1 ของใหม่ทั้งหมด (ไม่มีในทั้ง Smartboss — เดินเลขต่อจากที่ใช้ไปแล้วของ prefix เดิม)
CREATE TEMP TABLE _wo_new AS
SELECT w.*, ROW_NUMBER() OVER (ORDER BY w.created_at, w.id) AS rn
FROM changyai_raw.work_orders w
WHERE NOT EXISTS (SELECT 1 FROM maintenance.work_orders m WHERE m.id = w.id::text);

CREATE TEMP TABLE _wo_base_n AS
SELECT COALESCE(MAX((substring(code from '^WO-' || :yr || '-(\d+)$'))::int), 0) AS n
FROM maintenance.work_orders WHERE org_id = (SELECT org FROM _cfg) AND code LIKE 'WO-' || :yr || '-%';

INSERT INTO maintenance.work_orders
  (id, org_id, code, property_id, asset_id, assigned_to, created_by, title, description,
   status, priority, due_date, completed_at, completion_notes, photo_urls, after_photo_urls,
   cc_user_ids, additional_property_ids, pm_schedule_id, pm_schedule_ids,
   auto_created, requires_expense, created_at)
SELECT w.id::text, (SELECT org FROM _cfg),
       'WO-' || :yr || '-' || lpad((b.n + w.rn)::text, 4, '0'),
       w.property_id::text, w.asset_id::text, changyai_raw.uid(w.assigned_to), changyai_raw.uid(w.created_by),
       w.title, w.description, w.status, COALESCE(w.priority, 'medium'),
       w.due_date, w.completed_at, w.completion_notes,
       COALESCE(w.photo_urls::text[], '{}'), COALESCE(w.after_photo_urls::text[], '{}'),
       changyai_raw.uids(w.cc_user_ids), COALESCE(w.additional_property_ids::text[], '{}'),
       w.pm_schedule_id::text, COALESCE(w.pm_schedule_ids::text[], '{}'),
       COALESCE(w.auto_created, FALSE), COALESCE(w.requires_expense, TRUE),
       COALESCE(w.created_at, now())
FROM _wo_new w, _wo_base_n b
WHERE EXISTS (SELECT 1 FROM maintenance.properties p WHERE p.id = w.property_id::text)
  AND (w.asset_id IS NULL OR EXISTS (SELECT 1 FROM maintenance.assets a2 WHERE a2.id = w.asset_id::text));

-- 5.2 ของเดิมที่มีอยู่แล้วทั้งสองฝั่ง — เทียบ 3 ทาง
CREATE TEMP TABLE _wo_diff AS
SELECT
  cur.id,
  (base.status IS DISTINCT FROM new.status
    OR base.completed_at IS DISTINCT FROM new.completed_at
    OR base.completion_notes IS DISTINCT FROM new.completion_notes
    OR base.after_photo_urls IS DISTINCT FROM new.after_photo_urls) AS old_moved,
  (base.status IS DISTINCT FROM cur.status
    OR base.completed_at IS DISTINCT FROM cur.completed_at
    OR base.completion_notes IS DISTINCT FROM cur.completion_notes
    OR base.after_photo_urls IS DISTINCT FROM cur.after_photo_urls
    OR EXISTS (
         SELECT 1 FROM maintenance.work_order_comments c
         WHERE c.work_order_id = cur.id AND c.created_at > :cutover
       )
  ) AS sb_moved,
  base.status AS base_status, cur.status AS cur_status, new.status AS new_status,
  new.completed_at AS new_completed_at, new.completion_notes AS new_completion_notes,
  COALESCE(new.after_photo_urls::text[], '{}') AS new_after_photo_urls
FROM maintenance.work_orders cur
JOIN changyai_raw.work_orders new ON new.id::text = cur.id
JOIN :baseline_schema.work_orders base ON base.id::text = cur.id
WHERE cur.org_id = (SELECT org FROM _cfg);

UPDATE maintenance.work_orders m
SET status = d.new_status,
    completed_at = d.new_completed_at,
    completion_notes = d.new_completion_notes,
    after_photo_urls = d.new_after_photo_urls
FROM _wo_diff d
WHERE m.id = d.id AND d.old_moved AND NOT d.sb_moved;

INSERT INTO maintenance._reimport_conflicts (entity, row_id, org_id, detail)
SELECT 'work_order', d.id, (SELECT org FROM _cfg),
       format('ตอน import=%s | Smartbossตอนนี้=%s | ระบบเก่าตอนนี้=%s — ถูกแตะทั้งสองฝั่งหลัง cutover',
              d.base_status, d.cur_status, d.new_status)
FROM _wo_diff d
WHERE d.old_moved AND d.sb_moved;

-- 5.3 คอมเมนต์ใบงาน — เติมของใหม่เสมอ (ไม่ทับอะไร แค่เพิ่มบริบท)
INSERT INTO maintenance.work_order_comments (id, org_id, work_order_id, user_id, content, image_url, created_at)
SELECT c.id::text, (SELECT org FROM _cfg), c.work_order_id::text, changyai_raw.uid(c.user_id),
       COALESCE(c.content, ''), c.image_url, COALESCE(c.created_at, now())
FROM changyai_raw.work_order_comments c
WHERE NOT EXISTS (SELECT 1 FROM maintenance.work_order_comments m WHERE m.id = c.id::text)
  AND EXISTS (SELECT 1 FROM maintenance.work_orders w WHERE w.id = c.work_order_id::text);

-- ═══ 6. ใบสั่งซื้อ (ต้องมาหลังใบงาน เพราะมี FK work_order_id) ═════════════
CREATE TEMP TABLE _po_new AS
SELECT o.*, ROW_NUMBER() OVER (ORDER BY o.created_at, o.id) AS rn
FROM changyai_raw.purchase_orders o
WHERE NOT EXISTS (SELECT 1 FROM maintenance.purchase_orders m WHERE m.id = o.id::text);

CREATE TEMP TABLE _po_base_n AS
SELECT COALESCE(MAX((substring(code from '^PO-' || :yr || '-(\d+)$'))::int), 0) AS n
FROM maintenance.purchase_orders WHERE org_id = (SELECT org FROM _cfg) AND code LIKE 'PO-' || :yr || '-%';

INSERT INTO maintenance.purchase_orders
  (id, org_id, code, property_id, created_by, po_assigned_to, title, status, items,
   total_price, receipt_image_urls, pr_image_urls, is_self_purchase, is_emergency_purchase,
   emergency_reason, po_created_by, po_created_at, ordered_by, ordered_at,
   received_by, received_at, created_at, updated_at)
SELECT o.id::text, (SELECT org FROM _cfg),
       'PO-' || :yr || '-' || lpad((b.n + o.rn)::text, 4, '0'),
       o.property_id::text, changyai_raw.uid(o.created_by), changyai_raw.uid(o.po_assigned_to),
       o.title, o.status, COALESCE(o.items, '[]'::jsonb), COALESCE(o.total_price, 0),
       changyai_raw.jarr(o.receipt_image_urls), COALESCE(o.pr_image_urls::text[], '{}'),
       COALESCE(o.is_self_purchase, FALSE), COALESCE(o.is_emergency_purchase, FALSE),
       o.emergency_reason, changyai_raw.uid(o.po_created_by), o.po_created_at,
       changyai_raw.uid(o.ordered_by), o.ordered_at, changyai_raw.uid(o.received_by), o.received_at,
       COALESCE(o.created_at, now()), COALESCE(o.updated_at, o.created_at, now())
FROM _po_new o, _po_base_n b
WHERE (o.property_id IS NULL OR EXISTS (SELECT 1 FROM maintenance.properties p WHERE p.id = o.property_id::text));

-- ของเดิมที่ Smartboss แก้ไปแล้วหลัง cutover — เป็นข้อมูลการเงิน ไม่ auto ทับ แค่รายงาน
INSERT INTO maintenance._reimport_conflicts (entity, row_id, org_id, detail)
SELECT 'purchase_order', m.id, (SELECT org FROM _cfg),
       format('Smartboss แก้ไขหลัง %s (status=%s, total=%s) — เช็คว่าระบบเก่ามีอะไรใหม่ที่ต้องรวมไหม',
              :cutover, m.status, m.total_price)
FROM maintenance.purchase_orders m
WHERE m.org_id = (SELECT org FROM _cfg) AND m.updated_at > :cutover
  AND EXISTS (SELECT 1 FROM changyai_raw.purchase_orders o WHERE o.id::text = m.id);

-- ═══ 7. คอมเมนต์ PO / คืนของ — เติมของใหม่เท่านั้น ════════════════════════
INSERT INTO maintenance.purchase_order_comments (id, org_id, purchase_order_id, user_id, content, image_urls, created_at)
SELECT c.id::text, (SELECT org FROM _cfg), c.purchase_order_id::text, changyai_raw.uid(c.user_id),
       COALESCE(c.content, ''),
       CASE WHEN c.image_url IS NULL OR c.image_url = '' THEN '{}'::text[] ELSE ARRAY[c.image_url] END,
       COALESCE(c.created_at, now())
FROM changyai_raw.purchase_order_comments c
WHERE NOT EXISTS (SELECT 1 FROM maintenance.purchase_order_comments m WHERE m.id = c.id::text)
  AND EXISTS (SELECT 1 FROM maintenance.purchase_orders p WHERE p.id = c.purchase_order_id::text);

INSERT INTO maintenance.equipment_returns
  (id, org_id, purchase_order_id, property_id, created_by, item_name, qty, problem_type, reason,
   status, image_urls, resolution_note, resolved_by, resolved_at, created_at, updated_at)
SELECT r.id::text, (SELECT org FROM _cfg), r.purchase_order_id::text, r.property_id::text, changyai_raw.uid(r.created_by),
       r.item_name, COALESCE(r.qty, 1), r.problem_type, r.reason, COALESCE(r.status, 'pending'),
       changyai_raw.jarr(r.image_urls), r.resolution_note,
       changyai_raw.uid(r.resolved_by), r.resolved_at, COALESCE(r.created_at, now()), now()
FROM changyai_raw.equipment_returns r
WHERE NOT EXISTS (SELECT 1 FROM maintenance.equipment_returns m WHERE m.id = r.id::text)
  AND EXISTS (SELECT 1 FROM maintenance.purchase_orders p WHERE p.id = r.purchase_order_id::text);

-- ═══ 8. ค่าใช้จ่าย — เติมของใหม่เท่านั้น (ไม่มี FK บังคับ ตามต้นฉบับ) ═════
INSERT INTO maintenance.expenses
  (id, org_id, work_order_id, pm_schedule_id, purchase_order_id, property_id, created_by,
   description, amount, category, receipt_url, billable_to_partner, cost_type, paid_by,
   is_no_expense, expense_date, created_at)
SELECT e.id::text, (SELECT org FROM _cfg), e.work_order_id::text, e.pm_schedule_id::text,
       e.purchase_order_id::text, e.property_id::text, changyai_raw.uid(e.created_by),
       e.description, COALESCE(e.amount, 0), e.category, e.receipt_url,
       COALESCE(e.billable_to_partner, FALSE), e.cost_type, e.paid_by,
       COALESCE(e.is_no_expense, FALSE), e.expense_date, COALESCE(e.created_at, now())
FROM changyai_raw.expenses e
WHERE NOT EXISTS (SELECT 1 FROM maintenance.expenses m WHERE m.id = e.id::text);

-- ═══ 9. ประวัติผู้รับเหมา — เติมของใหม่เท่านั้น ═══════════════════════════
INSERT INTO maintenance.contractor_history
  (id, org_id, contractor_id, work_order_id, property_id, description, amount, rating, work_date, created_at)
SELECT h.id::text, (SELECT org FROM _cfg), h.contractor_id::text, h.work_order_id::text, h.property_id::text,
       h.description, COALESCE(h.amount, 0), h.rating, h.work_date, COALESCE(h.created_at, now())
FROM changyai_raw.contractor_history h
WHERE NOT EXISTS (SELECT 1 FROM maintenance.contractor_history m WHERE m.id = h.id::text)
  AND EXISTS (SELECT 1 FROM maintenance.contractors c WHERE c.id = h.contractor_id::text);

-- ═══ 10. ตัวเดินเลขต่อ — กันใบงาน/PO ใบถัดไปชนกัน ═══════════════════════
INSERT INTO core.document_counters (org_id, doc_type, period, next_value)
SELECT (SELECT org FROM _cfg), 'WO', (SELECT yr FROM _cfg), COUNT(*) + 1
FROM maintenance.work_orders WHERE org_id = (SELECT org FROM _cfg) AND code LIKE 'WO-' || :yr || '-%'
ON CONFLICT (org_id, doc_type, period) DO UPDATE
  SET next_value = GREATEST(core.document_counters.next_value, EXCLUDED.next_value);

INSERT INTO core.document_counters (org_id, doc_type, period, next_value)
SELECT (SELECT org FROM _cfg), 'PO', (SELECT yr FROM _cfg), COUNT(*) + 1
FROM maintenance.purchase_orders WHERE org_id = (SELECT org FROM _cfg) AND code LIKE 'PO-' || :yr || '-%'
ON CONFLICT (org_id, doc_type, period) DO UPDATE
  SET next_value = GREATEST(core.document_counters.next_value, EXCLUDED.next_value);

COMMIT;

-- ═══ สรุปผล (นอก transaction — อ่านอย่างเดียว) ═══════════════════════════
\echo ''
\echo '── จำนวนแถวทั้งหมดตอนนี้ ──'
SELECT 'properties' t, COUNT(*) FROM maintenance.properties WHERE org_id = :org
UNION ALL SELECT 'assets',          COUNT(*) FROM maintenance.assets          WHERE org_id = :org
UNION ALL SELECT 'pm_schedules',    COUNT(*) FROM maintenance.pm_schedules    WHERE org_id = :org
UNION ALL SELECT 'work_orders',     COUNT(*) FROM maintenance.work_orders     WHERE org_id = :org
UNION ALL SELECT 'purchase_orders', COUNT(*) FROM maintenance.purchase_orders WHERE org_id = :org
UNION ALL SELECT 'expenses',        COUNT(*) FROM maintenance.expenses       WHERE org_id = :org
UNION ALL SELECT 'contractors',     COUNT(*) FROM maintenance.contractors    WHERE org_id = :org;

\echo ''
\echo '── รายการที่ "ชนกัน" ต้องเช็คเอง (ถูกแตะทั้งสองฝั่งหลัง cutover) ──'
SELECT entity, row_id, detail FROM maintenance._reimport_conflicts
WHERE org_id = :org ORDER BY reported_at DESC, entity;

\echo ''
\echo 'เสร็จแล้ว — ขั้นต่อไป:'
\echo '  1. ดูรายการชนกันด้านบน เช็คทีละใบว่าจะเอาเวอร์ชันไหน (แก้มือใน UI)'
\echo '  2. เมื่อมั่นใจแล้วค่อย: DROP SCHEMA changyai_raw_<baseline เดิม> CASCADE;'
\echo '     (เก็บ changyai_raw ปัจจุบันไว้เผื่อดึงรอบถัดไป — rename เป็น baseline ใหม่ก่อน)'
