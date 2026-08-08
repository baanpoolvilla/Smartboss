# โมดูลรายงานและงาน (`report_task`) — วิธีดึงโค้ดเวอร์ชันใหม่มาทับ

โมดูลนี้พอร์ตมาจากแอป [easyboss-workspace](https://github.com/baanpoolvilla/easyboss-workspace)
ที่เคยรันเดี่ยว ๆ **UI ทั้งหมดเป็นของต้นทาง ห้ามแก้ที่นี่** — แก้ที่ repo ต้นทางแล้วดึงมาทับ

สิ่งที่ Smartboss เป็นเจ้าของมีแค่ 3 อย่าง: การผูกเข้ากับ shell, ธีม, และ **ชั้นข้อมูล**

---

## ทำไมต้องมีขั้นตอน ไม่ใช่ก๊อปวาง

| เรื่อง | ต้นทาง | ที่นี่ |
|---|---|---|
| เก็บข้อมูล | ไฟล์ JSON ใน `data/` | **Postgres `report_task.stores` แยกตามบริษัท** |
| ตัวตน | สลับ "ดูในนามของ" ฝั่ง client | session ของ Smartboss |
| ไฟล์อัปโหลด | `public/uploads/` เปิดสาธารณะ | ชั้นเก็บไฟล์กลาง (S3/ดิสก์) ผ่าน `/api/files` ที่ต้อง login |
| shell | sidebar/topbar ของตัวเอง | `AppScaffold` ของ Smartboss |
| TypeScript | ไม่เปิด `noUncheckedIndexedAccess` | เปิด |
| path | `@/components/...` | `@/modules/report_task/components/...` |

---

## ขั้นตอน

```bash
# 0) ดึงเวอร์ชันใหม่
cd <ที่เก็บ clone>/easyboss-workspace && git pull

# 1) ทับโค้ด — เก็บไฟล์ของ Smartboss ไว้ก่อน
#    constants.ts  manifest.ts  permissions.ts  theme.css
#    components/shared/report-task-scaffold.tsx
#    lib/nav-config.ts  lib/db/org-store.ts  lib/db/ics-link-repo.ts
```

คัดลอก `src/{components,lib,store,types,hooks,data}` → `apps/web/modules/report_task/`
(ทิ้ง `components/layout/` — shell เป็นของ Smartboss แต่ **เก็บ** `store-hydrator.tsx`,
`task-sync.tsx`, `server-store-sync.tsx` ย้ายไป `components/shared/`)

คัดลอก `src/app/{page.tsx,tasks,calendar,reports,report-feed,activity-log,settings,practice}`
→ `apps/web/app/(shell)/report-task/` และ `src/app/api/*` → `apps/web/app/api/report-task/`

```bash
# 2) เขียน import path ใหม่ — @/x/ → @/modules/report_task/x/
#    (components, lib, store, hooks, data, types)

# 3) เขียน API path ใหม่ — /api/x → /api/report-task/x
#    (google-calendar, holidays, store, tasks, uploads)

# 4) ธีม — สกัดใหม่ทุกครั้ง เพราะต้นทางเปลี่ยนสีได้
python scripts/extract-report-task-theme.py \
  <workspace>/src/app/globals.css \
  apps/web/modules/report_task/theme.css

# 5) ปรับให้ผ่าน noUncheckedIndexedAccess
python scripts/fix-report-task-strict-index.py .

# 6) ตรวจ
pnpm --filter @smartboss/web typecheck
```

สคริปต์ข้อ 5 จะบอกว่าจุดไหน "หาไม่เจอ" — แปลว่าต้นทางแก้โค้ดตรงนั้นแล้ว
ต้องไปดู error จาก `tsc` แล้วเพิ่มรายการใหม่เข้าไปในสคริปต์

---

## ชั้นข้อมูล — จุดเดียวที่ต้องดูแล

ฝั่ง client เก็บสถานะที่แชร์กันทั้งทีมไว้ใน zustand ~15 store แล้วเขียนกลับผ่าน
**endpoint เดียว** `PUT /api/report-task/store/{key}` (กับ `/tasks` อีกตัว)
ทั้งหมดลงตารางเดียว

```
report_task.stores(org_id, key, data jsonb, version, updated_at, updated_by)
PRIMARY KEY (org_id, key)
```

⇒ เพิ่ม store ใหม่ฝั่ง client ไม่ต้องแก้ฐานข้อมูล แค่เติมคีย์ใน
`lib/db/store-registry.ts` (whitelist กันไม่ให้ client ยิงคีย์มั่ว)

**`org_id` มาจาก session เท่านั้น ไม่เคยรับจาก client** — ทุก route เรียก
`requireOrg()` ก่อนแตะข้อมูล บริษัทหนึ่งจึงอ่าน/เขียนของอีกบริษัทไม่ได้แม้เดาคีย์ถูก

`version` = optimistic concurrency กันสองแท็บเขียนทับกัน — client ส่ง
`expectedVersion` มา ถ้าไม่ตรงจะได้ **409** ให้โหลดใหม่ การตรวจกับการเขียนอยู่ใน
คำสั่งเดียว (`updateMany` ที่มี version ในเงื่อนไข) ถ้าแยกเป็นอ่านแล้วค่อยเขียน
สองคำขอที่มาพร้อมกันจะผ่านการตรวจทั้งคู่แล้วทับกัน

### route ที่ Smartboss เขียนเอง (ไม่ใช่ของต้นทาง)

| route | ทำอะไร |
|---|---|
| `store/[key]` | อ่าน/เขียนก้อน JSON ต่อคีย์ ต่อบริษัท |
| `tasks` | เหมือนข้างบน + ตรวจรูปร่างด้วย zod |
| `tasks/sweep` | หักคะแนนงานเลยกำหนด — คำนวณที่เซิร์ฟเวอร์ครั้งเดียว |
| `uploads` | ผ่านชั้นเก็บไฟล์กลาง key นำหน้าด้วย orgId |
| `google-calendar/{link,status,events}` | ลิงก์ ICS ต่อผู้ใช้ ต่อบริษัท |

---

## คีย์ที่ไม่ได้เก็บใน report_task.stores

สามคีย์นี้ **สร้างจากแหล่งอื่นทุกครั้งที่อ่าน** — โมดูลไม่ได้เป็นเจ้าของข้อมูล

| คีย์ | แหล่งจริง | เขียนได้ไหม |
|---|---|---|
| `employees` | `core.users` ของบริษัท | เขียนได้เฉพาะแผนก/ตำแหน่ง/ตัวย่อ (เก็บใน `employee-profiles`) ชื่อ/อีเมลแก้ที่ `/admin` |
| `leaves` | `workforce.leave_requests` (เฉพาะที่อนุมัติแล้ว) | **ไม่ได้** — ตอบ 409 ให้ไปยื่นที่ `/hr` |
| `holidays` | `workforce.holiday_dates` | **ไม่ได้** — ตอบ 409 ให้ตั้งค่าที่ `/hr` |

เหตุผลที่ไม่ให้เขียน: ถ้ารับเขียนแล้วเก็บไว้ ข้อมูลจะไม่ถูกอ่านกลับ (GET อ่านจากแหล่งจริง)
กลายเป็นหายเงียบ ๆ ทั้งที่ผู้ใช้เห็นว่าบันทึกแล้ว — และ**เงินเดือนคำนวณจากการลาของ
workforce เท่านั้น** การมีข้อมูลลาสองชุดจึงทำให้ปฏิทินกับสลิปไม่ตรงกัน

การอ่านจาก workforce ตั้ง tenant context แล้วให้ RLS ทำงานตามปกติ (ไม่ใช้ทางลัดข้าม RLS)
เพราะ tenant ของ workforce ใช้ id เดียวกับ `core.organizations` — ดู `lib/db/workforce-calendar.ts`

## ที่ยังค้าง

**ปฏิทินยังไม่มีตัวกรองช่วงวัน** — `GET /store/leaves` กับ `/store/holidays` คืนช่วง
−6 ถึง +12 เดือนตายตัว เพราะสัญญาเดิมของ store ไม่มีที่ส่งพารามิเตอร์
ถ้าข้อมูลเยอะขึ้นควรเปลี่ยนเป็น endpoint ที่รับ from/to

**lint ข้ามโฟลเดอร์นี้ไว้** (`eslint.config.mjs`) เพราะเป็นโค้ดต้นทางที่ไม่ควรแก้สไตล์ที่นี่
