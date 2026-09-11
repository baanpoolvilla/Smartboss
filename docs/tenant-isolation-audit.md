# Tenant isolation audit — ตรวจการแยกข้อมูลข้ามบริษัท

วันที่: 2026-09-11 · ขอบเขต: schema ที่ Prisma ดูแล (core, report_task, chat,
company_files, maintenance) — **ไม่รวม** workforce (HR/ลงเวลา/เงินเดือน) ซึ่ง
แยกฐานข้อมูลและใช้ RLS (`SET LOCAL ROLE` + `set_config`) ของตัวเองอยู่แล้ว
ผ่านการตรวจ RLS-style ที่มีอยู่ก่อนงานนี้

> ไฟล์นี้คือรายงานผลตรวจ + สถานะปัจจุบัน ใช้ตอบคำถามลูกค้าองค์กร/แบบสอบถาม
> security/DPA ว่า "เคยตรวจการแยกข้อมูลข้ามบริษัทไหม ผลเป็นยังไง" ได้ตรงๆ

---

## สรุปสั้น

| หัวข้อ | ผล |
|---|---|
| การ์ดชั้นกลาง (tenant-guard) | มีอยู่แล้วก่อนงานนี้ — เจอว่าเปิดแบบ "เตือนอย่างเดียว" ทุกที่ ไม่เคยบล็อกจริง |
| Allowlist ของการ์ด | เจอ 6 โมเดลจริงที่ตกหล่น — ปิดครบแล้ว พร้อมเทสต์กันดริฟต์ซ้ำ |
| Escape hatch (query ที่ตั้งใจข้ามบริษัทจริง) | สร้างกลไกใหม่ (`crossOrg()`) — เจอบั๊กจริงในกลไกเองระหว่างพิสูจน์ แก้แล้ว |
| Mutation/read แบบ by-id (จุดที่การ์ดครอบไม่ถึงเลย) | ไล่ตรวจทุก call site (`update`/`delete`/`findUnique`/`upsert`) ใน `apps/web` — **ไม่เจอช่องโหว่ที่ใช้ประโยชน์ได้จริง** |
| จุดอ่อนที่เจอ (ยังไม่ถึงขั้นช่องโหว่) | 2 จุด "concentration of trust" — ปิดแล้วด้วยโค้ด + เทสต์ปักพฤติกรรม |
| สถานะ enforcement | `strict` ที่ dev + CI แล้ว · production ยัง `warn` รอ deploy + เฝ้า log ก่อน flip |

---

## 1. กลไกป้องกัน — tenant-guard.ts

Smartboss เก็บทุกบริษัทในฐานข้อมูลเดียวกัน แยกด้วยคอลัมน์ `orgId` (shared-database,
row-level tenancy) ความปลอดภัยจึงขึ้นกับ "ทุก query ที่แตะตารางของบริษัทต้องกรอง
orgId เสมอ" — `packages/database/tenant-guard.ts` เป็น Prisma extension ที่ดัก
ทุก query เข้าโมเดลที่มี orgId (`TENANT_SCOPED_MODELS`, ปัจจุบัน 41 โมเดล) แล้ว
เตือน/บล็อกถ้าไม่มีเงื่อนไข orgId

**พบก่อนแก้:** ตัวแปร `TENANT_GUARD` ที่ควบคุมโหมด (`off`/`warn`/`strict`) ไม่เคย
ถูกตั้งค่าที่ไหนเลยในทั้ง repo —ดีฟอลต์คือ `warn` (log อย่างเดียว ไม่บล็อก) ทุก
สภาพแวดล้อมรวมถึง production มาตลอด

## 2. Allowlist gap — 6 โมเดลที่หลุดการตรวจไปเลย

เทียบ schema จริงทุกไฟล์กับ `TENANT_SCOPED_MODELS` พบ 6 โมเดลที่มีคอลัมน์ orgId
จริงแต่ไม่อยู่ใน allowlist — การ์ด**ไม่เช็คอะไรเลย ไม่แม้แต่จะ log**:

`DayOffQuotaSetting`, `EmployeeDayOffQuota`, `EmployeeDayOffQuotaDefault`,
`DiscordChannel`, `DiscordLink`, `ReportSubmission`

> อัปเดต 2026-09-11: `DiscordChannel`/`DiscordLink`/`ReportSubmission` (และ
> ฟีเจอร์ Discord Report Sync ทั้งชุด) ถูกลบออกจากระบบทั้งหมดในภายหลัง —
> ยืนยันแล้วว่าไม่ได้ใช้งาน ไม่ใช่เพราะปัญหา tenant isolation แต่อย่างใด
> ตอนลบก็ถอดออกจาก `TENANT_SCOPED_MODELS` ไปด้วยพร้อมกัน

ระหว่างแก้ยังพบว่า `User`/`Role`/`Notification` มี `orgId` แบบ **nullable**
(null = แถวระดับแพลตฟอร์ม เช่น super admin) แต่การ์ดเดิมปฏิบัติกับ `orgId: null`
เหมือน "ไม่มี orgId เลย" — จะทำให้ query ที่ตั้งใจดึง platform user (เช่น
`unreadCount` ของ super admin) โดน throw ผิดๆ ทันทีที่เปิด strict แก้ไขให้ยอมรับ
`orgId: null` เป็นการกรองที่ตั้งใจแล้ว

**ปิดแล้วด้วย:** เพิ่ม 6 โมเดลเข้า allowlist + เขียน `tenant-guard.test.ts` ที่
อ่าน schema จริงทุกไฟล์แล้ว assert ว่า allowlist ตรงกันเป๊ะ (ไม่ใช่ snapshot
ลอยๆ — พิสูจน์แล้วด้วยการลบโมเดลออกชั่วคราวแล้วดูว่า test แดงจริงก่อน merge)

## 3. Escape hatch — `crossOrg()`

บาง query ตั้งใจข้ามบริษัทจริงๆ (cron ระดับแพลตฟอร์ม, ค้นหา user ก่อน login
ด้วย LINE id ที่ unique ทั้งระบบ, แจ้งเตือนที่ผูกกับ userId ไม่ใช่ orgId)
— สร้างกลไก `packages/database/cross-org.ts` ให้ห่อ query เหล่านี้แบบ grep-able
ที่จุดเรียกจริง บังคับเหตุผล (TS literal union, ไม่ใช่ string ใดก็ได้) และ
snapshot รายการเหตุผลไว้ในเทสต์กันเพิ่มเงียบๆ

**เจอบั๊กจริงระหว่างพิสูจน์กลไก:** สมอลก์เทสต์ตัวแรก (org A/B จริง ผ่าน Postgres
จริง) เจอว่า `crossOrg()` ไม่ทำงานจริงเลยสักครั้ง — Prisma query เป็น lazy
thenable, การ์ดเช็คตอน `.then()` ถูกเรียก ไม่ใช่ตอนสร้าง query แต่ implementation
เดิมคืน promise ที่ยังไม่ await ออกไปนอก async context ทำให้ context หลุดไปแล้ว
ก่อนการ์ดจะเช็ค **ทั้ง 9 จุดที่ห่อไว้ก่อนหน้าไม่เคยทำงานจริงสักจุด** — ตอน `warn`
mode แค่พ่น log เตือนผิดๆ เงียบๆ แต่ถ้าเปิด `strict` ไปโดนจุดพวกนี้จะ throw ทันที
ทั้งที่เป็นการใช้งานที่ตั้งใจไว้ถูกต้อง แก้จุดเดียวใน `cross-org.ts` (await ใน
callback ของ `storage.run()`) ก็ครอบคลุมทั้ง 9 จุดพร้อมกัน

## 4. By-id mutation/read audit — จุดที่การ์ดครอบไม่ถึง

การ์ดไม่เช็ค `update`/`delete`/`findUnique`/`upsert`'s where (เช็คแค่
`findMany`/`findFirst`/`count`/`updateMany`/`deleteMany`/`create` — bulk/list
ops) เพราะ Prisma ops แบบ single-record มักคีย์ด้วย unique field ที่ต้องเช็ค
ownership เองในโค้ด นี่คือจุดที่ "id ของบริษัทอื่นหลุดมาถึง client" จะกลายเป็น
ช่องโหว่จริงถ้าไม่มี defense-in-depth

**ไล่ตรวจทุก call site ใน `apps/web`** (routes, server actions, data-layer)
ของ 41 โมเดลที่มี orgId ผ่าน 4 operation นี้ สืบที่มาของ id ทุกจุดว่ามาจาก
client โดยตรง หรือถูก validate/derive จาก query ที่กรอง orgId มาก่อนแล้ว

**ผล: ไม่เจอช่องโหว่ที่ใช้ประโยชน์ได้จริงเลย** — ทุกจุดเป็นหนึ่งในนี้:
- ผ่าน ownership-check ก่อนเสมอ (`assertManageableUser`, `assertEditableRole`,
  `assertEditableDepartment`, `assertChannelMember`, หรือ `findFirst({id,
  orgId})` ที่จุดเดียวกัน)
- compound unique key ที่ฝัง `orgId` จาก session เสมอ (ข้ามบริษัทไม่ได้โดย
  โครงสร้างฐานข้อมูล ไม่ใช่แค่โดยวินัยโค้ด)
- token/secret แบบ unguessable โดยดีไซน์ (external upload link, share link)

โมดูลที่งานหนักสุด (work order, purchase order, property, asset, contractor
ฯลฯ) **ไม่มี** single-record update/delete/findUnique เลยสักจุด — routes
single-record mutation ผ่าน `updateMany`/`deleteMany({id, orgId})` ที่การ์ด
ครอบอยู่แล้วตลอด

### 2 จุด "concentration of trust" ที่เจอ (ไม่ exploitable วันนี้ แต่ปิดแล้ว)

1. **`assertManageableUser`'s SUPER_ADMIN branch** — ไม่กรอง org เลยโดยตั้งใจ
   (SUPER_ADMIN ต้องจัดการทุกบริษัทได้) แปลว่าทุก `user.update`/`delete` ใน
   `admin/actions.ts` ปลอดภัยเท่าที่ `isSuperAdmin(session)` ยังแน่นอยู่ —
   ปักพฤติกรรมด้วยเทสต์ (`user-guards.test.ts`): แอดมินที่ไม่ใช่ SUPER_ADMIN
   ต้องจัดการ user ข้ามบริษัทไม่ได้เสมอ
2. **`syncUserToWorkforce`** — helper ภายในที่ไม่เคยเช็ค org เองเลย พึ่ง caller
   validate มาก่อนล้วนๆ — เพิ่ม `expectedOrgId` เป็น defense-in-depth: เรียก
   ด้วย userId ที่ orgId จริงไม่ตรงกับที่คาดไว้แล้ว **ไม่ทำงาน** (log เตือน
   แทนที่จะเงียบสนิท หรือ throw จนพัง action เดิม) ปักพฤติกรรมนี้ไว้ด้วยเทสต์
   เช่นกัน — ทั้งสองย้ายไป `apps/web/modules/admin/data/user-guards.ts` เพื่อ
   ให้เทสต์ import ได้ (ไฟล์เดิมเป็น `"use server"` ซึ่ง export อะไรจากที่นั่น
   กลายเป็น server action ที่เรียกตรงจาก client ได้ทันที ไม่เหมาะเอาไว้แค่
   ให้เทสต์เรียก)

## 5. Integration test harness

`apps/web/modules/__tests__/tenant-isolation/` — ต่อ Prisma client จริงผ่าน
Postgres จริง (throwaway `smartboss_test` database, drop/recreate ได้ทุกครั้ง
ไม่กระทบ DB dev จริง) แยกออกจากชุด unit test เร็วปกติตั้งใจ (`pnpm test` ไม่ต้อง
มี DB เลย) รันเพิ่มใน CI (`.github/workflows/ci.yml`, job `verify`) ผ่าน
Postgres service container

- `harness.ts` — `withOrgPair()` สร้าง 2 บริษัทจริงต่อรัน (id สุ่ม), cleanup
  เอง (best-effort — ความถูกต้องหลักคือการรันบน DB ทิ้งได้ ไม่ใช่ cleanup)
- `guard.smoke.test.ts` — พิสูจน์ว่าการ์ด "แยกแยะถูก" ไม่ใช่แค่ "throw ได้"
  (query ไม่มี orgId ต้อง reject, มี orgId ต้องผ่าน, ห่อ `crossOrg` ต้องผ่าน)
- `user-guards.test.ts` — ปักพฤติกรรม 2 จุด concentration-of-trust ด้านบน

## สถานะปัจจุบัน / ต้องทำต่อ

- ✅ Dev + CI: `TENANT_GUARD=strict`
- ⏳ Production: ยัง `warn` — แผน: deploy โค้ดที่แก้บั๊ก `crossOrg()` ก่อน → เฝ้า
  `[tenant-guard]` log สักพัก (ควรเงียบสนิทถ้า audit นี้ถูกต้อง) → ยืนยันไม่มี
  query แปลกหลุด → ค่อย flip `TENANT_GUARD=strict` ที่ production
- Audit นี้เป็น point-in-time — ครอบคลุมเฉพาะโค้ดที่มีอยู่ ณ วันที่ตรวจ โค้ด
  ใหม่ที่เขียนหลังจากนี้ต้องพึ่ง strict-mode guard + integration test harness
  ข้างบนเป็นเส้นป้องกันต่อไป ไม่ใช่ hand-audit ซ้ำทุกครั้ง
