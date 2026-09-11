# Tenant isolation integration tests

เทสต์ในโฟลเดอร์นี้ต่อ Prisma client จริง (ไม่ mock) เพื่อพิสูจน์ว่า tenant-guard
(`packages/database/tenant-guard.ts`) ทำงานถูกต้องแบบ end-to-end และไล่หาจุดที่
ข้อมูลอาจรั่วข้ามบริษัท — ต่างจากเทสต์อื่นในโปรเจกต์ที่เป็น pure unit test ล้วน

## ⚠ ต้องใช้ test database แยก ห้ามชี้ไปที่ DB dev จริงเด็ดขาด

เทสต์พวกนี้ `CREATE`/`DELETE` แถวจริงใน `core.organizations` (ผ่าน harness.ts)
ถ้าเผลอรันด้วย `DATABASE_URL` ที่ชี้ไปฐาน dev จริง จะสร้างขยะทิ้งไว้ (หรือแย่กว่า
ถ้า cleanup พลาดตอน process โดน kill กลางคัน)

**ก่อนรันครั้งแรก** สร้างฐานทดสอบแยกในเครื่อง (Postgres เดียวกับที่ dev ใช้อยู่แล้ว
ตาม `docker-compose.yml`/`docs/deploy.md`):

```bash
createdb smartboss_test
```

แล้วรันด้วย `DATABASE_URL`/`DATABASE_URL_UNPOOLED` ชี้ไปฐานนั้นแทนฐาน dev:

```bash
DATABASE_URL=postgresql://easyboss:easyboss@localhost:5432/smartboss_test \
DATABASE_URL_UNPOOLED=postgresql://easyboss:easyboss@localhost:5432/smartboss_test \
TENANT_GUARD=strict \
pnpm --filter @smartboss/database db:deploy   # migrate ฐานทดสอบให้ทันสคีมาล่าสุดก่อน

DATABASE_URL=postgresql://easyboss:easyboss@localhost:5432/smartboss_test \
DATABASE_URL_UNPOOLED=postgresql://easyboss:easyboss@localhost:5432/smartboss_test \
TENANT_GUARD=strict \
pnpm --filter web test:tenant-isolation
```

พังแค่ไหนก็ `dropdb smartboss_test && createdb smartboss_test` แล้วเริ่มใหม่ได้เสมอ
— ไม่กระทบข้อมูล dev จริงของคุณเลย

CI ทำแบบเดียวกันอัตโนมัติผ่าน Postgres service container (`.github/workflows/ci.yml`)
ทุกรันสร้างฐานใหม่ ไม่มีอะไรค้างข้ามรัน

## รันเทสต์เฉพาะไฟล์นี้

`test:tenant-isolation` glob ทุกไฟล์ `*.test.ts` ในโฟลเดอร์นี้ — เพิ่มไฟล์เทสต์
ใหม่ที่นี่แล้วรันสคริปต์เดิมซ้ำได้เลย ไม่ต้องแก้ package.json ทุกครั้ง
