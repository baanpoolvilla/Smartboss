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
--
--  ── รันซ้ำได้ปลอดภัย (idempotent) — ใช้ sync ข้อมูลล่าสุดก่อนเลิกใช้ ChangYai ──
--
--  id ยกมาจาก ChangYai ตรง ๆ (ดู docs/changyai_import.md "id เป็น UUID ทั้งสอง
--  ระบบ") ⇒ รันครั้งที่สองด้วย dump ใหม่ จะ "อัปเดต" แถวที่เคย import ไปแล้วให้
--  ตรงกับ ChangYai ล่าสุด (สถานะ/ราคา/รูป/ฯลฯ) แล้ว insert เฉพาะแถวที่เพิ่งมี
--  เพิ่ม — ไม่ต้องลบของเก่าก่อน ไม่ชนกัน
--
--  ยกเว้น 2 อย่างที่ตั้งใจ "ไม่แตะของเดิม" แม้ ChangYai จะมีค่าใหม่กว่า:
--    • core.users ของคนที่เคย import มา — ฝ่ายบุคคลอาจแก้ชื่อ/อีเมล/ตั้ง
--      รหัสผ่านให้แล้วที่ /admin/users (ดู docs ข้อ 0.5) รันซ้ำต้องไม่ไปทับ
--    • code ของใบงาน/ใบสั่งซื้อที่มีอยู่แล้ว — เลขที่เอกสารต้องคงที่ตลอดอายุ
--      ใบ ใบใหม่เท่านั้นที่ได้เลขใหม่ ต่อจากเลขสูงสุดที่มีอยู่
--
--  ⚠ ข้อจำกัด — นี่คือ "อัปเดต/เพิ่ม" ไม่ใช่ "ทำให้เหมือนกันเป๊ะ": แถวที่เคย
--    import ไปแล้วแต่ถูกลบออกจาก ChangYai ไปแล้ว จะไม่ถูกลบตามที่นี่ ต้องลบ
--    เองถ้าจำเป็น (ปกติไม่จำเป็น — งานที่เคยมีอยู่จริงไม่ควรหายเพราะ resync)
-- ═══════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
BEGIN;

-- ── ด่านตรวจก่อนแตะข้อมูล ────────────────────────────────────────────
--
-- ⚠ psql ไม่แทนค่า :org ข้างใน DO $$ ... $$ — ข้อความใน dollar-quote ถูกส่ง
--   ให้เซิร์ฟเวอร์ดิบ ๆ psql ไม่แตะเลย ⇒ ต้องพักค่าไว้ในตารางชั่วคราวก่อน
--   แล้วให้ DO อ่านจากตารางนั้นแทน (statement ธรรมดาใช้ :org ได้ตามปกติ)
CREATE TEMP TABLE _cfg AS SELECT :org::text AS org;

DO $$
DECLARE v_org text;
BEGIN
  SELECT org INTO v_org FROM _cfg;
  IF NOT EXISTS (SELECT 1 FROM core.organizations WHERE id = v_org) THEN
    RAISE EXCEPTION 'ไม่พบบริษัทปลายทาง % — ตรวจ core.organizations ก่อน', v_org;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'changyai_raw') THEN
    RAISE EXCEPTION 'ยังไม่ได้โหลด dump เข้า schema changyai_raw';
  END IF;
END $$;

-- ═══ 1. ผู้ใช้ + ตารางจับคู่ไอดี ═══════════════════════════════════
--
-- ต้องมาก่อนทุกตาราง เพราะ assigned_to / created_by ชี้มาที่นี่
--
-- ⚠ ทำไมต้องมีตารางจับคู่ ไม่ insert ตรง ๆ
--    1. ผู้ใช้บางคนในระบบเก่าอาจไม่มีอีเมล — ถ้าข้ามไป ใบงานของคนนั้น
--       จะไม่มีผู้รับผิดชอบ เพราะ id ที่อ้างถึงไม่มีอยู่ในระบบใหม่
--    2. คนเดียวกันใช้คนละอีเมลในสองระบบ (ChangYai ใช้ line_<id>@changyai.app
--       ส่วน Smartboss ใช้อีเมลบริษัท) ⇒ เทียบอีเมลตรง ๆ จับคู่ไม่ได้เลย
--
--    ตารางนี้แปลง "ไอดีเก่า → ไอดีที่ใช้จริง" แล้วทุกตารางข้างล่างอ้างผ่านมัน
CREATE TABLE changyai_raw._user_map (old_id text PRIMARY KEY, new_id text NOT NULL);

-- ── 1.0 คู่ที่เจ้าของจับด้วยตาเอง ────────────────────────────────────
--
-- ชื่อในสองระบบไม่มีอะไรตรงกันเลย (ChangYai ใช้ชื่อเล่น/ชื่อ LINE เช่น "Skys 💖"
-- ส่วน Smartboss ใช้ชื่อจริง) ⇒ ต้องให้คนจับคู่ ระบบเดาเองไม่ได้
--
-- จับคู่ผ่านอีเมล ไม่ใช่ไอดี เพราะอีเมลอ่านออกและตรวจทานได้ด้วยตา
CREATE TEMP TABLE _pairs (cy_email text, sb_email text);
INSERT INTO _pairs VALUES
  ('line_u8cdb7c98d93fed1812d82be973d866cc@changyai.app', 'chayanun@baanpoolvilla.com'),   -- Skys 💖
  ('line_u211c85db2aeb61dba4fe6e424b3618a0@changyai.app', 'pacharapol@baanpoolvilla.com'), -- Guy^_^
  ('line_u342002ea3f3f58161ae4547dee04f97e@changyai.app', 'somporn@baanpoolvilla.com'),    -- KATAI 🐰
  ('line_U5089b5659b63d44de621295b32331a4b@changyai.app', 'thanonchai@baanpoolvilla.com'), -- Ossy Maru
  ('line_uc5c4eb7fcebd4884e5acc239843f7cc7@changyai.app', 'kanthita@baanpoolvilla.com'),   -- aui
  ('line_U2a3d8125e26ad0c4db813c9deee12645@changyai.app', 'soravee@baanpoolvilla.com'),    -- B E E
  ('line_u5de79f6ba7e3e62a8c0740e6302d0258@changyai.app', 'waratta@baanpoolvilla.com'),    -- Nok
  ('line_U99a23ca2ce03ae70b0ef385ce0c62f9b@changyai.app', 'sujita@baanpoolvilla.com'),     -- Asu.Kp
  ('line_u22e53dbc3fc3adb72acf8e09540056df@changyai.app', 'kanitha@baanpoolvilla.com'),    -- #แม่เชี่ยกะกัสกัส#
  ('line_u4e77aad4b7544accac00e98d2c3dbbeb@changyai.app', 'thunchanok@baanpoolvilla.com'), -- nam..
  ('line_uca9c56001893ce575beede088dd75703@changyai.app', 'katawut@baanpoolvilla.com');    -- กีม (เจ้าของ)
-- ยังไม่มีคู่ (จะถูกสร้างเป็นบัญชีใหม่ในข้อ 1.2):
--   line_u2478714860d425a1f1ec0fd6da61ba27  Ad/Baan Pool Villa 🏖
--   line_U08bf5527ed4598ce433d91230d155506  ช. โก๊ะ

INSERT INTO changyai_raw._user_map (old_id, new_id)
SELECT u.id::text, sb.id
FROM _pairs p
JOIN changyai_raw.users u ON lower(btrim(u.email)) = lower(p.cy_email)
JOIN core.users sb        ON lower(btrim(sb.email)) = lower(p.sb_email);

-- ⚠ ด่านตรวจ — คู่ไหนจับไม่ติดต้องรู้ทันที ไม่ใช่ปล่อยให้เงียบ
--
-- ไอดี LINE 32 ตัวอักษรถูกอ่านมาจากหน้าจอ พิมพ์ผิดตัวเดียวก็ไม่ match
-- ถ้าไม่เช็ค คนคนนั้นจะถูกสร้างเป็นบัญชีใหม่แทนที่จะรวมกับบัญชีเดิม
-- แล้วงานของเขาจะไปอยู่ใต้ชื่อที่ไม่มีใครรู้จัก ซึ่งกว่าจะรู้ตัวก็สายแล้ว
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s → %s (%s)', p.cy_email, p.sb_email,
           CASE WHEN NOT EXISTS (SELECT 1 FROM changyai_raw.users u
                                  WHERE lower(btrim(u.email)) = lower(p.cy_email))
                THEN 'ไม่พบฝั่ง ChangYai' ELSE 'ไม่พบฝั่ง Smartboss' END), E'\n  ')
    INTO bad
  FROM _pairs p
  WHERE NOT EXISTS (
    SELECT 1 FROM changyai_raw.users u JOIN core.users sb ON TRUE
    WHERE lower(btrim(u.email)) = lower(p.cy_email)
      AND lower(btrim(sb.email)) = lower(p.sb_email));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION E'จับคู่ผู้ใช้ไม่ติด:\n  %', bad;
  END IF;
END $$;

-- ── 1.1 ที่เหลือ ถ้าอีเมลตรงกันพอดีก็ชี้ไปบัญชีเดิม ─────────────────
INSERT INTO changyai_raw._user_map (old_id, new_id)
SELECT u.id::text, e.id
FROM changyai_raw.users u
JOIN core.users e ON lower(btrim(e.email)) = lower(btrim(u.email))
WHERE u.email IS NOT NULL AND btrim(u.email) <> ''
  AND NOT EXISTS (SELECT 1 FROM changyai_raw._user_map m WHERE m.old_id = u.id::text);

-- 1.2 ที่เหลือ → สร้างบัญชีใหม่ โดยใช้ไอดีเดิม
--
-- ไม่มีอีเมลก็ยังย้ายมา — ใส่อีเมลชั่วคราวที่ส่งจริงไม่ได้ (.invalid สงวนไว้
-- ตาม RFC 2606 จึงไม่มีทางไปชนโดเมนของใคร) เจ้าของค่อยมาแก้ทีหลัง
--
-- รหัสผ่านย้ายมาไม่ได้ (Supabase Auth คนละวิธีเข้ารหัส) ⇒ ใส่ค่าที่ไม่ใช่
-- รูปแบบ hash ที่ถูกต้องเลย ⇒ verify ไม่มีทางผ่าน ต่อให้เดารหัสถูกก็เข้าไม่ได้
-- ปลอดภัยกว่าตั้งรหัสกลางเหมือนกันทุกคนซึ่งกลายเป็นช่องโหว่ทันที
--
-- ⚠ ON CONFLICT (id) DO NOTHING — ไม่ใช่ DO UPDATE — เพราะรอบก่อนหน้าอาจมีคน
--   ไปแก้ชื่อ/อีเมล/ตั้งรหัสผ่านให้บัญชีนี้แล้วที่ /admin/users (ดู docs ข้อ
--   0.5) รันซ้ำต้องไม่ไปทับงานที่ฝ่ายบุคคลทำไว้ ให้เหลือแค่ "ยังไม่มีก็สร้าง"
INSERT INTO core.users (id, org_id, email, name, password_hash, line_user_id, is_active, created_at, updated_at)
SELECT
  u.id::text,
  :org,
  COALESCE(NULLIF(lower(btrim(u.email)), ''),
           'imported-' || left(u.id::text, 8) || '@changyai.invalid'),
  COALESCE(NULLIF(btrim(u.full_name), ''), 'ยังไม่ระบุชื่อ ' || left(u.id::text, 8)),
  'IMPORTED-NO-LOGIN',
  u.line_user_id,
  TRUE,
  COALESCE(u.created_at, now()),
  now()
FROM changyai_raw.users u
WHERE NOT EXISTS (SELECT 1 FROM changyai_raw._user_map m WHERE m.old_id = u.id::text)
ON CONFLICT (id) DO NOTHING;

INSERT INTO changyai_raw._user_map (old_id, new_id)
SELECT u.id::text, u.id::text
FROM changyai_raw.users u
WHERE NOT EXISTS (SELECT 1 FROM changyai_raw._user_map m WHERE m.old_id = u.id::text);

-- ตัวช่วยให้ทุก INSERT ข้างล่างอ่านง่าย — คืน null เมื่อไม่มีคู่ (ค่าเดิมว่างอยู่แล้ว)
CREATE FUNCTION changyai_raw.uid(p uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT new_id FROM changyai_raw._user_map WHERE old_id = p::text
$$;

-- แปลงอาเรย์ผู้ใช้ (cc_user_ids) ทีละช่อง
CREATE FUNCTION changyai_raw.uids(p uuid[]) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(changyai_raw.uid(x)) FILTER (WHERE changyai_raw.uid(x) IS NOT NULL), '{}')
  FROM unnest(COALESCE(p, '{}')) AS x
$$;

/**
 * jsonb → text[] อย่างปลอดภัย
 *
 * ChangYai เก็บอาเรย์รูปสองแบบปนกัน — บางคอลัมน์เป็น text[] จริง
 * (pr_image_urls) บางคอลัมน์เป็น jsonb (receipt_image_urls, image_urls)
 * cast ตรง ๆ จาก jsonb ไป text[] ไม่ได้ ต้องคลี่ทีละสมาชิก
 *
 * เช็ค jsonb_typeof ก่อนเสมอ — ถ้าเจอ null หรือ object (ไม่ใช่อาเรย์)
 * jsonb_array_elements_text จะโยน error แล้วล้มทั้ง transaction
 */
CREATE FUNCTION changyai_raw.jarr(p jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p) = 'array'
              THEN ARRAY(SELECT jsonb_array_elements_text(p))
              ELSE '{}'::text[] END
$$;

-- ═══ 2. หมวดหมู่บ้าน ═════════════════════════════════════════════════
--
-- id = gen_random_uuid() ใหม่ทุกครั้ง แต่มี UNIQUE(org_id, prefix) กันซ้ำ
-- อยู่แล้ว ⇒ ON CONFLICT DO NOTHING ปลอดภัยสำหรับรันซ้ำโดยไม่ต้องแก้อะไร
INSERT INTO maintenance.property_categories (id, org_id, prefix, display_name, created_at)
SELECT gen_random_uuid()::text, :org, c.prefix, c.display_name, COALESCE(c.created_at, now())
FROM changyai_raw.property_categories c
ON CONFLICT DO NOTHING;

-- ═══ 3. บ้าน / ทรัพย์สิน ═════════════════════════════════════════════
INSERT INTO maintenance.properties
  (id, org_id, name, address, owner_name, owner_contact, notes, caretaker_id, created_at)
SELECT p.id::text, :org, p.name, p.address, p.owner_name, p.owner_contact, p.notes,
       changyai_raw.uid(p.caretaker_id), COALESCE(p.created_at, now())
FROM changyai_raw.properties p
ON CONFLICT (id) DO UPDATE SET
  name          = EXCLUDED.name,
  address       = EXCLUDED.address,
  owner_name    = EXCLUDED.owner_name,
  owner_contact = EXCLUDED.owner_contact,
  notes         = EXCLUDED.notes,
  caretaker_id  = EXCLUDED.caretaker_id;

-- ═══ 4. อุปกรณ์ ══════════════════════════════════════════════════════
INSERT INTO maintenance.assets
  (id, org_id, property_id, name, category, brand, model, install_date, warranty_expiry, notes, image_url, created_at)
SELECT a.id::text, :org, a.property_id::text, a.name, a.category, a.brand, a.model,
       a.install_date, a.warranty_expiry, a.notes, a.image_url, COALESCE(a.created_at, now())
FROM changyai_raw.assets a
ON CONFLICT (id) DO UPDATE SET
  property_id     = EXCLUDED.property_id,
  name            = EXCLUDED.name,
  category        = EXCLUDED.category,
  brand           = EXCLUDED.brand,
  model           = EXCLUDED.model,
  install_date    = EXCLUDED.install_date,
  warranty_expiry = EXCLUDED.warranty_expiry,
  notes           = EXCLUDED.notes,
  image_url       = EXCLUDED.image_url;

-- ═══ 5. ผู้รับเหมา ═══════════════════════════════════════════════════
INSERT INTO maintenance.contractors
  (id, org_id, name, phone, specialty, company_name, zone, rating, is_active, notes,
   price, category, created_at)
SELECT c.id::text, :org, c.name, c.phone, c.specialty, c.company_name, c.zone,
       c.rating, COALESCE(c.is_active, TRUE), c.notes,
       c.price, c.category, COALESCE(c.created_at, now())
FROM changyai_raw.contractors c
ON CONFLICT (id) DO UPDATE SET
  name         = EXCLUDED.name,
  phone        = EXCLUDED.phone,
  specialty    = EXCLUDED.specialty,
  company_name = EXCLUDED.company_name,
  zone         = EXCLUDED.zone,
  rating       = EXCLUDED.rating,
  is_active    = EXCLUDED.is_active,
  notes        = EXCLUDED.notes,
  price        = EXCLUDED.price,
  category     = EXCLUDED.category;

-- ═══ 6. แผนบำรุงรักษา ════════════════════════════════════════════════
INSERT INTO maintenance.pm_schedules
  (id, org_id, property_id, asset_id, title, description, frequency, next_due_date, anchor_date,
   rounds_per_year, total_rounds, rounds_done, awaiting_schedule, last_completed_date,
   is_active, assigned_to, cc_user_ids, requires_expense, created_by, created_at)
SELECT s.id::text, :org, s.property_id::text, s.asset_id::text, s.title, s.description,
       s.frequency, s.next_due_date, s.anchor_date,
       s.rounds_per_year, s.total_rounds, COALESCE(s.rounds_done, 0),
       COALESCE(s.awaiting_schedule, FALSE), s.last_completed_date,
       COALESCE(s.is_active, TRUE), changyai_raw.uid(s.assigned_to),
       changyai_raw.uids(s.cc_user_ids), COALESCE(s.requires_expense, TRUE),
       changyai_raw.uid(s.created_by), COALESCE(s.created_at, now())
FROM changyai_raw.pm_schedules s
ON CONFLICT (id) DO UPDATE SET
  property_id         = EXCLUDED.property_id,
  asset_id            = EXCLUDED.asset_id,
  title               = EXCLUDED.title,
  description         = EXCLUDED.description,
  frequency           = EXCLUDED.frequency,
  next_due_date       = EXCLUDED.next_due_date,
  anchor_date         = EXCLUDED.anchor_date,
  rounds_per_year     = EXCLUDED.rounds_per_year,
  total_rounds        = EXCLUDED.total_rounds,
  rounds_done         = EXCLUDED.rounds_done,
  awaiting_schedule   = EXCLUDED.awaiting_schedule,
  last_completed_date = EXCLUDED.last_completed_date,
  is_active           = EXCLUDED.is_active,
  assigned_to         = EXCLUDED.assigned_to,
  cc_user_ids         = EXCLUDED.cc_user_ids,
  requires_expense    = EXCLUDED.requires_expense,
  created_by          = EXCLUDED.created_by;

-- ═══ 7. ใบงาน ════════════════════════════════════════════════════════
--
-- ⚠ code เป็น NOT NULL + UNIQUE(org_id, code) แต่ ChangYai ไม่มีเลขที่เอกสาร
--   ⇒ เดินเลขตามลำดับเวลาที่สร้าง ให้เลขเรียงตรงกับความเป็นจริง
--
-- ⚠ รันซ้ำ — ใบที่มีอยู่แล้ว "ไม่แตะ code" เลย (คงเลขเดิม) มีแค่ใบใหม่เท่านั้น
--   ที่ถูกเดินเลขต่อจากเลขสูงสุดที่มีอยู่ในปีนั้น ไม่ใช่นับ 1 ใหม่ทุกครั้ง —
--   ไม่งั้นรันซ้ำแต่ละครั้งจะเลขชนกันหรือย้อนไปทับใบเก่า
WITH src AS (
  SELECT w.*, x.code AS existing_code
  FROM changyai_raw.work_orders w
  LEFT JOIN maintenance.work_orders x ON x.id = w.id::text
),
new_numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS n
  FROM src WHERE existing_code IS NULL
),
base AS (
  SELECT COALESCE(MAX(substring(code FROM '\d+$')::int), 0) AS n
  FROM maintenance.work_orders
  WHERE org_id = :org AND code LIKE 'WO-' || :yr || '-%'
)
INSERT INTO maintenance.work_orders
  (id, org_id, code, property_id, asset_id, assigned_to, created_by, title, description,
   status, priority, due_date, completed_at, completion_notes, photo_urls, after_photo_urls,
   cc_user_ids, additional_property_ids, pm_schedule_id, pm_schedule_ids,
   auto_created, requires_expense, created_at)
SELECT src.id::text, :org,
       COALESCE(src.existing_code,
                'WO-' || :yr || '-' || lpad((base.n + nn.n)::text, 4, '0')),
       src.property_id::text, src.asset_id::text, changyai_raw.uid(src.assigned_to), changyai_raw.uid(src.created_by),
       src.title, src.description, src.status, COALESCE(src.priority, 'medium'),
       src.due_date, src.completed_at, src.completion_notes,
       COALESCE(src.photo_urls::text[], '{}'), COALESCE(src.after_photo_urls::text[], '{}'),
       changyai_raw.uids(src.cc_user_ids), COALESCE(src.additional_property_ids::text[], '{}'),
       src.pm_schedule_id::text, COALESCE(src.pm_schedule_ids::text[], '{}'),
       COALESCE(src.auto_created, FALSE), COALESCE(src.requires_expense, TRUE),
       COALESCE(src.created_at, now())
FROM src
CROSS JOIN base
LEFT JOIN new_numbered nn ON nn.id = src.id
ON CONFLICT (id) DO UPDATE SET
  -- code ไม่อยู่ในรายการนี้โดยตั้งใจ — ของเดิมไม่เปลี่ยน
  property_id              = EXCLUDED.property_id,
  asset_id                 = EXCLUDED.asset_id,
  assigned_to              = EXCLUDED.assigned_to,
  created_by                = EXCLUDED.created_by,
  title                    = EXCLUDED.title,
  description              = EXCLUDED.description,
  status                   = EXCLUDED.status,
  priority                 = EXCLUDED.priority,
  due_date                 = EXCLUDED.due_date,
  completed_at             = EXCLUDED.completed_at,
  completion_notes         = EXCLUDED.completion_notes,
  photo_urls               = EXCLUDED.photo_urls,
  after_photo_urls         = EXCLUDED.after_photo_urls,
  cc_user_ids              = EXCLUDED.cc_user_ids,
  additional_property_ids  = EXCLUDED.additional_property_ids,
  pm_schedule_id           = EXCLUDED.pm_schedule_id,
  pm_schedule_ids          = EXCLUDED.pm_schedule_ids,
  auto_created             = EXCLUDED.auto_created,
  requires_expense         = EXCLUDED.requires_expense;

-- ═══ 8. คอมเมนต์ใบงาน ════════════════════════════════════════════════
INSERT INTO maintenance.work_order_comments
  (id, org_id, work_order_id, user_id, content, image_url, created_at)
SELECT c.id::text, :org, c.work_order_id::text, changyai_raw.uid(c.user_id),
       COALESCE(c.content, ''), c.image_url,
       COALESCE(c.created_at, now())
FROM changyai_raw.work_order_comments c
ON CONFLICT (id) DO UPDATE SET
  work_order_id = EXCLUDED.work_order_id,
  user_id       = EXCLUDED.user_id,
  content       = EXCLUDED.content,
  image_url     = EXCLUDED.image_url;

-- ═══ 9. ใบสั่งซื้อ ═══════════════════════════════════════════════════
--
-- โครงการเดียวกับใบงานข้อ 7 — code ของใบที่มีอยู่แล้วไม่ถูกแตะ ใบใหม่เดินเลข
-- ต่อจากเลขสูงสุดที่มีอยู่
WITH src AS (
  SELECT o.*, x.code AS existing_code
  FROM changyai_raw.purchase_orders o
  LEFT JOIN maintenance.purchase_orders x ON x.id = o.id::text
),
new_numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS n
  FROM src WHERE existing_code IS NULL
),
base AS (
  SELECT COALESCE(MAX(substring(code FROM '\d+$')::int), 0) AS n
  FROM maintenance.purchase_orders
  WHERE org_id = :org AND code LIKE 'PO-' || :yr || '-%'
)
INSERT INTO maintenance.purchase_orders
  (id, org_id, code, property_id, created_by, po_assigned_to, title, status, items,
   total_price, receipt_image_urls, pr_image_urls, is_self_purchase, is_emergency_purchase,
   emergency_reason, po_created_by, po_created_at, ordered_by, ordered_at,
   received_by, received_at, created_at, updated_at)
SELECT src.id::text, :org,
       COALESCE(src.existing_code,
                'PO-' || :yr || '-' || lpad((base.n + nn.n)::text, 4, '0')),
       src.property_id::text, changyai_raw.uid(src.created_by), changyai_raw.uid(src.po_assigned_to),
       src.title, src.status, COALESCE(src.items, '[]'::jsonb), COALESCE(src.total_price, 0),
       changyai_raw.jarr(src.receipt_image_urls), COALESCE(src.pr_image_urls::text[], '{}'),
       COALESCE(src.is_self_purchase, FALSE), COALESCE(src.is_emergency_purchase, FALSE),
       src.emergency_reason, changyai_raw.uid(src.po_created_by), src.po_created_at,
       changyai_raw.uid(src.ordered_by), src.ordered_at, changyai_raw.uid(src.received_by), src.received_at,
       COALESCE(src.created_at, now()),
       -- updated_at ของเราเป็น NOT NULL — Prisma @updatedAt เติมให้เองตอนเขียนผ่าน ORM
       -- แต่ SQL ดิบไม่มีใครเติม ⇒ ยกค่าเดิมมา ไม่มีก็ใช้ created_at
       COALESCE(src.updated_at, src.created_at, now())
FROM src
CROSS JOIN base
LEFT JOIN new_numbered nn ON nn.id = src.id
ON CONFLICT (id) DO UPDATE SET
  -- code ไม่อยู่ในรายการนี้โดยตั้งใจ — ของเดิมไม่เปลี่ยน
  property_id           = EXCLUDED.property_id,
  created_by            = EXCLUDED.created_by,
  po_assigned_to        = EXCLUDED.po_assigned_to,
  title                 = EXCLUDED.title,
  status                = EXCLUDED.status,
  items                 = EXCLUDED.items,
  total_price           = EXCLUDED.total_price,
  receipt_image_urls    = EXCLUDED.receipt_image_urls,
  pr_image_urls         = EXCLUDED.pr_image_urls,
  is_self_purchase      = EXCLUDED.is_self_purchase,
  is_emergency_purchase = EXCLUDED.is_emergency_purchase,
  emergency_reason      = EXCLUDED.emergency_reason,
  po_created_by         = EXCLUDED.po_created_by,
  po_created_at         = EXCLUDED.po_created_at,
  ordered_by            = EXCLUDED.ordered_by,
  ordered_at            = EXCLUDED.ordered_at,
  received_by           = EXCLUDED.received_by,
  received_at           = EXCLUDED.received_at,
  updated_at            = EXCLUDED.updated_at;

-- ═══ 10. คอมเมนต์ใบสั่งซื้อ ══════════════════════════════════════════
--
-- ต้นทางเก็บรูปเดี่ยว (image_url) ของเราเก็บเป็นอาเรย์ ⇒ ห่อเป็นอาเรย์ 1 ช่อง
INSERT INTO maintenance.purchase_order_comments
  (id, org_id, purchase_order_id, user_id, content, image_urls, created_at)
SELECT c.id::text, :org, c.purchase_order_id::text, changyai_raw.uid(c.user_id),
       COALESCE(c.content, ''),
       CASE WHEN c.image_url IS NULL OR c.image_url = '' THEN '{}'::text[]
            ELSE ARRAY[c.image_url] END,
       COALESCE(c.created_at, now())
FROM changyai_raw.purchase_order_comments c
ON CONFLICT (id) DO UPDATE SET
  purchase_order_id = EXCLUDED.purchase_order_id,
  user_id           = EXCLUDED.user_id,
  content           = EXCLUDED.content,
  image_urls        = EXCLUDED.image_urls;

-- ═══ 11. คืนของ ══════════════════════════════════════════════════════
INSERT INTO maintenance.equipment_returns
  (id, org_id, purchase_order_id, property_id, created_by, item_name, qty, problem_type, reason,
   status, image_urls, resolution_note, resolved_by, resolved_at, created_at, updated_at)
SELECT r.id::text, :org, r.purchase_order_id::text, r.property_id::text, changyai_raw.uid(r.created_by),
       r.item_name, COALESCE(r.qty, 1), r.problem_type, r.reason, COALESCE(r.status, 'pending'),
       changyai_raw.jarr(r.image_urls), r.resolution_note,
       changyai_raw.uid(r.resolved_by), r.resolved_at, COALESCE(r.created_at, now()), now()
FROM changyai_raw.equipment_returns r
ON CONFLICT (id) DO UPDATE SET
  purchase_order_id = EXCLUDED.purchase_order_id,
  property_id       = EXCLUDED.property_id,
  created_by        = EXCLUDED.created_by,
  item_name         = EXCLUDED.item_name,
  qty               = EXCLUDED.qty,
  problem_type      = EXCLUDED.problem_type,
  reason            = EXCLUDED.reason,
  status            = EXCLUDED.status,
  image_urls        = EXCLUDED.image_urls,
  resolution_note   = EXCLUDED.resolution_note,
  resolved_by       = EXCLUDED.resolved_by,
  resolved_at       = EXCLUDED.resolved_at,
  updated_at        = now();

-- ═══ 12. ค่าใช้จ่าย ══════════════════════════════════════════════════
--
-- ท้ายสุด เพราะชี้ไปเกือบทุกตารางข้างบน
INSERT INTO maintenance.expenses
  (id, org_id, work_order_id, pm_schedule_id, purchase_order_id, property_id, created_by,
   description, amount, category, receipt_url, billable_to_partner, cost_type, paid_by,
   is_no_expense, expense_date, created_at)
SELECT e.id::text, :org, e.work_order_id::text, e.pm_schedule_id::text,
       e.purchase_order_id::text, e.property_id::text, changyai_raw.uid(e.created_by),
       e.description, COALESCE(e.amount, 0), e.category, e.receipt_url,
       COALESCE(e.billable_to_partner, FALSE), e.cost_type, e.paid_by,
       COALESCE(e.is_no_expense, FALSE), e.expense_date, COALESCE(e.created_at, now())
FROM changyai_raw.expenses e
ON CONFLICT (id) DO UPDATE SET
  work_order_id        = EXCLUDED.work_order_id,
  pm_schedule_id       = EXCLUDED.pm_schedule_id,
  purchase_order_id    = EXCLUDED.purchase_order_id,
  property_id          = EXCLUDED.property_id,
  created_by           = EXCLUDED.created_by,
  description          = EXCLUDED.description,
  amount               = EXCLUDED.amount,
  category             = EXCLUDED.category,
  receipt_url          = EXCLUDED.receipt_url,
  billable_to_partner  = EXCLUDED.billable_to_partner,
  cost_type            = EXCLUDED.cost_type,
  paid_by              = EXCLUDED.paid_by,
  is_no_expense        = EXCLUDED.is_no_expense,
  expense_date         = EXCLUDED.expense_date;

-- ═══ 13. ประวัติผู้รับเหมา ═══════════════════════════════════════════
INSERT INTO maintenance.contractor_history
  (id, org_id, contractor_id, work_order_id, property_id, description, amount, rating, work_date, created_at)
SELECT h.id::text, :org, h.contractor_id::text, h.work_order_id::text, h.property_id::text,
       h.description, COALESCE(h.amount, 0), h.rating, h.work_date, COALESCE(h.created_at, now())
FROM changyai_raw.contractor_history h
ON CONFLICT (id) DO UPDATE SET
  contractor_id = EXCLUDED.contractor_id,
  work_order_id = EXCLUDED.work_order_id,
  property_id   = EXCLUDED.property_id,
  description   = EXCLUDED.description,
  amount        = EXCLUDED.amount,
  rating        = EXCLUDED.rating,
  work_date     = EXCLUDED.work_date;

-- ═══ 14. ⚠ ตั้งตัวเดินเลขต่อ — ลืมข้อนี้แล้วพังวันรุ่งขึ้น ═══════════
--
-- core.document_counters ไม่รู้ว่าเพิ่ง insert ใบงานไปกี่ร้อยใบ มันยังคิดว่า
-- เลขถัดไปคือ 1 ⇒ ใบงานใบแรกที่คนสร้างหลัง import จะได้เลขซ้ำแล้ว insert ไม่ผ่าน
--
-- ไม่พังตอน import แต่ไปพังตอนใช้งานจริง ซึ่งหาสาเหตุยากกว่ามาก
--
-- นับจากจำนวนแถวจริงเสมอ ⇒ รันซ้ำก็ยังได้ค่าที่ถูกต้อง ไม่ต้องแก้อะไรเพิ่ม
INSERT INTO core.document_counters (org_id, doc_type, period, next_value)
SELECT :org, 'WO', :yr, COUNT(*) + 1 FROM maintenance.work_orders WHERE org_id = :org
ON CONFLICT (org_id, doc_type, period) DO UPDATE SET next_value = EXCLUDED.next_value;

INSERT INTO core.document_counters (org_id, doc_type, period, next_value)
SELECT :org, 'PO', :yr, COUNT(*) + 1 FROM maintenance.purchase_orders WHERE org_id = :org
ON CONFLICT (org_id, doc_type, period) DO UPDATE SET next_value = EXCLUDED.next_value;

-- ═══ 15. คนที่ยังไม่ได้จับคู่ — ถูกสร้างเป็นบัญชีใหม่ ═══════════════════════════════
--
-- 12 คนที่จับคู่ไว้แล้วในข้อ 1.0 งานเขาไปอยู่ใต้บัญชี Smartboss เดิมแล้ว
-- วิวนี้เหลือเฉพาะคนที่ยังไม่มีคู่ ⇒ ถูกสร้างเป็นบัญชีใหม่ที่ยังล็อกอินไม่ได้
-- เก็บเป็นวิวถาวรไว้ให้เปิดดูได้เรื่อย ๆ ไม่ต้องจำคำสั่ง
--
-- เรียงตามปริมาณงานจากมากไปน้อย — คนที่มีงานเยอะคือคนที่ต้องจับคู่ให้ถูกก่อน
CREATE OR REPLACE VIEW maintenance.v_imported_users AS
SELECT u.id,
       u.name  AS ชื่อในระบบเก่า,
       u.email AS อีเมล,
       u.line_user_id AS line_id,
       (SELECT count(*) FROM maintenance.work_orders w WHERE w.assigned_to = u.id) AS ใบงานที่รับผิดชอบ,
       (SELECT count(*) FROM maintenance.work_orders w WHERE w.created_by  = u.id) AS ใบงานที่เปิดเอง,
       (SELECT count(*) FROM maintenance.pm_schedules s WHERE s.assigned_to = u.id) AS แผน_pm,
       (u.email LIKE '%@changyai.invalid')  AS ต้องใส่อีเมลจริง,
       (u.password_hash = 'IMPORTED-NO-LOGIN') AS ยังตั้งรหัสผ่านไม่ได้
FROM core.users u
WHERE u.password_hash = 'IMPORTED-NO-LOGIN'
ORDER BY 5 DESC, 6 DESC;

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
\echo '  3. จับคู่ว่าใครคือใคร:  select * from maintenance.v_imported_users;'
\echo '     แล้วแก้ชื่อ/อีเมล และตั้งรหัสผ่านให้ทีละคนที่ /admin/users'
\echo '  4. เมื่อมั่นใจแล้วว่าจะไม่ import ซ้ำอีก ค่อย: DROP SCHEMA changyai_raw CASCADE;'
\echo '     (จะ sync ล่าสุดอีกรอบก่อนเลิกใช้ ChangYai ก็รันไฟล์นี้ซ้ำได้เลย ปลอดภัย)'
