# การแบ่ง branch ตามโมดูล

`main` คือตัวจริงที่ deploy ขึ้นเซิร์ฟเวอร์เสมอ — branch อื่นเป็นที่ทำงานระหว่างพัฒนา

> **คำสั่งไหนรันที่ไหน** ดู [`docs/commands.md`](commands.md) — อ่านก่อนเริ่มทำงาน
>
> **รอบการทำงานตั้งแต่แก้โค้ดจนขึ้น production** ดู [`docs/workflow.md`](workflow.md)

## ใครดูแลอะไร

| branch | ไฟล์ที่เป็นเจ้าของ |
|---|---|
| `module/admin` | `apps/web/modules/admin/` · `apps/web/app/(shell)/admin/` · `packages/auth/` |
| `module/hr` | **ทั้งหน้าจอและหลังบ้านของงานบุคคล** — `apps/web/modules/hr/` · `apps/web/app/(shell)/hr/` · `apps/workforce-*` · `packages/workforce/*` |
| `module/maintenance` | `apps/web/modules/maintenance/` · `apps/web/app/(shell)/maintenance/` · `apps/web/app/api/files/` |
| `module/report_task` | `apps/web/modules/report_task/` · `apps/web/app/(shell)/report-task/` · `apps/web/app/api/report-task/` |
| `infra/deploy` | `deploy/` · `docs/deploy.md` · `docker-compose.yml` · `.github/` |

### ทำไม HR กับ workforce ถึงเป็น branch เดียวกัน

ตอนแรกผมแยกเป็น `module/hr` (หน้าจอ) กับ `module/workforce` (หลังบ้าน) แล้วรวมทีหลัง
เพราะมันคือเรื่องเดียวกันคนละครึ่ง:

```
apps/web/modules/hr/      ← หน้าจอ 14 หน้า
        ↓  เรียกผ่าน WORKFORCE_API_BASE (ฝั่งเซิร์ฟเวอร์)
apps/workforce-api/       ← เจ้าของข้อมูลจริง (Drizzle + RLS)
packages/workforce/*      ← เครื่องคิดเงินเดือน/ลงเวลา
```

การเพิ่มฟิลด์หนึ่งช่องต้องแก้ทั้ง migration, API, contract และหน้าจอ — ถ้าอยู่คนละ
สาขาจะต้องเปิดสองสาขาพร้อมกันทุกครั้ง ซึ่งเสียประโยชน์ของโมโนรีโปไปเปล่า ๆ

> **เฟิร์มแวร์เครื่องสแกนไม่ได้อยู่ใน repo นี้** — `attendance/` ถูก `.gitignore` ไว้
> เพราะเป็น repo ของตัวเอง ([HR-Tool](https://github.com/baanpoolvilla/HR-Tool))
> แก้เฟิร์มแวร์ให้ไปทำที่นั่น ส่วนฝั่งเซิร์ฟเวอร์ที่คุยกับเครื่อง
> (`apps/workforce-device-gateway`) อยู่ใน `module/hr`

## ฐานข้อมูล — แยก schema ได้ แต่ประวัติ migration แยกไม่ได้

**แยกแล้ว** — โมเดลอยู่คนละไฟล์ตามโมดูล ทำงานคนละสาขาไม่ชนกัน

```
packages/database/prisma/schema/
├── schema.prisma        generator + datasource     ← ของกลาง
├── core.prisma          15 model                   ← module/admin
├── maintenance.prisma   16 model                   ← module/maintenance
└── report_task.prisma    3 model                   ← module/report_task

packages/workforce/db/migrations/*.sql              ← module/hr (Drizzle แยกอยู่แล้ว)
```

**แยกไม่ได้** — `prisma/schema/migrations/` มีประวัติเดียวเรียงตามเวลา
Prisma ไม่รองรับการแยกโฟลเดอร์ migration ตามโมดูล

### ทำไมแยกไม่ได้ และทำไมไม่เป็นไร

ตารางข้ามโมดูลอ้างถึงกัน — `maintenance.work_orders.org_id` และ
`report_task.tasks.org_id` ต่างชี้ไป `core.organizations.id` พร้อม FK จริง
ถ้าแยกประวัติ migration จะไม่มีใครรู้ว่าตอนสร้าง FK นั้น ตารางปลายทางมีหรือยัง

แต่ในทางปฏิบัติ **ไม่ค่อยชนกัน** เพราะชื่อโฟลเดอร์ migration ขึ้นต้นด้วยเวลา
สองสาขาสร้างคนละไฟล์ ตอน merge จึงแค่เรียงต่อกัน ไม่ทับกัน

### กติกาที่ทีมต้องทำตาม

**1. ก่อนสร้าง migration ต้อง rebase จาก main ก่อนเสมอ**
```bash
git fetch origin && git rebase origin/main
pnpm db:migrate      # ค่อยสร้าง migration ใหม่
```
ไม่ทำ = ได้ migration ที่เขียนบนฐานที่ไม่ตรงกับของจริง

**2. migration ที่ push ไปแล้ว ห้ามแก้เนื้อในเด็ดขาด**
Prisma เก็บ checksum ไว้ ถ้าเนื้อไม่ตรงจะปฏิเสธทั้งชุด แก้ผิดให้เขียนตัวใหม่ทับ

**3. แก้ตารางของโมดูลตัวเองเท่านั้น**
อยากให้ `core` เพิ่มฟิลด์ ⇒ คุยแล้วทำบน `main` ไม่ใช่ทำเองในสาขา

**4. หลัง merge เข้า main แล้วต้องลง migration ที่เซิร์ฟเวอร์**
```bash
sudo -u smartboss bash -c 'set -a; . /etc/smartboss/smartboss.env; set +a; pnpm db:deploy'
```
เช็คว่าค้างกี่ตัว: `... pnpm --filter @smartboss/database exec prisma migrate status`

### ถ้าสองสาขาชนกันจริง

อาการ: merge แล้ว `prisma migrate status` บอกว่ามี migration ที่ยังไม่ลง
แต่ตารางมีอยู่แล้ว (คนหนึ่งลงไปก่อน)

แก้: **อย่าลบไฟล์ migration** ให้บอก Prisma ว่าอันนั้นลงแล้ว
```bash
pnpm --filter @smartboss/database exec prisma migrate resolve --applied <ชื่อโฟลเดอร์>
```

---

## ⚠ ของกลางที่ทุก branch แตะได้ — แต่ไม่ควรแตะจากที่นี่

```
packages/ui/                          ปุ่ม การ์ด ตาราง สี (tokens.css)
packages/database/prisma/schema/
  ├── schema.prisma                   generator + datasource
  └── core.prisma                     ทุกโมดูลอ้างถึง Organization/User
packages/database/prisma/schema/migrations/   ประวัติเดียว เรียงตามเวลา
packages/config/                      ค่าตั้งร่วม
apps/web/components/                  shell, AppScaffold
apps/web/lib/icons.ts                 ทะเบียนไอคอนของเมนู
apps/web/module-registry.ts           ทะเบียนโมดูล
```

**แก้ของกลางให้ทำบน `main` แล้วให้ branch อื่น rebase ตาม** ไม่ใช่แก้ในสาขาตัวเอง

เหตุผล: ถ้าสองโมดูลแก้ `schema.prisma` คนละที่แล้วค่อยมา merge กัน จะได้ migration
ที่ทับกันเองซึ่ง Prisma แก้ให้ไม่ได้ — ต้องมานั่งไล่เขียนใหม่ทั้งคู่

ไอคอนก็เจอมาแล้ว: เพิ่มเมนูใหม่ในโมดูลแต่ลืมลงทะเบียนไอคอนใน
`apps/web/lib/icons.ts` (ของกลาง) เมนูจะขึ้นไอคอน fallback เงียบ ๆ

## วิธีทำงาน

```bash
# เริ่มงานใหม่ — ดึง main ล่าสุดมาก่อนเสมอ
git checkout module/maintenance
git fetch origin
git rebase origin/main

# ...แก้โค้ด...

git push --force-with-lease      # หลัง rebase ต้องใช้ --force-with-lease
```

เอากลับเข้า `main` ผ่าน Pull Request บน GitHub — ก่อน merge ต้องผ่าน:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## rebase ให้บ่อย

branch ที่ทิ้งไว้นานเป็นเดือนจะ merge ยากขึ้นเรื่อย ๆ เพราะของกลางขยับไปแล้ว
**อย่างน้อยสัปดาห์ละครั้ง** หรือทุกครั้งที่ `main` มีของกลางเปลี่ยน

> โมโนรีโปไม่ได้ถูกออกแบบมาให้แยก branch ยาว ๆ — ข้อดีของมันคือแก้ข้ามโมดูล
> ในคอมมิตเดียวได้ ถ้าแยกนานเกินไปจะเสียข้อดีนั้นไปแล้วได้ merge conflict แทน
> ใช้ branch เป็น "ที่ทำงานชั่วคราวของงานหนึ่งชิ้น" แล้วรีบ merge จะได้ประโยชน์สุด

## `module/report_task` — Smartboss เป็นเจ้าของเต็มตัวแล้ว

**แก้ได้ทุกอย่างที่นี่ ทั้ง UI และชั้นข้อมูล** — ไม่ต้องไปแก้ที่ repo อื่นแล้ว

เดิมโค้ดชุดนี้พอร์ตมาจาก [easyboss-workspace](https://github.com/baanpoolvilla/easyboss-workspace)
และมีกฎว่าห้ามแก้ UI ที่นี่เพราะจะถูกเขียนทับตอนดึงเวอร์ชันใหม่
**ยกเลิกกฎนั้นแล้วเมื่อ 2026-08-11** — ตั้งแต่นี้ไม่ดึงจาก upstream อีก

⚠ ผลที่ตามมา: ถ้าวันหนึ่งอยากดึงของใหม่จาก upstream จะไม่ใช่การ "ทับ" อีกต่อไป
ต้องไล่ merge ทีละไฟล์ — ดูสิ่งที่ต่างจากต้นทางได้ที่ [`report_task_port.md`](report_task_port.md)

## deploy

เซิร์ฟเวอร์ดึงจาก `main` เท่านั้น (`deploy/release.sh` รัน `git pull` บน `main`)
ของที่ยังอยู่ใน branch จึงยังไม่มีผลกับ `app.easyboss.app`
