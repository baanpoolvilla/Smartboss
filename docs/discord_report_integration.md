# Discord → SmartBoss Report Sync (ตัวชั่วคราว รอแอปมือถือ)

> เป้าหมาย: พนักงานส่ง "daily" ในห้อง Discord → ดึงเข้า SmartBoss → เก็บดิบ → ตัดสินผล
> โดยเทียบ **roster ของ HR + กฎรอบของห้อง** → หักคะแนนใน Module HR
> ถอดออกทั้งชุดได้เมื่อระบบตัวจริงเสร็จ โดยไม่แตะข้อมูลคะแนนเดิม
>
> เอกสารประกอบภาพ: artifact "Discord → SmartBoss Report Sync"

---

## 1. หลักการ

Discord = **แหล่งข้อมูลเข้า (input source) ชั่วคราว** เท่านั้น — ไม่ผูกกับ HR โดยตรง
ทั้งการเก็บ, การตัดสิน, การหักคะแนน อยู่ฝั่ง SmartBoss ทั้งหมด

```
Discord (#daily)
  → Bot/Sync   ── ดึง เวลา/รูป/คน/ห้อง, แปลง tz +7, map ตัวตน
  → POST /api/report-task/discord-ingest   (signed)
  → report_submissions        ── เก็บดิบ ต่อคน/วัน/รอบ (ตรวจย้อนหลังได้)
  → Decider                    ── เทียบ 3 อย่าง:
        ├─ roster ของ HR       (workforce.shift_assignments / attendance_results)
        ├─ กฎรอบของห้อง        (discord_channels: cutoff + minImages)
        └─ การส่งจริง          (เวลาโพสต์ + จำนวนรูป)
  → ผล: ON_TIME / LATE / MISSED / IMAGE_INCOMPLETE / EXEMPT
  → core.performance_events    (report_late −1 / report_missed −2)
  → /hr/performance (หัก+แสดง)  +  /admin/discord-reports (บอร์ดรายวัน)
```

**"วันนี้ต้องส่งไหม" ยึด roster จริงของ HR** (รองรับกะวน/วันหยุดไม่ตรงกัน)
ไม่ใช่ requiredWeekdays จันทร์–ศุกร์ตายตัว

---

## 2. ความพร้อม (เช็คกับโค้ดจริงแล้ว)

| ต้องใช้ | สถานะ | ของจริง |
|---|---|---|
| กะรายคนรายวัน (WORKING/OFF/LEAVE/HOLIDAY/NO_SHIFT) | ✅ ของเดิม | `workforce.shift_assignments`, `attendance_results` (is_rest_day / is_on_leave / is_holiday) |
| หักคะแนนเข้า HR | ✅ ของเดิม | `core.performance_events` + `recordPerformanceEvents()` — หมวด `report_late`/`report_missed` รออยู่ |
| อ่าน workforce ข้าม RLS | ✅ ของเดิม | pattern `workforce.performance_attendance()` (SECURITY DEFINER) |
| กันหักซ้ำ | ✅ ของเดิม | unique `(org_id, source, category, ref_type, ref_id)` |
| เก็บดิบ + lookup วันทำงาน | 🔨 สร้างใหม่ | `report_submissions`, `workforce.report_working_days()` |
| ผูกตัวตน + กฎห้อง | 🔨 สร้างใหม่ | `discord_links`, `discord_channels` |
| รับ+ตัดสิน + หน้าแอดมิน | 🔨 สร้างใหม่ | `/api/report-task/discord-ingest`, `/admin/discord-reports` |
| Discord bot | 🔨 สร้างใหม่ | บอทแยก (discord.js / discord.py) |

**ไม่มีจุดไหนต้องรอระบบอื่นเสร็จก่อน** — เหลือแค่สร้าง 6 ชิ้นล่าง

---

## 3. ตารางใหม่ (ทั้งหมดเป็นของชั่วคราว ลบทีเดียวจบ)

### 3.1 ผูกตัวตน + ผูกห้อง/กฎรอบ
```sql
-- ผูกด้วย Discord User ID (ชื่อ Discord เปลี่ยนได้)
CREATE TABLE report_task.discord_links (
  org_id          uuid NOT NULL,
  discord_user_id text NOT NULL,
  employee_id     uuid NOT NULL,           -- core.users.id
  PRIMARY KEY (org_id, discord_user_id)
);

-- ผูกด้วย Channel ID (ชื่อห้องซ้ำกันได้หลายแผนก)
CREATE TABLE report_task.discord_channels (
  org_id            uuid NOT NULL,
  discord_channel_id text NOT NULL,
  topic_id          text NOT NULL,          -- ล้อ ReportTopic
  rounds            jsonb NOT NULL,         -- [{label,time,minImages}] ล้อ cutoffs
  min_images        int  NOT NULL DEFAULT 0,
  required_weekdays int[] ,                 -- เผื่อห้องที่ไม่ผูก roster
  PRIMARY KEY (org_id, discord_channel_id)
);
```

### 3.2 เก็บการส่งดิบ — ต่อคน/วัน/รอบ
```sql
CREATE TABLE report_task.report_submissions (
  org_id        uuid NOT NULL,
  id            uuid PRIMARY KEY,
  employee_id   uuid,                       -- null = ยังผูกตัวตนไม่ได้
  discord_user_id text NOT NULL,
  channel_id    text NOT NULL,
  topic_id      text NOT NULL,
  round_id      text NOT NULL,              -- รอบไหนของวัน
  report_date   date NOT NULL,              -- วันของรายงาน (tz ไทย)
  posted_at     timestamptz,               -- เวลาส่งจริง (แปลง +7 แล้ว)
  message_id    text NOT NULL,             -- Discord msg id
  image_count   int  NOT NULL DEFAULT 0,
  content       text NOT NULL DEFAULT '',
  status        text,                      -- ผลหลังตัดสิน
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, message_id)              -- idempotent: sync ซ้ำไม่เพิ่มแถว
);
```
เก็บดิบก่อนตัดสิน → ตอบได้ว่า "ทำไมคนนี้โดนหัก": ส่งจริงไหม กี่โมง ห้องไหน รูปกี่ใบ
วันนั้น HR ว่าทำงานหรือหยุด กฎรอบคืออะไร ระบบตัดสินยังไง

### 3.3 SQL lookup วันทำงาน (ก๊อป pattern จาก performance_attendance)
```sql
-- คืน state รายคนรายวัน อ่าน workforce ข้าม RLS ผ่าน SECURITY DEFINER
CREATE OR REPLACE FUNCTION workforce.report_working_days(p_from date, p_to date)
RETURNS TABLE (subject text, work_date date, state text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = workforce, pg_temp
AS $$
  SELECT p.subject, ar.work_date,
    CASE
      WHEN ar.is_on_leave THEN 'LEAVE'
      WHEN ar.is_holiday  THEN 'HOLIDAY'
      WHEN ar.is_rest_day THEN 'OFF'
      WHEN ar.scheduled_in_at IS NOT NULL THEN 'WORKING'
      ELSE 'NO_SHIFT'
    END AS state
  FROM workforce.attendance_results ar
  JOIN workforce.employments e ON e.id = ar.employment_id
  JOIN workforce.principals  p ON p.person_id = e.person_id
  WHERE ar.is_current AND ar.work_date BETWEEN p_from AND p_to
    AND p.subject IS NOT NULL;
$$;
-- ⚠ ต้องตั้งเจ้าของเป็น workforce_lookup เหมือน 04-performance-lookup.sql
```
> ทางเลือก: ถ้ายังไม่มี `attendance_results` ของวันในอนาคต ให้ fallback อ่าน
> `shift_assignments` (status=PUBLISHED, shift.rest_day) โดยตรง

---

## 4. Endpoint + Decider

`POST /api/report-task/discord-ingest`
1. ตรวจ HMAC signature + `requireOrg()` (org มาจากการผูกห้อง ไม่รับจาก client)
2. upsert เข้า `report_submissions` (idempotent ด้วย message_id)
3. Decider — **รายรอบ**:
   - ถาม `report_working_days()` → ถ้า ≠ WORKING → **EXEMPT** (ไม่หัก)
   - ถ้า WORKING → เทียบแต่ละรอบ: `posted_at ≤ cutoff` ? และ `image_count ≥ minImages` ?
     - ก่อน cutoff + รูปครบ → **ON_TIME**
     - หลัง cutoff → **LATE**
     - ไม่มีโพสต์ในรอบ (เช็คตอนปิดรอบ) → **MISSED**
     - ส่งแต่รูปไม่ครบ → ธง **IMAGE_INCOMPLETE**
4. เขียน `performance_events` เฉพาะ LATE/MISSED

```ts
recordPerformanceEvents([{
  orgId, userId,
  source: "report_task",
  category: status === "late" ? "report_late" : "report_missed",
  occurredAt: new Date(reportDate),
  refType: "report_round",
  refId: `${reportDate}:${topicId}:${roundId}:${userId}`,  // กันหักซ้ำรายรอบ
  note: "จาก Discord",
}]);
```

> รูปจาก Discord CDN เป็น URL ชั่วคราว — ถ้าจะเก็บรูป ให้ดาวน์โหลดผ่าน
> `/api/report-task/uploads` เดิม ไม่เก็บ URL ของ Discord ตรง ๆ

---

## 5. หน้าแอดมิน `/admin/discord-reports` (3 แท็บ)

1. **ตรวจรายงาน** — ตารางรายวัน: พนักงาน · แผนก · HR วันนี้ · รอบ · กำหนด · ส่งจริง · รูป · ผล
   + filter (วันที่/แผนก/ห้อง/สถานะ/คน) + ปุ่ม **Sync Discord** (force)
2. **ตั้งค่าห้องและกฎ** — ผูก Channel ID → topic + ตั้งรอบ (cutoff/minImages) ต่อแผนก
3. **ผูกพนักงาน** — Discord User ID → Employee

---

## 6. เรื่องต้องระวัง

1. **Timezone** — Discord = UTC ต้องแปลง +7 ก่อนเทียบ cutoff เสมอ
2. **รายรอบ** — คิดแยกเช้า/เย็น (เข้มกว่าหน้า report เดิมที่คิดรายวัน) → refId ต้องรวม `roundId`
3. **มาส่งทีหลัง** — เคย MISSED แล้วมาส่ง: ยิงตัวใหม่ + ต้องมีทางถอน event เดิม
   (หรือปิดรอบแล้วล็อกผลตามจริง ณ เวลานั้น — ตัดสินใจตอนทำ)
4. **ผูกตัวตนไม่ได้** — เก็บ submission ไว้ (employee_id null) ไม่หักจนกว่าจะผูก
5. **ปิดคะแนนได้** — `performance_settings.enabled=false` ระบบไม่บันทึก (เช็คแล้วในโค้ด)

---

## 7. ตอนเลิกใช้ (แอปมือถือเสร็จ)

ปิด/ลบได้ทันที: Bot, Discord token, `discord_links`, `discord_channels`,
`report_submissions`, หน้า `/admin/discord-reports`, ingest route

**ไม่ต้องรื้อ:** HR, Performance, `performance_events`, คะแนน/ประวัติเดิม
เพราะคะแนนเก็บเป็นเหตุการณ์ถาวร แยกจากตัว Discord แล้ว

---

## สรุป

ทำได้ทั้งฉบับตอนนี้ — แพลตฟอร์มพร้อมหมด (roster, attendance, performance_events, การเข้าถึง
workforce) เหลือสร้าง 6 ชิ้น ที่ isolate และถอดทิ้งง่ายตามเจตนา "ตัวชั่วคราว"
