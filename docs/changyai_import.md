# ย้ายข้อมูลจาก ChangYai (Supabase) เข้า Smartboss

> โครงตารางตรงกันแล้วตั้งแต่ 2026-08-13 — เอกสารนี้บอกวิธีย้าย **ข้อมูล**
> การวิเคราะห์ตอน port ครั้งแรกอยู่ที่ [`maintenance_port_plan.md`](maintenance_port_plan.md)

---

## ขั้นที่ 0 — ดึงข้อมูลออกจาก Supabase

> ⚠ โปรเจกต์เป็น **Free plan ⇒ ไม่มี backup อัตโนมัติเลย** (`LAST BACKUP: No backups`)
> การ dump ครั้งนี้จึงเป็นสำเนาชุดแรกที่มี — **เก็บไฟล์ที่ได้ไว้ให้ดี อย่าลบ**

### 0.1 เอาสายเชื่อมต่อ

Supabase → ปุ่ม **Connect** (บนสุด) → แท็บ **Session pooler** → คัดลอก URI

หน้าตาประมาณนี้
```
postgresql://postgres.ytrfgetdrtjrjfhvcqgt:[YOUR-PASSWORD]@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres
```

แทน `[YOUR-PASSWORD]` ด้วยรหัสผ่านฐานข้อมูล (Settings → Database → Reset ได้ถ้าจำไม่ได้)

### 0.2 dump เฉพาะข้อมูล — รันบนเซิร์ฟเวอร์เรา 🅱

`pg_dump` ต้องเวอร์ชันตรงกับต้นทาง ⇒ เรียกผ่านคอนเทนเนอร์ Postgres ที่มีอยู่แล้ว

```bash
cd /opt/smartboss
read -rsp "วาง connection string ของ Supabase: " SB; echo

sudo -u smartboss docker compose -f deploy/docker-compose.yml exec -T postgres \
  pg_dump --data-only --no-owner --no-privileges --schema=public "$SB" > /tmp/changyai.sql

ls -lh /tmp/changyai.sql
```

ไฟล์ต้องมีขนาดมากกว่าศูนย์ ถ้าได้ 0 ไบต์แปลว่าต่อไม่ติด

**คัดลอกเก็บไว้นอกเครื่องด้วยทันที** — นี่คือสำเนาชุดเดียวที่มีของระบบเก่า

### 0.3 โหลดเข้า schema พัก — เอาเฉพาะตาราง

**ห้ามโหลด dump เข้า `public` ของเราโดยตรง** — ชื่อตารางชนกัน
และข้อมูลต้นทางยังไม่มี `org_id` ⇒ จะปนกับของจริงแล้วแยกไม่ออก

```bash
sudo bash deploy/backup.sh

cp /tmp/changyai-schema.sql /tmp/s.sql
cp /tmp/changyai.sql        /tmp/d.sql

# โครงตาราง — ไม่มีข้อมูลปน แทนที่ได้กว้าง
sed -i 's/public\./changyai_raw./g' /tmp/s.sql

# ข้อมูล — แตะเฉพาะหัวบรรทัด COPY กับ setval เท่านั้น
sed -i "s/^COPY public\./COPY changyai_raw./; s/^SELECT pg_catalog\.setval('public\./SELECT pg_catalog.setval('changyai_raw./" /tmp/d.sql
```

> ⚠ อย่าแทนที่ `public.` ทั้งไฟล์ของไฟล์ข้อมูล — ถ้ามีข้อความไหน
> ในข้อมูลลงท้ายว่า "public." จะถูกแก้ไปด้วยแบบเงียบ ๆ

**โหลดเฉพาะ CREATE TABLE ทิ้ง FK/policy/trigger/grant ทั้งหมด**

ตารางหลัก  8 ตัวของ ChangYai มี FK ชี้ไป `auth.users` ของ Supabase
โหลดโครงสร้างทั้งก้อนจะล้มเป็นลูกโซ่ (เจอจริง: สร้างได้แค่ 10/18 ตาราง)

```bash
awk '/^CREATE (TABLE|TYPE) /{p=1} p{print} /^\);?$/{if(p){print ""; p=0}}' /tmp/s.sql > /tmp/tables.sql
grep -c "^CREATE TABLE" /tmp/tables.sql    # ต้องได้ 18

sudo bash deploy/psql.sh -c "
  CREATE SCHEMA IF NOT EXISTS extensions;
  CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\" SCHEMA extensions;"

sudo bash deploy/psql.sh -c "DROP SCHEMA IF EXISTS changyai_raw CASCADE; CREATE SCHEMA changyai_raw;"
sudo bash deploy/psql.sh -f /tmp/tables.sql
sudo bash deploy/psql.sh -f /tmp/d.sql
```

`uuid_generate_v4()` ถูกใช้ใน DEFAULT ของคอลัมน์ ⇒ ยังต้องมี schema `extensions`
ไม่มี FK ในตารางพัก ⇒ ลำดับการโหลดไม่สำคัญ

 ไม่ใช่ทับของจริง

**ห้ามโหลด dump เข้า `public` ของเราโดยตรง** — ชื่อตารางชนกัน และข้อมูลต้นทางยังไม่มี `org_id` ⇒ จะปนกับของจริงแล้วแยกไม่ออก

```bash
# สำรองก่อนเสมอ
sudo bash deploy/backup.sh

# เปลี่ยนชื่อ schema ใน dump จาก public → changyai_raw
sed -i 's/^SET search_path = public/SET search_path = changyai_raw/; s/\bpublic\./changyai_raw./g' /tmp/changyai.sql

sudo bash deploy/psql.sh -c "CREATE SCHEMA IF NOT EXISTS changyai_raw;"
sudo bash deploy/psql.sh -f /tmp/changyai.sql
```

> ⚠ `--data-only` ไม่มีคำสั่ง `CREATE TABLE` ⇒ ต้องมีตารางใน `changyai_raw` ก่อน
> ทางที่ง่ายกว่าคือ dump อีกชุดแบบ `--schema-only` แล้วโหลดก่อน (ทำ `sed` เหมือนกัน)

### 0.4 แปลงเข้าระบบเรา

```bash
sudo bash deploy/psql.sh -c "select id, code, name from core.organizations;"

sudo bash deploy/psql.sh \
  -v org="'<uuid ที่ได้จากคำสั่งข้างบน>'" -v yr="'2568'" \
  -f deploy/import-changyai.sql
```

สคริปต์อยู่ใน **transaction เดียว — พังตรงไหนก็ย้อนกลับหมด ไม่มีข้อมูลค้างครึ่ง ๆ**

ถ้า error บอกว่าคอลัมน์ไหนไม่มี ส่งข้อความมา ผมแก้สคริปต์ให้

---

### 0.5 จับคู่ว่าใครคือใคร — ทำทีหลัง import

สคริปต์ย้ายผู้ใช้มา**ทุกคน** พร้อมชื่อเดิมจากระบบเก่า แต่ล็อกอินไม่ได้
เปิดดูรายชื่อเพื่อมาจับคู่ทีหลังได้

```bash
sudo bash deploy/psql.sh -c "select * from maintenance.v_imported_users;"
```

เรียง**จากคนที่มีงานเยอะสุดลงมา** เพราะจับคู่คนเหล่านี้ผิดกระทบมากสุด

| คอลัมน์ | บอกอะไร |
|---|---|
| ใบงานที่รับผิดชอบ / ใบงานที่เปิดเอง | ใช้เดาว่าคนนี้คือใคร แม้ชื่อในระบบเก่าจะกำกวม |
| `ต้องใส่อีเมลจริง` | คนที่ระบบเก่าไม่มีอีเมล — ตอนนี้เป็น `@changyai.invalid` |
| `ยังตั้งรหัสผ่านไม่ได้` | เป็น true ทุกคนที่ import มา |

แก้ชื่อ/อีเมล และตั้งรหัสผ่านทีละคนที่ `/admin/users`

> ⚠ **อีเมลที่ตรงกับบัญชีที่มีอยู่แล้วจะไม่ถูกสร้างซ้ำ** — สคริปต์ชี้งานเก่า
> มาที่บัญชีเดิมให้อัตโนมัติ เช่นงานที่คุณเปิดเองในระบบเก่าจะมาอยู่ใต้ชื่อคุณเลย

---

## ขั้นที่ 0.6 — รูปภาพ ⚠ **ไม่มากับ pg_dump**

`pg_dump` ดึงเฉพาะฐานข้อมูล · รูปอยู่ใน **Supabase Storage** ซึ่งเป็นที่เก็บไฟล์คนละระบบ
ในฐานข้อมูลมีแค่ URL ที่ชี้ไปหาไฟล์ ⇒ **ย้ายแต่ฐานข้อมูล = รูปทุกใบพังทันทีที่ปิดโปรเจกต์เดิม**

ทั้งสองฝั่งพูด S3 ได้ จึงก๊อปตรงเข้า MinIO ของเราได้เลย ไม่ต้องดาวน์โหลดลงเครื่องก่อน

### 0.6.1 เอากุญแจ S3 ของ Supabase

Supabase → **Project Settings → Storage → S3 Connection** → **New access key**

จดไว้ 3 ค่า: `endpoint` · `access key id` · `secret access key`
(endpoint หน้าตาแบบ `https://ytrfgetdrtjrjfhvcqgt.supabase.co/storage/v1/s3`, region `ap-southeast-2`)

### 0.6.2 ก๊อปไฟล์เข้า MinIO — รันบนเซิร์ฟเวอร์ 🅱

```bash
cd /opt/smartboss
set -a; . /etc/smartboss/smartboss.env; set +a     # เอาคีย์ MinIO ของเราออกมา

sudo -u smartboss docker run --rm -it --network host \
  -e RCLONE_CONFIG_SB_TYPE=s3 -e RCLONE_CONFIG_SB_PROVIDER=Other \
  -e RCLONE_CONFIG_SB_ENDPOINT="https://ytrfgetdrtjrjfhvcqgt.supabase.co/storage/v1/s3" \
  -e RCLONE_CONFIG_SB_REGION=ap-southeast-2 \
  -e RCLONE_CONFIG_SB_ACCESS_KEY_ID="<access key ของ Supabase>" \
  -e RCLONE_CONFIG_SB_SECRET_ACCESS_KEY="<secret ของ Supabase>" \
  -e RCLONE_CONFIG_MN_TYPE=s3 -e RCLONE_CONFIG_MN_PROVIDER=Minio \
  -e RCLONE_CONFIG_MN_ENDPOINT="http://127.0.0.1:9000" \
  -e RCLONE_CONFIG_MN_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
  -e RCLONE_CONFIG_MN_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
  rclone/rclone copy -P SB:<ชื่อ bucket เดิม> MN:smartboss/maintenance/imported
```

`<ชื่อ bucket เดิม>` ดูได้ที่ Supabase → Storage (น่าจะชื่อ `work-order-photos` หรือคล้ายกัน)

> ทำไมวางไว้ใต้ `maintenance/imported/` — **ให้ path เดิมของ Supabase คงรูปเดิมทั้งหมด**
> พอ key ตรงกัน การแก้ URL ในฐานข้อมูลจึงเป็นแค่การเปลี่ยนส่วนหน้า ไม่ต้องไล่จับคู่ทีละไฟล์

### 0.6.3 แก้ URL ในฐานข้อมูล

Supabase เก็บเป็น URL เต็ม `https://xxx.supabase.co/storage/v1/object/public/<bucket>/<path>`
ของเราเก็บเป็น path สัมพัทธ์ `/api/files/<key>` ⇒ ตัดส่วนหน้าทิ้งแล้วใส่ของเราแทน

```bash
sudo bash deploy/psql.sh -v org="'<uuid บริษัท>'" -f deploy/import-changyai-images.sql
```

### 0.6.4 ตรวจ

```bash
# ต้องได้ 0 ทุกบรรทัด = ไม่เหลือ URL ที่ยังชี้ไป Supabase
sudo bash deploy/psql.sh -c "
select 'assets'   t, count(*) from maintenance.assets   where image_url   like '%supabase%'
union all select 'expenses', count(*) from maintenance.expenses where receipt_url like '%supabase%'
union all select 'work_orders', count(*) from maintenance.work_orders
  where array_to_string(photo_urls,',') like '%supabase%';"
```

แล้ว**เปิดเว็บกดดูรูปจริงสักใบ** — ผ่านตรงนี้ถึงจะถือว่าย้ายรูปสำเร็จ

> ⚠ **อย่าเพิ่งลบโปรเจกต์ Supabase จนกว่าจะเปิดรูปได้จริง** เป็นที่เดียวที่ยังมีไฟล์ต้นฉบับ

---

## ข่าวดี — `id` เป็น UUID ทั้งสองระบบ

ยกไอดีเดิมมาใช้ได้ตรง ๆ ⇒ **ความสัมพันธ์ระหว่างตารางไม่ขาด** ไม่ต้องทำตารางแปลงไอดี
ใบงานที่ชี้ไปบ้านหลังไหน คอมเมนต์ที่อยู่ใต้ใบงานไหน ยังตรงเหมือนเดิมทั้งหมด

**ห้ามให้ Postgres สร้าง id ใหม่ตอน insert** — ใส่ค่า `id` ที่ export มาเสมอ

---

## 5 อย่างที่ไม่ยกมาตรง ๆ — ต้องแปลงก่อน

### 1. `org_id` — ทุกแถวต้องมี

ChangYai เป็นระบบของบริษัทเดียว ไม่มีคอลัมน์นี้ · Smartboss แยกข้อมูลตามบริษัทด้วยคอลัมน์นี้

```sql
-- หาไอดีบริษัทปลายทางก่อน แล้วใช้ค่าเดียวกันทุกตาราง
SELECT id, code, name FROM core.organizations;
```

⚠ **ใส่ผิดบริษัท = ข้อมูลไปโผล่ในบริษัทอื่น** ตรวจก่อน insert เสมอ

### 2. `code` — Smartboss บังคับ ChangYai ไม่มี

`work_orders.code` และ `purchase_orders.code` เป็น `NOT NULL` + `UNIQUE(org_id, code)`
แต่ ChangYai ไม่มีเลขที่เอกสารให้คนอ่าน ⇒ **ต้องสร้างตอน import**

```sql
-- ไล่เลขตามลำดับเวลาที่สร้าง เพื่อให้เลขเรียงตรงกับความเป็นจริง
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS n
  FROM maintenance.work_orders WHERE org_id = :org
)
UPDATE maintenance.work_orders w
SET code = 'WO-2568-' || LPAD(n::TEXT, 4, '0')
FROM numbered WHERE w.id = numbered.id;
```

> ใช้ปี พ.ศ. ของ **ข้อมูลเก่า** (เช่น 2568) แยกจากของใหม่ที่จะเดินต่อในปีปัจจุบัน
> จะได้ดูออกว่าใบไหนมาจากระบบเดิม

### ⚠ 2.1 ต้องตั้งตัวเดินเลขต่อ ไม่งั้นใบงานใบถัดไปชนกัน

`core.document_counters` ไม่รู้ว่าคุณเพิ่ง insert ไป 800 ใบ มันยังคิดว่าเลขถัดไปคือ 1
⇒ **ใบงานใบแรกที่สร้างหลัง import จะได้เลขซ้ำแล้ว insert ไม่ผ่าน**

```sql
INSERT INTO core.document_counters (org_id, doc_type, period, next_value)
VALUES (:org, 'WO', '2568', (SELECT COUNT(*) + 1 FROM maintenance.work_orders WHERE org_id = :org))
ON CONFLICT (org_id, doc_type, period) DO UPDATE SET next_value = EXCLUDED.next_value;
```

ทำแบบเดียวกันกับ `'PO'`

### 3. ผู้ใช้ — ย้ายเข้า `core.users` ก่อนตารางอื่นทั้งหมด

ทุกตารางชี้มาที่ผู้ใช้ (`assigned_to`, `created_by`, `cc_user_ids[]`) ⇒ ต้องมาก่อน

| ChangYai `users` | Smartboss `core.users` |
|---|---|
| `id` | `id` (ยกมาตรง ๆ) |
| `email` | `email` — ⚠ **ต้องไม่ซ้ำทั้งแพลตฟอร์ม** ไม่ใช่แค่ในบริษัท |
| `name` | `name` |
| `line_user_id` | `line_user_id` |
| `phone` | ไม่มีที่เก็บใน core — ถ้าจำเป็นให้ไปอยู่ในโมดูลบุคคล |
| `role` (`admin`/`owner`/`manager`/`caretaker`/`technician`) | ต้องแปลงเป็นแถวใน `core.user_roles` |
| — | `password_hash` **บังคับ** — ChangYai ใช้ Supabase Auth รหัสผ่านย้ายมาไม่ได้ |

**รหัสผ่านย้ายมาไม่ได้** (คนละวิธีเข้ารหัส) ⇒ ต้องตั้งรหัสชั่วคราวให้ทุกคนแล้วให้เปลี่ยนเอง
หรือใช้ปุ่ม "ตั้งรหัสผ่านใหม่" ในหน้าผู้ใช้ทีละคน

การแปลงบทบาท:
```
admin      → SUPER_ADMIN (ระดับแพลตฟอร์ม ให้เฉพาะเจ้าของระบบ)
owner      → CEO
manager    → MANAGER
caretaker  → มอบสิทธิ์ maintenance.* ที่ตรงกับที่เคยได้
technician → TECHNICIAN
```

### 4. รูปภาพ — ต้องคัดลอกไฟล์จริง ไม่ใช่แค่ย้าย URL

ChangYai เก็บรูปที่ Supabase Storage และเก็บ **URL เต็ม** ลงฐานข้อมูล
Smartboss เก็บที่ MinIO และเก็บเป็น **path สัมพัทธ์** `/api/files/<key>`

คอลัมน์ที่มีรูป:
```
work_orders.photo_urls[]              work_orders.after_photo_urls[]
work_order_comments.image_urls[]      work_order_external_photos.storage_path
purchase_orders.receipt_image_urls[]  purchase_orders.pr_image_urls[]
purchase_order_comments.image_urls[]  assets.image_url
expenses.receipt_url                  equipment_returns.image_urls[]
```

ขั้นตอน: ดาวน์โหลดจาก Supabase → อัปขึ้น MinIO ด้วย key ใหม่ → แก้ค่าในฐานข้อมูลเป็น
`/api/files/<key ใหม่>`

⚠ **อย่าเก็บ URL เต็มของโดเมนลงฐานข้อมูล** — ตอนย้ายโดเมนจะพังทั้งหมด
(ระบบเราออกแบบให้เก็บ path สัมพัทธ์ด้วยเหตุผลนี้ ดู `docs/deploy.md` ข้อ 11.8)

### 5. ตารางที่ไม่ต้องย้าย

| ตาราง | ทำไม |
|---|---|
| `app_settings` | มีแค่ LINE token → กรอกใหม่ที่ `/maintenance/settings` |
| `work_order_upload_links` | ลิงก์อัปโหลดชั่วคราวสำหรับช่างนอก อายุสั้น หมดอายุไปแล้ว |
| `line_notification_logs` | คนละโครงสร้าง เป็น log ย้อนหลัง ไม่มีใครอ่าน |
| `notifications` | แจ้งเตือนที่อ่านไปแล้ว ย้ายมาก็รกเปล่า ๆ |

---

## ลำดับการ insert — ห้ามสลับ (FK จะไม่ผ่าน)

```
1. core.users                      ← ก่อนทุกอย่าง
2. maintenance.property_categories
3. maintenance.properties
4. maintenance.assets              (ต้องมี properties ก่อน)
5. maintenance.contractors
6. maintenance.pm_schedules        (ต้องมี properties/assets)
7. maintenance.work_orders         (ต้องมี properties/assets/pm_schedules)
8. maintenance.work_order_comments
9. maintenance.work_order_external_photos
10. maintenance.purchase_orders
11. maintenance.purchase_order_comments
12. maintenance.equipment_returns
13. maintenance.expenses           ← ท้ายสุด ชี้ไปทุกอย่าง
14. maintenance.contractor_history
```

แล้วค่อยรัน SQL ตั้ง `code` (ข้อ 2) และตัวเดินเลข (ข้อ 2.1)

---

## ตรวจหลัง import

```sql
-- 1. จำนวนแถวตรงกับต้นทางไหม
SELECT 'work_orders' t, COUNT(*) FROM maintenance.work_orders WHERE org_id = :org
UNION ALL SELECT 'properties', COUNT(*) FROM maintenance.properties WHERE org_id = :org
UNION ALL SELECT 'expenses',   COUNT(*) FROM maintenance.expenses   WHERE org_id = :org;

-- 2. ไม่มีแถวไหนหลุด org (ต้องได้ 0 ทุกตาราง)
SELECT COUNT(*) FROM maintenance.work_orders WHERE org_id IS NULL OR org_id <> :org;

-- 3. code ไม่ซ้ำและไม่ว่าง (ต้องได้ 0)
SELECT COUNT(*) FROM maintenance.work_orders WHERE org_id = :org AND (code IS NULL OR code = '');
SELECT code, COUNT(*) FROM maintenance.work_orders WHERE org_id = :org
GROUP BY code HAVING COUNT(*) > 1;

-- 4. ผู้ใช้ที่ถูกอ้างถึงมีอยู่จริงทุกคน (ต้องได้ 0)
SELECT COUNT(*) FROM maintenance.work_orders w
WHERE w.assigned_to IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM core.users u WHERE u.id = w.assigned_to);
```

**แล้วเปิดเว็บดูจริง** — สร้างใบงานใหม่หนึ่งใบ ต้องได้เลขที่ถัดจากของเก่า ไม่ใช่ชนกัน

---

## ก่อนเริ่ม — สำรองก่อนเสมอ

```bash
sudo bash /opt/smartboss/deploy/backup.sh
```

import ผิดแล้วย้อนยาก เพราะข้อมูลปนกับของเดิมไปแล้ว การกู้จาก backup ตรงกว่า
