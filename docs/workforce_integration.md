# การรวมโมดูล Workforce (HR / ลงเวลา / เงินเดือน) เข้ากับ Smartboss

สถานะ ณ 2026-08-02 — ทำต่อจาก `attendance/workforce/HANDOFF.md`

---

## ทำไปแล้ว

### 1. ย้ายโค้ดเข้ามาใน workspace เดียว

| จาก | มาไว้ที่ |
|---|---|
| `workforce/packages/{domain,payroll-engine,attendance-engine,contracts,db,config}` | `packages/workforce/*` |
| `workforce/apps/api` | `apps/workforce-api` |
| `workforce/apps/worker` | `apps/workforce-worker` |
| `workforce/apps/device-gateway` | `apps/workforce-device-gateway` |

- ชื่อ package ยังเป็น `@workforce/*` เหมือนเดิม จึงไม่ต้องแก้ import ในโค้ด
- **ไม่ได้ย้าย `workforce/packages/ui`** ตามที่ HANDOFF ระบุ (ชนกับ `packages/ui` ของ Smartboss)
- **ไม่ได้ย้าย `workforce/apps/web`** — เก็บไว้ที่ `attendance/workforce/apps/web` เป็นตัวอ้างอิงตอนเขียนหน้าจอใหม่ด้วย Tailwind
- ต้นฉบับทั้งหมดยังอยู่ที่ `attendance/workforce/` ยังไม่ได้ลบ

**ผลตรวจ:** `pnpm wf:test` → **354 เทสต์ผ่าน** (333 เดิม + 10 single login + 11 provisioning)
`pnpm typecheck` → 20/20 package ผ่าน

### 2. Single login

เพิ่ม auth provider ใหม่ชื่อ `smartboss` (ไม่ได้ปลดล็อก `local` ตามที่ HANDOFF เตือน)

```env
AUTH_PROVIDER=smartboss
AUTH_ISSUER=smartboss
AUTH_AUDIENCE=smartboss-web
AUTH_SMARTBOSS_SECRET=<ค่าเดียวกับ JWT_SECRET ของ Smartboss>
AUTH_TENANT_CLAIM=orgId
```

- ตรวจ token ด้วย HS256 + shared secret และตรึง `algorithms: ['HS256']` กัน alg-confusion
- อ่าน tenant จาก claim `orgId` ของ Smartboss (ตั้งทับได้ด้วย `AUTH_TENANT_CLAIM`)
- ต่างจาก `local` ตรงที่ **ใช้ใน production ได้** เพราะ secret มาจากระบบ auth จริง
- ผู้ใช้ระดับแพลตฟอร์มที่ `orgId = null` เข้า workforce ไม่ได้ (ทุกข้อมูลผูกกับ tenant)

ไฟล์: `packages/workforce/config/src/schema.ts`, `apps/workforce-api/src/auth/token-verifier.ts`

### 3. ฐานข้อมูล

workforce ใช้ PostgreSQL schema ชื่อ `workforce` อยู่ใน **database เดียวกับ Smartboss**
Prisma (`core`, `maintenance`, `hr`) กับ Drizzle (`workforce`) ต่างคนต่างจัดการ schema ตัวเอง —
ไม่ได้เพิ่ม `workforce` เข้า `schemas` ของ Prisma ตามที่ HANDOFF สั่ง

**ขั้นตอนติดตั้ง (ต้องใช้สิทธิ์ DBA ครั้งเดียว):**

```bash
psql -U postgres -d <db> -f packages/workforce/db/sql/00-create-role.sql    # role workforce_app
psql -U postgres -d <db> -f packages/workforce/db/sql/01-grant-app-role.sql # ให้ user แอปสวมบทได้
pnpm wf:migrate                                                             # 7 migration
psql -U postgres -d <db> -f packages/workforce/db/sql/02-lookup-functions-owner.sql
```

> **ไฟล์ 02 ต้องรันหลัง migrate** — แก้เจ้าของฟังก์ชันค้นหาข้ามบริษัท 3 ตัว
> ถ้าไม่รัน **เครื่องสแกนจะ activate ไม่ได้เลย** (401 invalid activation token
> ทั้งที่ token ถูกต้อง) ดูรายละเอียดในหัวข้อ 10

ผลที่ได้: **75 ตารางเปิด RLS** ครบ

> **RLS ทำงานจริง** — ยืนยันแล้วว่า query `workforce.principals` ด้วย user ของแอปโดยไม่ตั้ง
> tenant context ได้ 0 แถว (ไม่ใช่ข้อมูลหาย) เพราะ `withTenant()` ทำ `SET LOCAL ROLE workforce_app`
> ทุกครั้ง กับดักข้อ 1 ของ HANDOFF จึงถูกปิดไปแล้ว

### 4. เชื่อมตัวตน Smartboss ↔ workforce

HANDOFF ระบุว่ายังไม่มี API สร้าง tenant/principal — เขียนเพิ่มให้แล้ว

`packages/workforce/db/src/provisioning/smartboss.ts`
- `provisionTenant()` — `Organization.id` → `workforce.tenants.id` (id เดียวกัน) + seed role ตั้งต้น 10 ตัว
- `provisionPrincipal()` — `User.id` → `workforce.principals.subject`
- `mapSmartbossRoles()` — แปลง role/permission ของ Smartboss เป็น role ของ workforce

ทั้งหมด **เรียกซ้ำได้** (ทดสอบแล้ว)

```bash
pnpm wf:sync --dry-run   # ดูว่าจะทำอะไร
pnpm wf:sync             # สร้างจริง
```

**กฎแยกหน้าที่:** คนที่มี `hr.payroll.approve` จะได้ `PAYROLL_APPROVER` **เท่านั้น**
ไม่ได้ `PAYROLL_PREPARER` ติดมาด้วย — บังคับที่ระดับสิทธิ์ มีเทสต์คุมไว้

---

## 6. หน้าจอ (เขียนใหม่ด้วย Tailwind แล้ว)

เขียนใหม่ทั้งหมดตามธีมใน `Smartboss_Phase1_Shell_Login_Spec.md` — ธีมขาว + สีโมดูล HR ฟ้า (`--mod-hr`)
ใช้ `AppScaffold` (rail + AppBar) ชุดเดียวกับโมดูลอื่น **ไม่มี hex hardcode ใน component**
(เพิ่ม `--tone-*` ใน tokens.css สำหรับสีสถานะ และ `[data-app="hr"]` สำหรับธีมโมดูล)

| หน้า | เส้นทาง | ดึงจาก |
|---|---|---|
| ภาพรวม + สถิติ | `/hr` | `/employments`, `/payroll-runs`, `/attendance-summary` |
| พนักงาน | `/hr/employees` | `/employments` |
| รายละเอียดพนักงาน | `/hr/employees/[id]` | `/employments/:id`, `/compensation-rates` |
| ผลลงเวลา | `/hr/attendance` | `/attendance-summary` |
| Timesheet | `/hr/timesheets` | `/timesheet-periods` (+ generate/close) |
| กะทำงาน | `/hr/shifts` | `/shifts`, `/work-policies` |
| งวดเงินเดือน | `/hr/payroll` | `/payroll-runs` |
| รายละเอียดงวด | `/hr/payroll/[id]` | `/payroll-runs/:id/employees` (+ state machine) |
| ชุดกฎตามกฎหมาย | `/hr/rule-sets` | `/statutory-rule-sets` |
| เครื่องสแกน | `/hr/devices` | `/devices` (+ ออกโทเคน/เพิกถอน) |
| สลิปของฉัน | `/hr/my-payslips` | `/me/payslips` |
| ประวัติการใช้งาน | `/hr/audit` | `/audit-events` |

**วิธีต่อ API:** หน้าเป็น Server Component อ่าน cookie `sb_access` แล้วส่งเป็น Bearer
ผ่าน `modules/hr/lib/api.ts` (token ไม่หลุดออกฝั่ง browser) — mutation ใช้ server action
และใส่ `Idempotency-Key` ให้อัตโนมัติ

**การจัดการ error:** `HrPage` แปลงคำตอบของ API เป็นหน้าจอที่อ่านรู้เรื่อง
- ต่อ API ไม่ได้ → กล่องบอกวิธีสตาร์ต
- 403 → บอกว่าขาด permission ตัวไหน + ลิงก์ไป `/admin/roles`
- 401 → เซสชันหมดอายุ

## 7. รัน API

```bash
# 1) ตั้ง env (ดูตัวอย่าง apps/workforce-api/.env.local.example)
#    AUTH_SMARTBOSS_SECRET ต้องเป็นค่าเดียวกับ JWT_SECRET ของ Smartboss
# 2) build + start
npx tsc -b apps/workforce-api
pnpm wf:api            # ฟังที่ 4100
```

Next.js อ่าน `WORKFORCE_API_BASE` (ตั้งไว้ใน `wsl-dev.tmp.sh` แล้ว)

**ยืนยันแล้วว่าใช้ได้จริง:** login ที่ Smartboss → เอา token ใบเดียวกันยิง
`GET /api/workforce/v1/employments` ได้ **HTTP 200** และทั้ง 12 หน้าตอบ 200

---

## 8. หน้าจอสร้าง/แก้ไขข้อมูล

| ทำอะไรได้ | ที่ไหน | สิทธิ์ workforce |
|---|---|---|
| สร้างบริษัท (ตั้งต้นระบบ) | `/hr` แสดงอัตโนมัติเมื่อยังไม่มี company | `settings.manage` |
| เพิ่มพนักงาน (person + employment + ค่าจ้าง) | `/hr/employees/new` | `people.manage` (+ `payroll.prepare` ถ้าตั้งค่าจ้างด้วย) |
| ตั้ง/ปรับอัตราค่าจ้าง | `/hr/employees/[id]` | `payroll.prepare` |
| แจ้งพ้นสภาพ | `/hr/employees/[id]` | `people.manage` |
| เพิ่มกะทำงาน | `/hr/shifts` | `scheduling.manage` |
| สร้างงวด timesheet · คำนวณ · ปิดงวด | `/hr/timesheets` | `timesheet.review` / `timesheet.close` |
| เดินสถานะงวดเงินเดือน | `/hr/payroll/[id]` | `payroll.calculate` / `payroll.approve` |
| ลงทะเบียนเครื่องสแกน · ออกโทเคน · เพิกถอน | `/hr/devices` | `devices.manage` / `devices.revoke` |

**การเพิ่มพนักงานทำ 3 ขั้นในคำสั่งเดียว:** `POST /people` → `POST /employments` → `POST /compensation-rates`
ขั้นสุดท้ายใช้สิทธิ์คนละตัว ถ้าผู้ใช้ไม่มีสิทธิ์ตั้งค่าจ้าง **พนักงานยังถูกสร้างสำเร็จ**
แล้วไปตั้งค่าจ้างทีหลังที่หน้ารายละเอียด — ไม่ใช่ล้มทั้งรายการ

## 9. แก้ค่า default ของสิทธิ์ (แยกหน้าที่)

seed เดิมให้ `HR_OFFICER` มีทั้ง `hr.payroll.manage` และ `hr.payroll.approve`
ซึ่งทำให้ `mapSmartbossRoles()` จัดเป็น **ผู้อนุมัติ** → กลายเป็นว่าไม่มีใครเป็นผู้จัดทำงวดได้เลย

แก้ให้ `HR_OFFICER` ไม่มี `hr.payroll.approve` ⇒ ได้ `PAYROLL_PREPARER`
ส่วน `CEO` / `ADMIN` เป็น `PAYROLL_APPROVER` ตามเดิม

> seed ใช้ upsert (เพิ่มอย่างเดียว) — ฐานข้อมูลที่ seed ไปแล้วต้องลบสิทธิ์เก่าเอง:
> `DELETE FROM core.role_permissions ... WHERE r.code='HR_OFFICER' AND p.code='hr.payroll.approve'`

---

## 10. เครื่องสแกน ESP32 (firmware)

### เพิ่มการรับคำสั่งจากเซิร์ฟเวอร์

เดิมเฟิร์มแวร์ยิงแค่ `POST /device-ingestion/time-events:batch` อย่างเดียว
ไม่มี polling คำสั่ง — ผลคือการลงทะเบียนลายนิ้วมือค้างที่ `PENDING` ตลอด
การสแกนไม่ผูกกับพนักงาน และผลลงเวลาขึ้นว่า **ขาดงานทุกวัน**

เพิ่มแล้วใน `attendance/workforce/firmware/esp32-fingerprint/`:

| ไฟล์ | เปลี่ยนอะไร |
|---|---|
| `http_sync.c/h` | `perform_signed()` รวมการเซ็น+HTTP ไว้ที่เดียว · `wf_sync_poll_commands()` ใหม่ |
| `main.c` | task ใหม่ `command_task` ถามคำสั่งทุก 10 วิ (แยกจาก sync เพราะ enroll ใช้เวลานาน) |
| `app_config.h` | `WF_COMMAND_POLL_INTERVAL_MS`, `WF_COMMAND_RESPONSE_MAX` |

รองรับ `ENROLL_BIOMETRIC` และ `DELETE_BIOMETRIC` ส่วนคำสั่งที่ยังไม่ทำ
(`CLEAR_SENSOR`/`UPDATE_CONFIG`/`REBOOT`) ack เป็น `FAILED` ทันที ไม่ปล่อยค้างจนหมดอายุ

> **ยังไม่เคย build/flash บนบอร์ดจริง** — ในเครื่องนี้ไม่มีทั้ง ESP-IDF และฮาร์ดแวร์
> ต้องทดสอบบนบอร์ดก่อนใช้งาน

### พิสูจน์โปรโตคอลโดยไม่ต้องมีบอร์ด

`scripts/verify-device-protocol.mjs` จำลองเครื่องด้วย Ed25519 จริง
เดินครบทุกขั้นแบบเดียวกับ `command_task` แล้วตรวจผล

```bash
node scripts/verify-device-protocol.mjs
```

ผลที่ได้: สร้างเครื่อง → ออก token → activate → สั่ง enroll → เครื่องรับคำสั่ง →
ack → **สถานะเปลี่ยนเป็น `ACTIVE`** และ ack ซ้ำด้วย nonce เดิมถูกปฏิเสธ (409)

### 🐛 บั๊กที่เจอ: เครื่องสแกน activate ไม่ได้เลย

ฟังก์ชัน `lookup_activation_token` / `lookup_device_credential` / `lookup_legacy_device`
เป็น `SECURITY DEFINER` ที่ต้องค้นข้าม tenant (เครื่องยังไม่รู้ว่าตัวเองอยู่บริษัทไหน)
แต่ตารางเปิด `FORCE ROW LEVEL SECURITY` ซึ่ง**บังคับกับเจ้าของตารางด้วย**

⇒ เมื่อเจ้าของ schema ไม่ใช่ superuser (ซึ่งเป็นการตั้งค่าที่ถูกต้อง) ฟังก์ชันคืน 0 แถวเสมอ
เครื่องจึงได้ `401 invalid activation token` ทั้งที่ token ถูกต้องทุกอย่าง

เทสต์ไม่จับเพราะ PGlite รันเป็น superuser ซึ่งข้าม RLS อยู่แล้ว

**แก้ด้วย `sql/02-lookup-functions-owner.sql`** — ให้ role `workforce_lookup`
(`NOLOGIN BYPASSRLS`) เป็นเจ้าของเฉพาะ 3 ฟังก์ชันนี้ และให้สิทธิ์ `SELECT` แค่ 3 ตารางที่ใช้
ไม่ให้ `BYPASSRLS` กับ role ของแอป เพราะจะทำให้ query ที่ลืมตั้ง tenant
มองข้ามบริษัทได้เงียบ ๆ (กับดักข้อ 1 ของ HANDOFF)

### แก้ mapping สิทธิ์เครื่องสแกน

หน้า `/hr/devices` เปิดให้คนที่มี `hr.setting.manage` แต่ `mapSmartbossRoles()`
ไม่เคยให้ `DEVICE_TECHNICIAN` กับใครเลย ⇒ ปุ่มทุกปุ่มบนหน้านั้นกดแล้ว 403
แก้ให้ `hr.setting.manage` → `HR_OFFICER` + `DEVICE_TECHNICIAN` (มีเทสต์คุม)

---

## ยังไม่ได้ทำ

- **ชุดกฎ ปกส./ภาษียังเป็น DRAFT** — ต้องให้ SME บัญชี/กฎหมายรับรองก่อนคิดเงินจริง
  (หน้า `/hr/rule-sets` ขึ้นคำเตือนไว้แล้ว)
- **เฟิร์มแวร์เครื่องสแกนยังไม่รับคำสั่งจากเซิร์ฟเวอร์** — ลายนิ้วมือจะค้างที่ `PENDING`
  ผลลงเวลาจึงยังขึ้นขาดงาน (HANDOFF ข้อ 6.3)
- **สลิปยังเป็น JSON ยังไม่มี PDF** และแบบยื่นราชการยังไม่มี formatter
- ยังไม่มีหน้าจอสำหรับ: ลา/OT, roster, การแก้ไขผลลงเวลา, ผูกลายนิ้วมือ
  (API มีครบแล้ว — ดู `docs/api/openapi.json` 93 เส้นทาง)

---

## 5. ลบโมดูล HR เดิมทิ้งแล้ว (2026-08-02)

เจ้าของโปรเจกต์ตัดสินใจให้ลบตามแผนเดิมของ HANDOFF §1

**สิ่งที่ลบ**

| | |
|---|---|
| หน้าจอ | `apps/web/app/(shell)/hr/` ทั้งโฟลเดอร์ (13 ไฟล์) |
| โค้ดโมดูล | `apps/web/modules/hr/{components,data,lib,__tests__,manifest.ts}` |
| ตาราง | `DROP SCHEMA hr CASCADE` — 10 ตาราง (migration `20260802130000_drop_legacy_hr_module`) |
| ทะเบียนโมดูล | `hrManifest` ออกจาก `module-registry.ts` |
| seed | ส่วนที่สร้าง PayrollSetting / PayComponent |

**ข้อมูลที่หายไปพร้อมกัน:** พนักงาน 3, รอบจ่าย 1, สลิป 3, ประวัติเงินเดือน 3
(เป็นข้อมูลตัวอย่างที่สร้างไว้ทดสอบ ไม่ใช่ข้อมูลจริง)

**สิ่งที่ตั้งใจเก็บไว้ — `apps/web/modules/hr/permissions.ts`**

permission `hr.*` ทั้ง 9 ตัวยังอยู่ในแคตตาล็อกของ Smartboss เพราะเป็นตัวที่บริษัทใช้
กำหนดสิทธิ์ที่หน้า `/admin/roles` แล้วถูกแปลงเป็น role ของ workforce ด้วย
`mapSmartbossRoles()` ตอน sync — ลบทิ้งเมื่อไหร่ การกำหนดสิทธิ์ workforce จากหลังบ้านจะพัง

**ผลตรวจหลังลบ:** `/hr/*` ตอบ 404 · `/`, `/admin/*`, `/maintenance/*` ยังตอบ 200
· typecheck 20/20 · lint สะอาด · 354 เทสต์ผ่าน · mapping สิทธิ์ยังทำงานถูก

---

## ⚠️ ผลที่ตามมา — ตอนนี้ยังไม่มีระบบคิดเงินเดือนที่ใช้งานได้

HANDOFF ข้อ 6.1 ระบุว่า **ชุดกฎประกันสังคม/ภาษีของ workforce ยังเป็น DRAFT**
"ตัวเลขในระบบเป็นค่าทดสอบที่ AI กรอกเอง ยังคิดเงินคนจริงไม่ได้"
ระบบบล็อกไว้สองชั้น (engine + CHECK constraint) ห้ามเผยแพร่ถ้าไม่มีแหล่งอ้างอิงกฎหมาย +
ผู้รับรอง + golden test ผ่าน

โมดูล `hr` เดิมที่คำนวณ ปกส. + ภาษีขั้นบันไดได้จริง (unit test 16 เคส) ถูกลบไปแล้ว

⇒ **ก่อนใช้งานจริง ต้องให้ SME ฝ่ายบัญชี/กฎหมายรับรองชุดกฎของ workforce ก่อน**
ดู `attendance/workforce/docs/phase0/golden-payroll-fixtures.md`

หากต้องการกู้โมดูลเดิมกลับ: `git revert` migration `20260802130000_drop_legacy_hr_module`
และกู้ไฟล์จาก git history (ยังไม่เคย commit — ถ้ายังไม่ commit ต้องเขียนใหม่)
