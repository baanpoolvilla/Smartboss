# โมดูลรายงานและงาน (`report_task`)

> ## ⚠ อ่านก่อน — กฎเปลี่ยนแล้วเมื่อ 2026-08-11
>
> โมดูลนี้เคยพอร์ตมาจาก [easyboss-workspace](https://github.com/baanpoolvilla/easyboss-workspace)
> และมีกฎว่า **ห้ามแก้ UI ที่นี่** เพราะจะถูกเขียนทับตอนดึงเวอร์ชันใหม่
>
> **ตอนนี้ Smartboss เป็นเจ้าของเต็มตัว — แก้ได้ทุกอย่างที่นี่ ทั้ง UI และชั้นข้อมูล**
> ไม่ดึงจาก upstream อีกแล้ว (เหตุผล: ทีมจะเข้ามาแก้ UI จริง การสลับสอง repo
> แล้วรอคนดึงมาทับไม่คุ้มอีกต่อไป)
>
> เอกสารที่เหลือด้านล่างเก็บไว้เพื่อ **บอกว่าโค้ดชุดนี้ต่างจากต้นทางตรงไหน** —
> เป็นความรู้ที่ยังจำเป็นเวลาอ่านโค้ดว่าทำไมบางอย่างถึงเขียนแบบนั้น
> ส่วนขั้นตอน "ดึงมาทับ" ไม่ใช้แล้ว เก็บไว้เผื่อวันหนึ่งอยากหยิบของใหม่จาก upstream
> ซึ่งวันนั้นจะไม่ใช่การทับ แต่ต้องไล่ merge ทีละไฟล์

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

**ยกเว้นงานในบอร์ด** — ตั้งแต่ 2026-08-11 ย้ายออกจาก `stores` ไปเป็นตารางจริงแล้ว

```
report_task.tasks(org_id, id, code, title, status, priority, task_mode,
                  assigned_by_id, assignee_ids, parent_id, start_date,
                  due_date, completed_at, data jsonb, created_at, updated_at)
PRIMARY KEY (org_id, id) · UNIQUE (org_id, code)

report_task.task_collections(org_id, version, updated_at, updated_by)
```

สัญญากับ client เหมือนเดิมทุกอย่าง (ส่งงานมาทั้งชุด รับทั้งชุด) — `lib/db/task-repo.ts`
แปลงเป็น insert/update/delete รายแถวให้ จึงไม่ต้องแตะ UI ต้นทางเลย

`data` คือแหล่งความจริงของตัวงาน ส่วนคอลัมน์อื่นเป็นสำเนาที่คัดออกมาให้ query ได้
เขียนจากฟังก์ชันเดียว (`columnsOf`) เสมอ จึงไม่มีทางไม่ตรงกัน — ที่ไม่แตกทุกฟิลด์
เป็นคอลัมน์เพราะตัวงานมีโครงสร้างซ้อนอีกสิบกว่าชุดที่ UI ต้นทางปรับรูปร่างได้ตลอด

`code` (T-2569-0001) เซิร์ฟเวอร์เป็นคนตั้ง ผูกกับ id ของงาน — client ไม่ต้องรู้จัก
และ zod schema ก็คัดทิ้งอยู่แล้ว **แก้งานแล้วเลขไม่เปลี่ยน · ลบแล้วเลขไม่ถูกใช้ซ้ำ**

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

## บันทึกการดึงแต่ละรอบ

### 2026-08-11 — `51b5fbb` → `57670ec` (3 commit)

| เรื่อง | สิ่งที่ต้องทำเพิ่มนอกเหนือจากขั้นตอนมาตรฐาน |
|---|---|
| ต้นทางลบหน้า `/reports` ทั้งหน้า | ลบ `app/(shell)/report-task/reports/` และ **ตัดเมนู "สรุปผล" ออกจาก manifest** ไม่งั้นเป็นเมนูที่กดแล้ว 404 (กราฟย้ายไปอยู่บนแดชบอร์ดแทน) |
| ต้นทางเพิ่มศูนย์แจ้งปัญหา `/issue-reports` | เพิ่มเมนูใน `lib/nav-config.ts` + สิทธิ์ `issueView`/`issueManage` ใน `permissions.ts` + ลงทะเบียนไอคอน `Bug` ใน `apps/web/lib/icons.ts` |
| `store-registry.ts` เพิ่ม 2 คีย์ | merge เอง — ของเรามี `employee-profiles` ที่ต้นทางไม่มี |
| อัปโหลดรับชนิดไฟล์เพิ่ม + ตรวจ magic byte | พอร์ตตรรกะเข้า `api/report-task/uploads/route.ts` ของเรา โดยคงชั้นเก็บไฟล์กลางไว้ · **ตั้งชื่อไฟล์ใหม่จากชนิดที่ตรวจได้จริง** ไม่ใช่ชื่อที่ผู้ใช้ส่งมา ไม่งั้นคนอัปโหลดเลือก Content-Type ที่ปลายทางเสิร์ฟได้เอง |
| ต้นทางเพิ่ม `api/uploads/file/[filename]` | **ไม่พอร์ต** — เป็น route เสิร์ฟไฟล์จาก `public/` ที่นี่ทุกไฟล์ออกทาง `/api/files/<key>` ซึ่งต้อง login และอยู่คนละโดเมนกับหน้าเว็บอยู่แล้ว |

**สคริปต์ข้อ 5 ต้องเติม 11 รายการ** สำหรับโค้ดใหม่ (กราฟวงกลม, chart-tooltip,
dashboard-layout-store, checklist ใน kanban) และ **ตัด 4 รายการ** ที่ชี้ไฟล์ซึ่ง
ต้นทางลบไปแล้ว — ถ้าไม่ตัด รอบหน้าจะขึ้นเตือน "หาไม่เจอ" หลอก ๆ

---

## ที่ยังค้าง

**ปฏิทินยังไม่มีตัวกรองช่วงวัน** — `GET /store/leaves` กับ `/store/holidays` คืนช่วง
−6 ถึง +12 เดือนตายตัว เพราะสัญญาเดิมของ store ไม่มีที่ส่งพารามิเตอร์
ถ้าข้อมูลเยอะขึ้นควรเปลี่ยนเป็น endpoint ที่รับ from/to

~~lint ข้ามโฟลเดอร์นี้ไว้~~ **เปิด lint แล้วเมื่อ 2026-08-11** พร้อมกับการรับเป็นเจ้าของ
— ตรวจ 219 ไฟล์เจอ 0 error / 7 warning (ส่วนใหญ่เป็น `<img>` กับ exhaustive-deps
ที่รับได้) ⇒ ไม่มีภาระตกค้าง

**`/report-feed` มี hydration warning** ที่ React กู้เองได้ (server กับ client เรนเดอร์
ข้อความไม่ตรงกัน — น่าจะเป็นการจัดรูปแบบวันเวลา) ยังไม่ได้ไล่หา ไม่ทำให้หน้าพัง

---

## ⚠ ตรวจด้วย curl อย่างเดียวไม่พอ

หน้าของโมดูลนี้เป็น client component เกือบทั้งหมด — **SSR ตอบ 200 ได้ทั้งที่หน้าพัง**
เพราะ crash เกิดหลัง hydrate เท่านั้น เคยเสียเวลาเพราะเรื่องนี้มาแล้ว
(`/report-task` ขึ้น "This page couldn't load" บนเซิร์ฟเวอร์จริง แต่ `curl` ได้ 200 ตลอด)

หลังพอร์ตทุกครั้งต้องเปิดในเบราว์เซอร์จริงแล้วดู console — เปิดหัวข้อทั้งหมด:
แดชบอร์ด · งาน · ปฏิทิน · รายงาน · แจ้งปัญหา · บันทึกกิจกรรม · ตั้งค่า

อีกกับดักหนึ่ง: **อย่า build ทับขณะเซิร์ฟเวอร์ยังรัน** ชื่อไฟล์ chunk เป็น hash
เมื่อ build ใหม่ hash เปลี่ยนหมด เซิร์ฟเวอร์ตัวเก่าจะสั่งเบราว์เซอร์ไปโหลดไฟล์ที่ไม่มีแล้ว
ได้ `ChunkLoadError` ที่หน้าตาเหมือนโค้ดพัง ทั้งที่โค้ดไม่ผิด
